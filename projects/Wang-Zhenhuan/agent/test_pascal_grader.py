import unittest

from models import AssignmentInput, EvaluationRequest, SubmissionInput
from pascal_grader import evaluate_pascal_submission, run_pascal_tests


CORRECT_CODE = """def generate(numRows: int) -> list[list[int]]:
    triangle = []
    for row_index in range(numRows):
        row = [1] * (row_index + 1)
        for column in range(1, row_index):
            row[column] = triangle[row_index - 1][column - 1] + triangle[row_index - 1][column]
        triangle.append(row)
    return triangle
"""

PARTIAL_CODE = """def generate(numRows: int) -> list[list[int]]:
    rows = [[1]]
    for row_index in range(1, min(numRows, 5)):
        previous = rows[-1]
        rows.append([1] + [previous[i - 1] + previous[i] for i in range(1, row_index)] + [1])
    return rows
"""

WRONG_CODE = """def generate(numRows: int) -> list[list[int]]:
    rows = [[1]]
    for row_index in range(1, numRows):
        previous = rows[-1]
        rows.append([0] + [previous[i - 1] + previous[i] for i in range(1, row_index)] + [0])
    return rows
"""

STRONG_REPORT = """Implementation Summary
The solution builds the triangle from top to bottom. Every row starts and ends with 1;
each interior value is computed from the two adjacent values in the previous row.
Correctness Reasoning
Correctness follows by induction. The base row is [1]. Assuming the previous row is
correct, Pascal's identity constructs every interior value while boundaries remain 1.
Complexity Analysis
For numRows = n, time complexity is O(n^2), output space is O(n^2), and extra working
space excluding the output is O(1).
Testing and Reflection
For row index 4, [1, 3, 3, 1] produces [1, 4, 6, 4, 1]. I tested n = 1, 2, 5 and 20.
Assistance Declaration
I used course notes and the published problem statement.
"""

PARTIAL_REPORT = """Implementation Summary
The intended dynamic programming approach stores completed rows and derives the next row from adjacent entries.
Correctness Reasoning
The invariant is that all rows already stored are correct. The next row preserves boundary values and applies Pascal's identity to its interior.
Complexity Analysis
The intended complexity is O(n^2) time and O(n^2) output space.
Testing and Reflection
A useful test set includes n = 1, n = 2, n = 5, and a larger value. My current implementation may still need additional boundary validation.
Assistance Declaration
I used the course notes and public examples.
"""

WEAK_REPORT = """Implementation Summary
I construct each new row using the previous row. The first and last values are one, and the middle values are sums.
Correctness Reasoning
This works because Pascal's Triangle follows the addition rule. I checked the public examples.
Complexity Analysis
The time complexity is O(n^2). The program stores the output triangle.
Testing and Reflection
The implementation uses loops and returns the completed list. More edge-case testing could be added.
Assistance Declaration
I used the published problem statement.
"""


def request_for(code: str, report: str = STRONG_REPORT) -> EvaluationRequest:
    return EvaluationRequest(
        assignment=AssignmentInput(
            title="CSC3100 Assignment 1：杨辉三角",
            question="实现 generate(numRows)，返回杨辉三角前 numRows 行。",
            instructions="LeetCode 118; 20 tests; code 50 + report 50.",
        ),
        submission=SubmissionInput(
            student="test-student",
            answer=f"代码实现:\n{code}\n报告:\n{report}",
        ),
    )


class PascalGraderTests(unittest.TestCase):
    def test_official_twenty_cases(self) -> None:
        self.assertEqual(run_pascal_tests(CORRECT_CODE), (20, [], None))
        self.assertEqual(run_pascal_tests(PARTIAL_CODE)[0], 5)
        self.assertEqual(run_pascal_tests(WRONG_CODE)[0], 1)

    def test_standard_report_shape_and_evidence(self) -> None:
        report, evidence = evaluate_pascal_submission(request_for(CORRECT_CODE))

        self.assertEqual(report.correctness.level, "correct")
        self.assertEqual(evidence["code_tests_passed"], 20)
        self.assertEqual(evidence["code_tests_total"], 20)
        self.assertGreaterEqual(report.score, 90)
        self.assertEqual(report.grade, "A")

    def test_representative_scores_match_official_dataset(self) -> None:
        partial, partial_evidence = evaluate_pascal_submission(
            request_for(PARTIAL_CODE, PARTIAL_REPORT),
        )
        wrong, wrong_evidence = evaluate_pascal_submission(
            request_for(WRONG_CODE, WEAK_REPORT),
        )

        self.assertEqual(partial_evidence["suggested_total"], 55.5)
        self.assertEqual(partial.score, 56)
        self.assertEqual(wrong_evidence["suggested_total"], 31.5)
        self.assertEqual(wrong.score, 32)


if __name__ == "__main__":
    unittest.main()
