# 数据结构课程作业批改系统

基于 DeepSeek AI 的作业发布、提交与自动批改工具。支持 Mattermost Slash Command 作为辅助操作通道。

## 功能

| 功能 | 教师端 | 学生端 |
|------|--------|--------|
| 发布作业 | Web `/publish` | — |
| 提交答案 | — | Web `/submit` |
| 查看汇总 | Web `/summary` | — |
| AI 评估 | 一键生成结构化评估报告 | — |
| 审核评估 | 确认 / 修改评分评语 / 重新评估 | — |

## 环境要求

- Python 3.10+
- Docker Desktop
- DeepSeek API Key（https://platform.deepseek.com）

## 快速开始

### 1. 启动 PostgreSQL

```bash
docker run -d --name homework-postgres -e POSTGRES_USER=homework -e POSTGRES_PASSWORD=homework123 -e POSTGRES_DB=homework_db -p 5434:5432 postgres:14
```

### 2. 配置环境变量

编辑 `.env` 文件：

```
BOT_TOKEN=你的Mattermost_Bot_Token
DEEPSEEK_API_KEY=sk-你的DeepSeek密钥
```

### 3. 安装依赖

```bash
python -m venv venv
venv\Scripts\activate    # Windows
pip install -r requirements.txt
```

### 4. 初始化数据库

```bash
python models.py
```

### 5. 启动服务

```bash
python app.py
```

### 6. 打开浏览器

访问 `http://localhost:5000`

## 使用流程

| 步骤 | 角色 | 操作 |
|------|------|------|
| 1 | 教师 | Web `/publish` → 填写标题、题目内容、截止时间 |
| 2 | 学生 | Web `/submit` → 选择作业 → 填写姓名和答案 |
| 3 | 教师 | Web `/summary` → 选择作业 → 查看所有提交 |
| 4 | 教师 | 点击"生成 AI 评估" → 等待 DeepSeek 返回结构化报告 |
| 5 | 教师 | 审核评估 → 确认 / 修改评分评语 / 重新评估 |

## 评估报告字段

每份 AI 评估按 CSC3100-A1 Rubric 打分（总分 100 = 代码 50 + 报告 50）：

| 维度 | 满分 | 说明 |
|------|------|------|
| 代码评分 | 50 | 代码逻辑正确性，Bug 检测，边界条件处理 |
| 算法思路清晰度 | 15 | 算法描述是否完整、清晰 |
| 正确性分析 | 10 | 是否对算法正确性做了严谨论证 |
| 复杂度分析 | 10 | 时间 + 空间复杂度分析是否到位 |
| 实现与示例 | 10 | 代码实现和运行示例 |
| 表达与原创性 | 5 | 报告结构、语言表达、个人见解 |
| **总分** | **100** | 六个维度汇总 |

同时包含 **AI 风险标记**（low / medium / high），提示 AI 生成嫌疑等级。

评分标准通过 `submission/rubric/grading_rubric.json` 动态加载，换作业只需替换 JSON 文件。

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端框架 | Flask |
| 数据库 | PostgreSQL 14 + psycopg2 |
| AI 引擎 | DeepSeek API（OpenAI SDK 兼容） |
| 前端 | Jinja2 模板 + 原生 CSS |

## 项目结构

```
├── app.py                # Flask 主应用（所有路由）
├── models.py             # 数据库连接与建表
├── ai_agent.py           # DeepSeek 调用 + 报告解析 + Rubric 动态加载
├── mattermost_bot.py     # Mattermost Bot 消息发送
├── config.py             # 配置中心
├── .env                  # 密钥（不提交 Git）
├── .gitignore
├── requirements.txt
├── templates/
│   ├── index.html               # 首页导航
│   ├── publish.html             # Web 发布作业
│   ├── submit.html              # Web 学生提交
│   ├── summary.html             # 作业汇总列表
│   ├── assignment_detail.html   # 作业详情 + 结构化评估
│   └── review.html              # 审核评估（确认/修改/重评）
├── static/
│   └── style.css
├── submission/                  # CSC3100 测试数据集
│   ├── assignment/              # 作业题目 PDF
│   ├── rubric/                  # grading_rubric.json 评分标准
│   ├── students/submitted/      # 16 份有效提交（ZIP）
│   ├── students/invalid/        # 3 份格式无效提交
│   └── submission_manifest.json # 学生名单与提交状态
└── test_cases/
    ├── test_result.md           # 5 类质量测试记录
    └── capability_boundary.md   # 能力边界与误判分析
```

## 测试

`test_cases/` 目录包含基于 CSC3100 测试数据集的完整测试记录：

- `test_result.md`：5 份不同质量答案的评估结果（优秀/报告偏弱/代码有Bug/报告极简/完全错误），覆盖 18-98 分
- `capability_boundary.md`：系统能稳定处理与不能处理的场景、AI 误判记录、架构限制、v2 迭代总结

## 角色说明

不实现完整权限系统，通过不同页面路径区分角色：

- **教师端**：`/publish`、`/summary`、`/review/<id>`
- **学生端**：`/submit`
