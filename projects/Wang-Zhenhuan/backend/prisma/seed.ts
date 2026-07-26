import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const linkedListAnswers = [
  "使用 prev、current、next 三个指针迭代。每次保存 current.next，再令 current.next 指向 prev，然后整体向后移动，最后返回 prev。时间复杂度 O(n)，额外空间复杂度 O(1)，并考虑空链表和单节点链表。",
  "遍历链表，把每个节点的 next 指向前一个节点，最后返回新头节点。时间复杂度 O(n)。",
  "把链表中的值排序后重新放回原链表，就可以得到反转后的链表。",
];

const officialSubmissions = [
  {
    id: "official_student_120010001",
    username: "csc3100_120010001",
    displayName: "Alex Chen（120010001）",
    code: `def generate(numRows: int) -> list[list[int]]:
    triangle = []
    for row_index in range(numRows):
        row = [1] * (row_index + 1)
        for column in range(1, row_index):
            row[column] = triangle[row_index - 1][column - 1] + triangle[row_index - 1][column]
        triangle.append(row)
    return triangle`,
    report: `Implementation Summary
The solution builds the triangle from top to bottom. Every row starts and ends with 1; each interior value is computed from the two adjacent values in the previous row.

Correctness Reasoning
Correctness follows by induction. The base row is [1]. Assuming the previous row is correct, Pascal's identity constructs every interior value of the next row, while the boundary values remain 1.

Complexity Analysis
For numRows = n, the algorithm creates n(n+1)/2 values, so time complexity is O(n^2). The returned triangle requires O(n^2) space; excluding output storage, additional working space is O(1).

Testing and Reflection
For row index 4, the previous row [1, 3, 3, 1] produces [1, 4, 6, 4, 1]. I tested boundaries and several ordinary sizes.

Assistance Declaration
I used course notes and the published problem statement.`,
  },
  {
    id: "official_student_120010010",
    username: "csc3100_120010010",
    displayName: "Julia Wu（120010010）",
    code: `def generate(numRows: int) -> list[list[int]]:
    rows = [[1]]
    for row_index in range(1, min(numRows, 5)):
        previous = rows[-1]
        rows.append([1] + [previous[i - 1] + previous[i] for i in range(1, row_index)] + [1])
    return rows`,
    report: `Implementation Summary
The intended dynamic programming approach stores completed rows and derives the next row from adjacent entries.

Correctness Reasoning
The invariant is that all rows already stored are correct. The next row preserves boundary values and applies Pascal's identity to its interior.

Complexity Analysis
The intended complexity is O(n^2) time and O(n^2) output space.

Testing and Reflection
A useful test set includes n = 1, n = 2, n = 5, and a larger value. My current implementation may still need additional boundary validation.

Assistance Declaration
I used the course notes and public examples.`,
  },
  {
    id: "official_student_120010015",
    username: "csc3100_120010015",
    displayName: "Oscar Lin（120010015）",
    code: `def generate(numRows: int) -> list[list[int]]:
    rows = [[1]]
    for row_index in range(1, numRows):
        previous = rows[-1]
        rows.append([0] + [previous[i - 1] + previous[i] for i in range(1, row_index)] + [0])
    return rows`,
    report: `Implementation Summary
I construct each new row using the previous row. The first and last values are one, and the middle values are sums.

Correctness Reasoning
This works because Pascal's Triangle follows the addition rule. I checked the public examples.

Complexity Analysis
The time complexity is O(n^2). The program stores the output triangle.

Testing and Reflection
The implementation uses loops and returns the completed list. More edge-case testing could be added.

Assistance Declaration
I used the published problem statement.`,
  },
];

