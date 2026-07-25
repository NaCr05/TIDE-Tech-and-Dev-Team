# 测试结果记录

## 测试环境
- AI 模型：DeepSeek-chat
- 评分标准：CSC3100-A1 Rubric（代码 50 + 报告 50 = 100 分）
- Prompt 版本：v2（动态 Rubric + 评分校准）
- 日期：2026-07-23

## 测试作业
- 题目：LeetCode 118 - Pascal's Triangle（杨辉三角）

---

## 测试 1：优秀答案（Alex Chen）

- **答案特征**：代码正确，报告完整（算法思路 + 正确性 + 复杂度 + 示例）
- **预期**：85-95 分
- **实际**：**98/100 分**

### AI 评估结果

| 维度 | 得分 |
|------|------|
| 代码评分 | 50/50 |
| Algorithm clarity | 评分合理 |
| Correctness reasoning | 评分合理 |
| Complexity analysis | 评分合理 |
| Implementation and examples | 评分合理 |
| Presentation and originality | 评分合理 |
| **总分** | **98/100** |

- AI 风险标记：low
- 评价是否合理：分数略高，但整体合理。代码 50 满分正确。报告各维度扣分温和，纠正了之前"实现与示例必须截图"的偏严倾向。

---

## 测试 2：代码正确但报告偏弱（Ethan Liu）

- **答案特征**：代码正确，但报告过于简略，缺少复杂度详细分析和示例
- **预期**：65-80 分
- **实际**：**73/100 分**

### AI 评估结果

| 维度 | 得分 |
|------|------|
| 代码评分 | 50/50 |
| Algorithm clarity | 较低 |
| Correctness reasoning | 较低 |
| Complexity analysis | 中等偏低 |
| Implementation and examples | 中等偏低 |
| Presentation and originality | 中等偏低 |
| **总分** | **73/100** |

- AI 风险标记：low
- 评价是否合理：合理。代码正确得 50，报告因过于简略被扣 27 分，符合 rubric。

---

## 测试 3：代码有 Bug（Julia Wu）

- **答案特征**：代码有 `min(numRows, 5)` 限制行数的 Bug，报告一般但比 Nina 好
- **预期**：35-50 分
- **实际**：**44/100 分**

### AI 评估结果

| 维度 | 得分 |
|------|------|
| 代码评分 | 20/50 |
| Algorithm clarity | 较低 |
| Correctness reasoning | 很低 |
| Complexity analysis | 中等 |
| Implementation and examples | 很低 |
| Presentation and originality | 很低 |
| **总分** | **44/100** |

- AI 风险标记：low
- 评价是否合理：代码扣 30 分（一个硬编码限制 Bug），比例仍偏重但比之前（扣 30 到 20）稍好。报告部分因 Julia 至少分析了复杂度，得分高于 Nina。

---

## 测试 4：同样有 Bug 且报告更差（Nina Tang）

- **答案特征**：代码有同样的行数限制 Bug，报告极简
- **预期**：25-40 分
- **实际**：**28/100 分**

### AI 评估结果

| 维度 | 得分 |
|------|------|
| 代码评分 | 20/50 |
| Algorithm clarity | 很低 |
| Correctness reasoning | 很低 |
| Complexity analysis | 很低 |
| Implementation and examples | 很低 |
| Presentation and originality | 很低 |
| **总分** | **28/100** |

- AI 风险标记：low
- 评价是否合理：合理。与 Julia 相比，代码分相同（都是同样 Bug），但报告维度全部更低，总分 44 vs 28 拉开了 16 分的差距。这是 v2 Prompt 的一大改进。

---

## 测试 5：完全错误答案（Student_Bad）

- **答案特征**：代码逻辑根本错误（`[1]*i` 且行长度不对），报告错误
- **预期**：10-20 分
- **实际**：**18/100 分**

### AI 评估结果

| 维度 | 得分 |
|------|------|
| 代码评分 | 10/50 |
| Algorithm clarity | 很低 |
| Correctness reasoning | 很低 |
| Complexity analysis | 很低 |
| Implementation and examples | 很低 |
| Presentation and originality | 很低 |
| **总分** | **18/100** |

- AI 风险标记：low
- 评价是否合理：合理。代码完全错误，但报告部分提到了复杂度概念给了少量分数，总分 18 符合预期。

---

## 误判与不稳定输出记录

| 测试编号 | 现象 | 可能原因 | 是否改善 |
|---------|------|---------|---------|
| #1 | v1 版本 Alex 只得 83 分 | "实现与示例"强制要求截图 | ✅ v2 改为"代码本身就是实现" |
| #3, #4 | v1 版本 Julia 和 Nina 同得 27 分，无法区分 | 报告维度评分不敏感 | ✅ v2 得分 44 vs 28，已区分 |
| #3 | 代码单个 Bug 扣 30 分，比例偏重 | AI 对 Bug 惩罚偏重 | ⚠️ 改善到扣 30 分（仍略重） |

---

## 总结

- 5 份测试评分区间：**18-98 分**
- 评分区分度：**明显**（v1 为 7-83，区分度不足；v2 扩展到 18-98，且 Julia/Nina 成功区分）
- AI 是否能准确识别代码 Bug：**是**（正确识别 min(numRows,5) 硬编码和错误逻辑）
- 整体评估质量：**良好**（建议具体可操作，评分基本合理，单个 Bug 扣分仍略重但可接受）
- v2 相比 v1 的三项改进：最高分提升到合理区间、中间档答案有效区分、代码扣分比例改善
