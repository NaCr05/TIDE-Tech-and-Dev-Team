from openai import OpenAI
from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
import re
import json
import os

client = OpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url=DEEPSEEK_BASE_URL,
)

# 默认 rubric 路径
RUBRIC_PATH = os.path.join(os.path.dirname(__file__), "submission", "rubric", "grading_rubric.json")


def load_rubric(path=RUBRIC_PATH):
    """从 JSON 文件加载评分标准"""
    with open(path, "r", encoding="utf-8") as f:
        rubric = json.load(f)
    return rubric


def build_prompt(assignment, answer, rubric=None):
    """根据 rubric 动态生成评估 Prompt"""
    if rubric is None:
        rubric = load_rubric()

    total = rubric["total_points"]
    code_points = rubric["code"]["points"]
    report_points = rubric["report"]["points"]
    criteria = rubric["report"]["criteria"]
    bands = rubric["report"]["criterion_scoring_bands"]

    # 构建报告维度表格
    criteria_lines = ""
    for c in criteria:
        clabel = c["label"]
        cpoints = c["points"]
        criteria_lines += f"| {clabel} | {cpoints} | {bands['full']} / {bands['substantial']} / {bands['partial']} / {bands['minimal']} / {bands['none']} |\n"

    # 构建输出格式行
    output_headers = ""
    for c in criteria:
        output_headers += f"**{c['label']}**：（X/{c['points']} 分，评价）\n\n"

    prompt = f"""你是一名数据结构课程助教，正在批改作业：{rubric['assignment']}。

总分 {total} 分 = 代码部分 {code_points} 分 + 报告部分 {report_points} 分。

## 评分框架

### 代码部分（{code_points} 分）
- 判断代码逻辑是否正确
- 检查边界条件
- 识别明显 Bug（如硬编码限制、错误的数据生成逻辑）

### 代码扣分规则（重要）
扣分必须与 Bug 严重程度成正比：
- **轻微缺陷**（如边界条件处理不完整，但主体逻辑正确）：扣 5-15 分
- **中等 Bug**（如部分功能缺失或逻辑有明显缺陷）：扣 15-30 分
- **严重错误**（如完全未实现题目要求、算法根本错误）：扣 30-50 分

不要因为一个非致命 Bug 就扣掉大部分分数。如果代码主体逻辑正确，得分应在 35-50 之间。

### 报告部分（{report_points} 分），按以下维度打分：

| 维度 | 满分 | 评分标准 |
|------|------|---------|
{criteria_lines}

### 评分参考
- 一份代码完全正确、报告全面（含算法思路、正确性分析、复杂度、运行示例）的作业应在 **85-95 分**
- 一份代码正确但报告简略的作业应在 **65-80 分**
- 一份代码有明显 Bug 的作业应在 **30-50 分**
- 不要所有答案都给同一档分数，要拉开差距
- "实现与示例"维度：学生提交的代码本身就是实现。如果代码在答案中清晰给出，该维度至少给 substantial（70-89%）的分数

### AI 风险标记（重要）
- **low**：无明显 AI 痕迹，评分无影响
- **medium**：有 AI 辅助嫌疑，在报告中标注，建议教师审查
- **high**：几乎确定是 AI 生成，必须教师审查。注意：即使标记为 high，也不要自动扣分

---

【作业题目】
{assignment}

【学生答案】
{answer}

---

请严格按以下格式输出评估报告：

**代码评分**：（X/{code_points} 分，说明代码是否正确，有无 Bug，扣分原因）

{output_headers}
**总分**：（X/{total} 分）

**主要问题**：（列出最主要的问题或不足）

**改进建议**：（具体、可操作的改进方向）

**AI风险标记**：（low / medium / high，简要说明理由）"""

    return prompt


def evaluate(assignment_content, student_answer, rubric_path=None):
    """调用 DeepSeek 评估一份学生提交"""
    path = rubric_path or RUBRIC_PATH
    rubric = load_rubric(path)
    prompt = build_prompt(assignment_content, student_answer, rubric)

    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": "你是一名公正严谨的数据结构助教。严格按评分框架打分，代码扣分与 Bug 严重程度成正比。不苛刻不放水，能准确区分不同质量的答案。打分时参考评分参考中的分数区间。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
    )

    return response.choices[0].message.content


def parse_report(report_text):
    """从 AI 报告提取各字段"""
    result = {
        "score": "",
        "completeness": "",
        "correctness": "",
        "issues": "",
        "suggestions": "",
    }

    # 提取总分
    m = re.search(r"\*\*总分\*\*[：:]\s*(.+?)(?=\n|$)", report_text)
    if m:
        result["score"] = m.group(1).strip()

    # 提取代码评分
    m = re.search(r"\*\*代码评分\*\*[：:]\s*(.+?)(?=\n|$)", report_text)
    if m:
        result["correctness"] = m.group(1).strip()

    # 汇总报告维度
    dim_labels = [
        "Algorithm clarity", "Correctness reasoning",
        "Complexity analysis", "Implementation and examples",
        "Presentation and originality",
        # 中文回退
        "算法思路清晰度", "正确性分析", "复杂度分析", "实现与示例", "表达与原创性",
    ]
    dims = []
    for label in dim_labels:
        m = re.search(rf"\*\*{label}\*\*[：:]\s*(.+?)(?=\n|$)", report_text)
        if m:
            val = m.group(1).strip()
            if val and val not in dims:
                dims.append(f"{label}：{val}")
    result["completeness"] = "；".join(dims) if dims else ""

    # 提取主要问题
    m = re.search(r"\*\*主要问题\*\*[：:]\s*(.+?)(?=\n\*\*|\Z)", report_text, re.DOTALL)
    if m:
        result["issues"] = m.group(1).strip()

    # 提取改进建议
    m = re.search(r"\*\*改进建议\*\*[：:]\s*(.+?)(?=\n\*\*|\Z)", report_text, re.DOTALL)
    if m:
        result["suggestions"] = m.group(1).strip()

    return result
