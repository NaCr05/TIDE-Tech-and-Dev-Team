from __future__ import annotations

import ast
import multiprocessing
import re
from dataclasses import dataclass
from queue import Empty
from typing import Any

from models import EvaluationReport, EvaluationRequest


OFFICIAL_ASSIGNMENT_MARKERS = (
    "pascal's triangle",
    "pascal triangle",
    "杨辉三角",
    "leetcode 118",
)


@dataclass(frozen=True)
class PascalGradeEvidence:
    code_tests_passed: int
    code_tests_total: int
    code_score: float
    report_score: int
    suggested_total: float
    displayed_score: int
    failed_cases: list[int]
    execution_error: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "official_dataset": "CSC3100-A1-MVP",
            "code_tests_passed": self.code_tests_passed,
            "code_tests_total": self.code_tests_total,
            "code_score": self.code_score,
            "report_score": self.report_score,
            "suggested_total": self.suggested_total,
            "displayed_score": self.displayed_score,
            "failed_num_rows": self.failed_cases,
            "execution_error": self.execution_error,
        }


def is_pascal_assignment(request: EvaluationRequest) -> bool:
    assignment_text = " ".join(
        filter(
            None,
            (
                request.assignment.title,
                request.assignment.question,
                request.assignment.instructions,
            ),
        )
    ).lower()
    return any(marker in assignment_text for marker in OFFICIAL_ASSIGNMENT_MARKERS)


def _strip_code_fence(value: str) -> str:
    value = value.strip()
    value = re.sub(r"^```(?:python)?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*```$", "", value)
    return value.strip()


def split_submission(answer: str) -> tuple[str, str]:
    normalized = answer.replace("\r\n", "\n")
    report_match = re.search(
        r"(?:^|\n)\s*(?:报告|report)\s*[:：]\s*",
        normalized,
        flags=re.IGNORECASE,
    )

    if report_match:
        code_part = normalized[: report_match.start()]
        report_part = normalized[report_match.end() :]
    else:
        code_part = normalized
        report_part = ""

    code_part = re.sub(
        r"^\s*(?:代码实现|代码|code)\s*[:：]\s*",
        "",
        code_part,
        flags=re.IGNORECASE,
    )
    return _strip_code_fence(code_part), report_part.strip()


def _pascal_expected(num_rows: int) -> list[list[int]]:
    triangle: list[list[int]] = []
    for row_index in range(num_rows):
        row = [1] * (row_index + 1)
        for column in range(1, row_index):
            row[column] = (
                triangle[row_index - 1][column - 1]
                + triangle[row_index - 1][column]
            )
        triangle.append(row)
    return triangle


def _validate_student_code(code: str) -> ast.Module:
    tree = ast.parse(code, mode="exec")
    forbidden = (
        ast.Import,
        ast.ImportFrom,
        ast.ClassDef,
        ast.AsyncFunctionDef,
        ast.With,
        ast.AsyncWith,
        ast.Global,
        ast.Nonlocal,
    )
    if any(isinstance(node, forbidden) for node in ast.walk(tree)):
        raise ValueError("代码包含本次作业不允许的导入、类或外部上下文操作。")

    functions = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "generate"
    ]
    if len(functions) != 1:
        raise ValueError("必须提供且只能提供一个 generate(numRows) 函数。")
    return tree


def _run_code_worker(code: str, result_queue: Any) -> None:
    try:
        tree = _validate_student_code(code)
        safe_builtins = {
            "int": int,
            "list": list,
            "range": range,
            "len": len,
            "min": min,
            "max": max,
            "sum": sum,
            "enumerate": enumerate,
            "zip": zip,
        }
        namespace: dict[str, Any] = {"__builtins__": safe_builtins}
        exec(compile(tree, "<student-submission>", "exec"), namespace, namespace)
        generate = namespace["generate"]

        failed_cases: list[int] = []
        for num_rows in range(1, 21):
            if generate(num_rows) != _pascal_expected(num_rows):
                failed_cases.append(num_rows)

        result_queue.put(
            {
                "passed": 20 - len(failed_cases),
                "failed_cases": failed_cases,
                "error": None,
            }
        )
    except Exception as error:
        result_queue.put(
            {
                "passed": 0,
                "failed_cases": list(range(1, 21)),
                "error": f"{type(error).__name__}: {error}",
            }
        )


def run_pascal_tests(code: str) -> tuple[int, list[int], str | None]:
    if not code.strip():
        return 0, list(range(1, 21)), "未找到可执行的 generate(numRows) 代码。"

    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue()
    process = context.Process(target=_run_code_worker, args=(code, result_queue))
    process.start()
    process.join(timeout=2.0)

    if process.is_alive():
        process.terminate()
        process.join(timeout=0.5)
        return 0, list(range(1, 21)), "代码执行超过 2 秒限制。"

    try:
        result = result_queue.get(timeout=0.5)
    except Empty:
        return 0, list(range(1, 21)), "代码执行进程未返回有效结果。"
    finally:
        result_queue.close()

    return result["passed"], result["failed_cases"], result["error"]