async function main() {
  const teacher = await prisma.user.upsert({
    where: { username: "teacher01" },
    update: { displayName: "数据结构教师", role: "teacher" },
    create: {
      id: "user_teacher_001",
      username: "teacher01",
      displayName: "数据结构教师",
      email: "teacher01@example.com",
      role: "teacher",
    },
  });

  const students = await Promise.all(
    [
      ["user_student_001", "student01", "学生一"],
      ["user_student_002", "student02", "学生二"],
      ["user_student_003", "student03", "学生三"],
    ].map(([id, username, displayName]) =>
      prisma.user.upsert({
        where: { username },
        update: { displayName, role: "student" },
        create: { id, username, displayName, role: "student" },
      }),
    ),
  );

  const linkedListAssignment = await prisma.assignment.upsert({
    where: { id: "assignment_linked_list_reverse" },
    update: {
      title: "单链表反转",
      question: "请实现单链表反转，并说明算法的时间复杂度和空间复杂度。",
      deadline: new Date("2026-07-27T15:59:00.000Z"),
      instructions: "请使用伪代码或任意编程语言作答，并说明关键指针变化及边界情况。",
      status: "published",
      createdById: teacher.id,
    },
    create: {
      id: "assignment_linked_list_reverse",
      title: "单链表反转",
      question: "请实现单链表反转，并说明算法的时间复杂度和空间复杂度。",
      deadline: new Date("2026-07-27T15:59:00.000Z"),
      instructions: "请使用伪代码或任意编程语言作答，并说明关键指针变化及边界情况。",
      status: "published",
      createdById: teacher.id,
    },
  });

  await Promise.all(
    students.map((student, index) =>
      prisma.submission.upsert({
        where: {
          assignmentId_studentId: {
            assignmentId: linkedListAssignment.id,
            studentId: student.id,
          },
        },
        update: {},
        create: {
          assignmentId: linkedListAssignment.id,
          studentId: student.id,
          answer: linkedListAnswers[index],
          status: "submitted",
        },
      }),
    ),
  );

  const officialAssignment = await prisma.assignment.upsert({
    where: { id: "assignment_csc3100_pascal_triangle_full_class" },
    update: {
      title: "CSC3100 Assignment 1：杨辉三角（全班）",
      question:
        "实现 generate(numRows: int)，返回杨辉三角的前 numRows 行；1 ≤ numRows ≤ 20。",
      deadline: new Date("2026-06-30T15:59:00.000Z"),
      instructions:
        "官方数据集：LeetCode 118，Python 3.11。代码测试 20 例，占 50 分；报告占 50 分，覆盖算法说明、正确性、复杂度、实现与示例、表达与原创性。",
      status: "published",
      createdById: teacher.id,
    },
    create: {
      id: "assignment_csc3100_pascal_triangle_full_class",
      title: "CSC3100 Assignment 1：杨辉三角（全班）",
      question:
        "实现 generate(numRows: int)，返回杨辉三角的前 numRows 行；1 ≤ numRows ≤ 20。",
      deadline: new Date("2026-06-30T15:59:00.000Z"),
      instructions:
        "官方数据集：LeetCode 118，Python 3.11。代码测试 20 例，占 50 分；报告占 50 分，覆盖算法说明、正确性、复杂度、实现与示例、表达与原创性。",
      status: "published",
      createdById: teacher.id,
    },
  });

  const officialStudents = await Promise.all(
    officialSubmissions.map((sample) =>
      prisma.user.upsert({
        where: { username: sample.username },
        update: { displayName: sample.displayName, role: "student" },
        create: {
          id: sample.id,
          username: sample.username,
          displayName: sample.displayName,
          role: "student",
        },
      }),
    ),
  );

  await Promise.all(
    officialSubmissions.map((sample, index) =>
      prisma.submission.upsert({
        where: {
          assignmentId_studentId: {
            assignmentId: officialAssignment.id,
            studentId: officialStudents[index].id,
          },
        },
        update: {},
        create: {
          assignmentId: officialAssignment.id,
          studentId: officialStudents[index].id,
          answer: `代码实现:\n${sample.code}\n\n报告:\n${sample.report}`,
          status: "submitted",
        },
      }),
    ),
  );

  console.log(
    "Seeded linked-list demo and CSC3100 Pascal's Triangle official-data demo.",
  );
}

main()
  .catch((error) => {
    console.error("Failed to seed database:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
