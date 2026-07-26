from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = PROJECT_ROOT / "submission"
AGENT_ROOT = PROJECT_ROOT / "agent"
sys.path.insert(0, str(AGENT_ROOT))

from pascal_grader import run_pascal_tests  # noqa: E402


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_code_from_archive(archive_path: Path) -> str:
    with zipfile.ZipFile(archive_path) as archive:
        candidates = [
            entry
            for entry in archive.infolist()
            if not entry.is_dir() and entry.filename.lower().endswith(".txt")
        ]
        if len(candidates) != 1:
            raise ValueError(
                f"expected exactly one code .txt file, found {len(candidates)}",
            )
        return archive.read(candidates[0]).decode("utf-8-sig")


def main() -> int:
    required = [
        DATASET_ROOT / "submission_manifest.json",
        DATASET_ROOT / "expected_grades.json",
        DATASET_ROOT / "testcases" / "public_cases.json",
        DATASET_ROOT / "testcases" / "hidden_cases.json",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        print("Official dataset is incomplete:")
        for path in missing:
            print(f"  - {path}")
        return 1

    manifest = load_json(required[0])
    expected = {
        item["student_id"]: item for item in load_json(required[1])
    }
    public_cases = load_json(required[2])
    hidden_cases = load_json(required[3])
    all_cases = public_cases + hidden_cases

    case_rows = sorted(case["numRows"] for case in all_cases)
    structure_checks = {
        "registered students": manifest["registered_students"] == 20,
        "uploaded submissions": manifest["uploaded_submissions"] == 19,
        "valid submissions": manifest["format_valid_submissions"] == 16,
        "invalid submissions": manifest["format_invalid_submissions"] == 3,
        "late submissions": manifest["late_submissions"] == 1,
        "missing submissions": manifest["missing_submissions"] == 1,
        "public tests": len(public_cases) == 3,
        "hidden tests": len(hidden_cases) == 17,
        "test inputs 1..20": case_rows == list(range(1, 21)),
    }

    print("Official dataset structure")
    for label, passed in structure_checks.items():
        print(f"  {'PASS' if passed else 'FAIL':4}  {label}")

    valid_students = [
        item
        for item in manifest["students"]
        if item["submission_state"] == "submitted"
        and item["format_state"] == "valid"
    ]

    print("\nCode execution against 20 official cases")
    print("student    actual  expected  result")
    print("---------  ------  --------  ------")

    mismatches: list[str] = []
    for student in valid_students:
        student_id = student["student_id"]
        archive_path = DATASET_ROOT / student["archive"]
        try:
            code = read_code_from_archive(archive_path)
            actual_passed, failed_rows, error = run_pascal_tests(code)
            expected_passed = expected[student_id]["code_tests_passed"]
            matched = actual_passed == expected_passed
            if not matched:
                detail = (
                    f"{student_id}: actual {actual_passed}, "
                    f"expected {expected_passed}, failed={failed_rows}, error={error}"
                )
                mismatches.append(detail)
            print(
                f"{student_id}  {actual_passed:>2}/20   "
                f"{expected_passed:>2}/20     "
                f"{'PASS' if matched else 'FAIL'}",
            )
        except Exception as error:
            mismatches.append(f"{student_id}: {type(error).__name__}: {error}")
            print(f"{student_id}   ERROR    --       FAIL")

    structure_ok = all(structure_checks.values())
    execution_ok = not mismatches and len(valid_students) == 16

    print("\nSummary")
    print(f"  Dataset structure: {'PASS' if structure_ok else 'FAIL'}")
    print(
        f"  Code expectations: {'PASS' if execution_ok else 'FAIL'} "
        f"({len(valid_students)}/16 valid archives checked)",
    )
    print(
        "  Report rubric: represented in grading_rubric.json; "
        "three representative reports are covered by agent/test_pascal_grader.py",
    )

    if mismatches:
        print("\nMismatches")
        for mismatch in mismatches:
            print(f"  - {mismatch}")

    return 0 if structure_ok and execution_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