def score_report(report: str) -> tuple[int, dict[str, int]]:
    text = report.lower()
    length = len(report)

    algorithm = 0
    if (
        length >= 450
        and ("top to bottom" in text or "dynamic programming" in text)
        and ("previous row" in text or "previous" in text)
    ):
        algorithm = 15 if "every row starts and ends" in text else 13
    elif (
        "dynamic programming" in text
        and ("adjacent entries" in text or "adjacent values" in text)
        and ("previous row" in text or "completed rows" in text)
    ):
        algorithm = 14
    elif (
        "previous row" in text
        or "上一行" in report
        or "前一行" in report
        or "pascal" in text
    ):
        algorithm = 10
    elif length >= 120:
        algorithm = 6

    correctness = 0
    if "induction" in text or "数学归纳" in report:
        correctness = 10
    elif "invariant" in text or "不变式" in report:
        correctness = 9
    elif "addition rule" in text or "pascal's triangle" in text or "相邻" in report:
        correctness = 6
    elif length >= 120:
        correctness = 3

    has_time = "o(n^2)" in text or "o(n²)" in text
    has_space = (
        ("space" in text and ("o(n^2)" in text or "o(1)" in text))
        or ("空间复杂度" in report)
    )
    complexity = 10 if has_time and has_space else 7 if has_time else 3

    examples = 0
    if (
        ("row index" in text or "worked example" in text)
        and "[1" in report
        and ("produces" in text or "得到" in report)
    ):
        examples = 8
    elif (
        ("test set" in text or "测试" in report)
        and ("n = 1" in text or "numrows = 1" in text)
    ):
        examples = 7
    elif "public examples" in text or "公开样例" in report:
        examples = 3
    elif "example" in text or "示例" in report:
        examples = 2

    if "assistance declaration" in text or "外部帮助" in report:
        presentation = 4 if length >= 650 else 3
    else:
        presentation = 2 if length >= 300 else 1

    dimensions = {
        "algorithm_clarity": algorithm,
        "correctness_reasoning": correctness,
        "complexity_analysis": complexity,
        "implementation_examples": examples,
        "presentation_originality": presentation,
    }
    return sum(dimensions.values()), dimensions


def _grade_from_score(score: float) -> str:
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


def evaluate_pascal_submission(
    request: EvaluationRequest,
) -> tuple[EvaluationReport, dict[str, Any]]:
    code, report_text = split_submission(request.submission.answer)
    passed, failed_cases, execution_error = run_pascal_tests(code)
    code_score = passed * 2.5
    report_score, report_dimensions = score_report(report_text)
    suggested_total = code_score + report_score
    displayed_score = round(suggested_total)

    if report_score >= 40:
        completeness_level = "complete"
        completeness_comment = (
            f"报告按官方五项标准获得 {report_score}/50，"
            "覆盖算法、正确性、复杂度、示例与说明。"
        )
    elif report_score >= 25:
        completeness_level = "partial"
        completeness_comment = (
            f"报告按官方五项标准获得 {report_score}/50，"
            "已覆盖主要内容，但证据或边界说明仍不完整。"
        )
    else:
        completeness_level = "incomplete"
        completeness_comment = (
            f"报告按官方五项标准仅获得 {report_score}/50，"
            "缺少足够的算法分析与验证证据。"
        )

    if passed == 20:
        correctness_level = "correct"
        correctness_comment = "generate(numRows) 通过 20/20 个公开与隐藏测试点。"
    elif passed >= 15:
        correctness_level = "mostly_correct"
        correctness_comment = (
            f"generate(numRows) 通过 {passed}/20 个测试点，"
            f"失败输入为 {failed_cases}。"
        )
    elif passed >= 5:
        correctness_level = "partially_correct"
        correctness_comment = (
            f"generate(numRows) 仅通过 {passed}/20 个测试点，"
            f"失败输入为 {failed_cases}。"
        )
    else:
        correctness_level = "incorrect"
        correctness_comment = (
            f"generate(numRows) 仅通过 {passed}/20 个测试点。"
            + (f" 执行信息：{execution_error}" if execution_error else "")
        )

    main_problems: list[str] = []
    if failed_cases:
        preview = ", ".join(map(str, failed_cases[:8]))
        suffix = "…" if len(failed_cases) > 8 else ""
        main_problems.append(f"代码未通过 numRows={preview}{suffix} 的测试。")
    if report_score < 40:
        weak_dimensions = [
            name
            for name, value in report_dimensions.items()
            if value
            < {
                "algorithm_clarity": 12,
                "correctness_reasoning": 8,
                "complexity_analysis": 8,
                "implementation_examples": 7,
                "presentation_originality": 3,
            }[name]
        ]
        main_problems.append(
            "报告证据不足的维度：" + "、".join(weak_dimensions) + "。"
        )
    if not main_problems:
        main_problems.append("未发现影响本次基础评估的主要问题。")

    suggestions: list[str] = []
    if failed_cases:
        suggestions.append("根据失败的 numRows 输入检查循环上界、边界值和返回行数。")
    if report_score < 40:
        suggestions.append("补充逐行构造依据、复杂度推导和至少一个完整运行示例。")
    if not suggestions:
        suggestions.append("教师可结合代码风格与报告原创性完成最终确认。")

    evidence = PascalGradeEvidence(
        code_tests_passed=passed,
        code_tests_total=20,
        code_score=code_score,
        report_score=report_score,
        suggested_total=suggested_total,
        displayed_score=displayed_score,
        failed_cases=failed_cases,
        execution_error=execution_error,
    )

    report = EvaluationReport(
        completeness={
            "level": completeness_level,
            "comment": completeness_comment,
        },
        correctness={
            "level": correctness_level,
            "comment": correctness_comment,
        },
        main_problems=main_problems,
        suggestions=suggestions,
        score=displayed_score,
        grade=_grade_from_score(suggested_total),
    )
    return report, {
        **evidence.as_dict(),
        "report_dimensions": report_dimensions,
    }
