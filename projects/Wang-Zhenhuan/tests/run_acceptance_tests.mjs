const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000";

const linkedListAssignment = {
  title: "单链表反转",
  question: "请实现单链表反转，并说明时间复杂度和空间复杂度。",
  instructions: "可以使用伪代码或文字说明。",
};

const cases = [
  {
    id: "complete-answer",
    name: "正常完整答案",
    assignment: linkedListAssignment,
    answer:
      "使用 prev、current、next 三个指针。先保存 next=current.next，再令 current.next=prev，随后移动 prev 和 current。时间复杂度 O(n)，空间复杂度 O(1)。",
    expected: { score: 95, grade: "A", correctness: "correct" },
    note: "覆盖算法步骤与复杂度。",
  },
  {
    id: "partially-correct",
    name: "部分正确答案",
    assignment: linkedListAssignment,
    answer:
      "遍历链表，把每个节点的 next 指向前一个节点，时间复杂度 O(n)。",
    expected: { score: 76, grade: "C", correctness: "mostly_correct" },
    note: "方向正确，但缺少临时指针和空间复杂度。",
  },
  {
    id: "clearly-wrong",
    name: "明显错误答案",
    assignment: linkedListAssignment,
    answer: "把链表节点中的值排序，再放回链表即可完成反转。",
    expected: { score: 20, grade: "F", correctness: "incorrect" },
    note: "混淆节点值排序与指针方向反转。",
  },
  {
    id: "ambiguous-answer",
    name: "不完整或模糊答案",
    assignment: linkedListAssignment,
    answer: "遍历一下，把指针方向改过来就可以。",
    expected: { score: 55, grade: "F", correctness: "uncertain" },
    note: "信息不足，无法稳定判断。",
  },
  {
    id: "known-misjudgment",
    name: "Agent 误判记录",
    assignment: linkedListAssignment,
    answer:
      "保存当前节点的后继，将当前节点指向它的前驱，再依次向后移动；全部处理完成后返回原尾节点。只遍历一次，额外仅使用常数个指针。",
    expected: { score: 55, grade: "F", correctness: "uncertain" },
    note: "语义正确，但未出现 Mock 规则依赖的英文关键词，当前实现会误判。",
  },
  {
    id: "no-code-execution",
    name: "代码执行能力边界",
    assignment: linkedListAssignment,
    answer:
      "伪代码：prev=current=next=不存在的变量；然后使用 prev、current、next 更新指针。时间复杂度 O(n)，空间复杂度 O(1)。",
    expected: { score: 95, grade: "A", correctness: "correct" },
    note: "包含明显不可执行内容，但 Mock 只做文本匹配，不能编译或运行代码。",
  },
];

const requiredTopLevelFields = [
  "completeness",
  "correctness",
  "main_problems",
  "suggestions",
  "score",
  "grade",
  "provider",
  "attempts",
  "raw_output",
];

function validateShape(report) {
  return (
    requiredTopLevelFields.every((field) => field in report) &&
    typeof report.completeness?.level === "string" &&
    typeof report.completeness?.comment === "string" &&
    typeof report.correctness?.level === "string" &&
    typeof report.correctness?.comment === "string" &&
    Array.isArray(report.main_problems) &&
    report.main_problems.length > 0 &&
    Array.isArray(report.suggestions) &&
    report.suggestions.length > 0 &&
    Number.isInteger(report.score) &&
    report.score >= 0 &&
    report.score <= 100
  );
}

const results = [];

for (const testCase of cases) {
  const response = await fetch(`${agentUrl}/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assignment: testCase.assignment,
      submission: {
        student: `验收测试-${testCase.id}`,
        answer: testCase.answer,
      },
    }),
  });

  if (!response.ok) {
    results.push({
      id: testCase.id,
      name: testCase.name,
      passed: false,
      error: `HTTP ${response.status}: ${await response.text()}`,
    });
    continue;
  }

  const report = await response.json();
  const shapeValid = validateShape(report);
  const observedAsExpected =
    report.score === testCase.expected.score &&
    report.grade === testCase.expected.grade &&
    report.correctness.level === testCase.expected.correctness;

  results.push({
    id: testCase.id,
    name: testCase.name,
    passed: shapeValid && observedAsExpected,
    shapeValid,
    observedAsExpected,
    score: report.score,
    grade: report.grade,
    completeness: report.completeness.level,
    correctness: report.correctness.level,
    provider: report.provider,
    attempts: report.attempts,
    note: testCase.note,
  });
}

console.table(
  results.map(
    ({
      id,
      passed,
      score,
      grade,
      completeness,
      correctness,
      provider,
    }) => ({
      id,
      passed,
      score,
      grade,
      completeness,
      correctness,
      provider,
    }),
  ),
);

const passed = results.filter((result) => result.passed).length;
console.log(`Acceptance cases: ${passed}/${results.length} matched documented behavior.`);
console.log(JSON.stringify(results, null, 2));

if (passed !== results.length) {
  process.exitCode = 1;
}
