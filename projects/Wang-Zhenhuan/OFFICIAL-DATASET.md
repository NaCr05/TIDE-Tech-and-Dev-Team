# CSC3100 Assignment 1 官方数据接入说明

## 接入目标

在保留原“单链表反转”演示的同时，系统新增正式数据场景：

- 作业名称：`CSC3100 Assignment 1：杨辉三角`
- 对应题目：LeetCode 118 Pascal's Triangle
- 运行环境：Python 3.11
- 必需函数：`generate(numRows: int)`
- 输入范围：`1 ≤ numRows ≤ 20`
- 代码测试：20 个测试点，共 50 分
- 作业报告：5 个维度，共 50 分

初始化数据选取官方提交包中的三份代表性答案：

- `120010001 Alex Chen`：20/20 测试通过；
- `120010010 Julia Wu`：5/20 测试通过；
- `120010015 Oscar Lin`：1/20 测试通过。

原始材料位于项目外部交付目录的 `submission/` 中。项目只保存演示所需的代表性文本，
不会复制学生 PDF、压缩包、成绩册或个人信息全集。

## 如何初始化

新环境直接运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1
```

已有数据库重新执行 Seed：

```powershell
docker compose exec backend npm run prisma:seed
```

Seed 使用 `upsert`，不会删除原有作业、提交、评估或审计记录。

## 如何演示发布能力

教师账号在 Mattermost 中发送：

```text
/ds publish | CSC3100 Assignment 1：杨辉三角 | 2026-07-27 23:59 | 实现 generate(numRows: int)，返回杨辉三角的前 numRows 行；1 ≤ numRows ≤ 20。 | Python 3.11；代码测试 20 例占 50 分，报告五个维度占 50 分。
```

这是完整的“教师发布”操作。Seed 中另有同名官方数据作业，用于无需现场粘贴三份长代码即可稳定展示批改结果。

## 学生提交格式

专项评估器从一份普通文本提交中识别两段：

```text
代码实现:
def generate(numRows: int) -> list[list[int]]:
    ...

报告:
Implementation Summary
...
```

仍通过现有命令提交：

```text
/ds submit | assignment_id | 代码实现: ... 报告: ...
```

在 Mattermost 输入多行代码时可使用 `Shift+Enter` 换行。

## 批改证据

识别到 Pascal's Triangle / 杨辉三角作业后，Mock Agent 不再使用原链表关键词规则，
而会：

1. 解析并校验 `generate` 函数；
2. 在独立进程中执行学生代码，设置 2 秒上限；
3. 对 `numRows=1..20` 运行 20 个确定性测试；
4. 按每例 2.5 分计算代码成绩；
5. 按算法说明、正确性论证、复杂度、实现与示例、表达与原创性评估报告；
6. 输出既有 Evaluation 格式，并把测试通过数、失败输入、代码分和报告分保存到 Agent 原始证据中。

因此新增场景可直接复用现有前端的评分卡、统计图、教师确认、教师修改、重新评估和
EvaluationAudit 时间线。

## 自动测试

在项目根目录直接校验完整官方数据集：

```powershell
python .\tests\run_official_dataset_tests.py
```

该命令会以只读方式检查 `submission/` 的清单、16 份有效 ZIP、3 份无效提交、
1 份迟交、1 份缺交以及 3 个公开和 17 个隐藏测试点，并执行所有有效代码。
预期结果是数据结构全部 `PASS`，且 `Code expectations: PASS (16/16 valid archives checked)`。

再运行专项评分器回归测试：

```powershell
Set-Location .\agent
python -m unittest test_pascal_grader.py -v
Set-Location ..
```

预期看到三项测试均为 `ok`。测试会验证代表性代码分别通过 20、5、1 个测试点，
并核对三份代表性提交的官方预期总分。

## 能力边界

- 专项代码执行只对 CSC3100 杨辉三角作业启用，原单链表演示行为不变；
- 当前执行隔离用于本地验收 Demo，不等价于面向不可信公网用户的生产沙箱；
- 报告分是可解释的规则化辅助评分，最终成绩仍应由教师确认；
- 数据库中的 Evaluation 分数为整数，若原始总分出现 `.5`，页面会四舍五入显示；
- 现场展示建议使用 Seed 中的三份代表性提交，不要临时导入全部学生档案。
