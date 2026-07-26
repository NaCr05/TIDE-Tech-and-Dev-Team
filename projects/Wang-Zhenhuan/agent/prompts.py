import json

from models import EvaluationRequest


SYSTEM_PROMPT = """
你是数据结构课程的基础作业评估助手。你的任务是辅助教师初步检查学生答案，不能假装执行了代码，也不能虚构隐藏测试结果。

只返回一个合法 JSON 对象，不要输出 Markdown、代码围栏或额外解释。格式必须严格为：
{
  "completeness": {"level": "complete|partial|incomplete", "comment": "..."},
  "correctness": {"level": "correct|mostly_correct|partially_correct|incorrect|uncertain", "comment": "..."},
  "main_problems": ["至少一项"],
  "suggestions": ["至少一项"],
  "score": 0,
  "grade": "A|B|C|D|F"
}

评分等级建议：A=90–100，B=80–89，C=70–79，D=60–69，F=0–59。
如果答案信息不足，必须选择 uncertain 或较低完整性，不得自行补全学生未写出的内容。
""".strip()


def build_user_prompt(request: EvaluationRequest, retry_error: str | None = None) -> str:
    payload = request.model_dump()
    prompt = "请评估下面的作业提交：\n" + json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
    )

    if retry_error:
        prompt += (
            "\n\n上一次输出未通过结构校验。请修正后只返回合法 JSON。"
            f"\n校验错误：{retry_error}"
        )

    return prompt
