# TIDE 最终验收演示脚本

> 建议时长：15–20 分钟
> 演示目标：完整展示发布、提交、汇总、Agent 评估和教师审核。

## 0. 演示前准备

准备两个浏览器会话：

- 普通窗口：教师 `zhenhuan`
- 无痕窗口：学生 `student01`

打开：

- Mattermost：`http://localhost:8065`
- 教师工作台：`http://localhost:5173`

在 PowerShell 检查：

```powershell
docker compose ps
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:8000/health
```

正式验收前确认 `.env` 已设置：

```dotenv
AGENT_MODE=live
DEEPSEEK_MODEL=deepseek-v4-pro
```

修改配置后执行：

```powershell
docker compose up -d --build agent backend
```

再次检查 Agent 健康接口，确认返回内容中的 `mode` 为 `live`。若现场网络或 API 服务不可用，
再将 `AGENT_MODE` 改回 `mock` 并重建 Agent 与后端，使用离线模式完成稳定演示。

说明：

> 系统由 PostgreSQL、Express 后端、FastAPI Agent 和 React 前端组成。Mattermost 通过 POST Slash Command 调用后端。

## 1. 教师发布作业（约 2 分钟）

在教师 Mattermost 发送：

```text
/ds publish | 栈的括号匹配 | 2026-07-25 23:59 | 请说明如何使用栈判断括号序列是否合法，并分析时间复杂度和空间复杂度。 | 可使用伪代码或文字说明
```

指出返回内容：

- 作业标题；
- 作业 ID；
- 截止时间；
- 题目内容；
- 消息对频道成员可见。

复制返回的作业 ID，后续替换 `<assignment_id>`。

## 2. 学生提交答案（约 2 分钟）

切换到学生无痕窗口，发送：

```text
/ds submit | <assignment_id> | 从左到右扫描字符。遇到左括号就压栈；遇到右括号时检查栈顶是否为对应的左括号，不匹配或栈为空则不合法。扫描结束后栈为空才合法。时间复杂度 O(n)，空间复杂度 O(n)。
```

说明：

> 后端先保存答案，再调用 Agent。即使 Agent 临时失败，学生提交也不会丢失。

展示返回的提交 ID 和基础评估提示。

## 3. 教师查看汇总（约 2 分钟）

切回教师窗口：

```text
/ds summary | <assignment_id>
```

指出：

- 按作业汇总；
- 学生姓名；
- 答案摘要；
- 分数、等级和审核状态；
- 教师工作台链接。
- 每份评估下方的“确认评估”和“重新评估”交互按钮。

可直接点击一份报告的“确认评估”，展示 Mattermost 返回的确认提示。再执行一次 `/ds summary`，可看到状态已经更新。说明按钮上下文带 HMAC 签名，后端还会重新校验教师角色。

## 4. 展示 Agent 报告（约 3 分钟）

打开 `http://localhost:5173`：

1. 点击“刷新数据”；
2. 从下拉框选择刚发布的作业；
3. 展示 Agent 统计总结：
   - 已评估数量；
   - 平均分、最高分和最低分；
   - A–F 等级分布；
   - 完整、部分完整、不完整的答案分布；
4. 演示搜索与筛选：
   - 输入学生姓名或答案关键词；
   - 选择审核状态或等级；
   - 切换“分数从低到高”等排序；
   - 清空筛选，恢复全部提交；
5. 展示报告字段：
   - 答案完整性；
   - 正确性初步判断；
   - 主要问题；
   - 修改建议；
   - 分数与等级；
   - 状态与版本。
6. 点击“查看评估历史”，展示不可变审计时间线中的操作类型、版本、分数、等级、操作者和时间。

说明：

> 正式验收优先使用 DeepSeek 在线模式，展示系统确实接入外部 AI Agent。在线输出会经过
> Pydantic 结构校验，并在校验失败时自动重试一次。若现场网络或 API 服务异常，可切换到
> Mock 模式作为离线兜底；两种模式返回相同的评估报告结构，教师审核流程不变。

## 5. 教师审核三种操作（约 4 分钟）

### 确认

在一份合理报告上点击“确认评估”，展示“教师已确认”。

### 修改

如果 Agent 误判，点击“修改结果”，例如改为：

```text
分数：95
等级：A
评语：教师复核：答案正确描述了算法流程，并准确给出复杂度。
```

保存后展示“教师已修改”和版本变化。

再次展开“查看评估历史”，指出教师修改产生了一条新的 `modified` 审计记录，旧版本仍然保留。

### 重新评估

点击“重新评估”，展示：

- Agent 再次生成结果；
- 状态回到待审核；
- 版本号增加。

再次查看评估历史，展示新追加的 `regraded` 记录，说明重评不会覆盖旧记录。

强调：

> AI 不替代教师，教师拥有最终决定权。

## 6. 测试和边界（约 3 分钟）

运行：

```powershell
node .\tests\run_acceptance_tests.mjs
docker compose exec backend npm run test:api
```

展示：

```text
Acceptance cases: 6/6 matched documented behavior.
API tests: 9 passed, 0 failed.
```

说明六类测试：

- 完整；
- 部分正确；
- 明显错误；
- 模糊；
- 误判；
- 无法运行代码的边界。

主动说明：

> 6/6 表示行为与文档一致，不代表六次教学判断都正确。Mock 可能漏掉同义表达，也可能被关键词误导；系统不会编译或运行代码。

可选展示结构化日志：

```powershell
docker compose logs --tail 20 backend
```

指出每条日志都是 JSON，包含请求 ID、HTTP 状态、耗时以及评估或 Mattermost 业务事件，但不包含 Token 和 API Key。

## 7. 收尾（约 1 分钟）

总结：

> 当前系统已经完成 Mattermost 发布、学生提交、自动评估、带交互按钮的教师汇总和三种审核操作。核心数据持久化在 PostgreSQL，Agent 输出经过结构校验，教师操作有审计记录，后端提供结构化日志和正式 API 集成测试。已知边界被测试和文档明确记录。

可选展示代码位置：

- `backend/prisma/schema.prisma`
- `backend/src/app.ts`
- `agent/main.py`
- `frontend/src/App.tsx`
- `tests/TEST_RESULTS.md`

## 当前已有数据的快速演示

如果时间紧，可以直接复用当前记录：

```text
作业：栈的括号匹配
作业 ID：cmrx78y0h000072p89c6i8yoa
学生：student01
提交 ID：cmrx7iit2000172p86psp3f5g
```

当前该报告已展示过：

- 初次 Agent 评估 55/F；
- 教师修改为 95/A；
- 重新评估回到 55/F；
- 版本号递增至 4。
