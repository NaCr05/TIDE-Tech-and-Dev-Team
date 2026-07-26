"""Import and evaluate every format-valid submission in the official dataset.

The script is intentionally separate from the normal seed:
- the concise three-submission demo stays unchanged;
- the full class is placed under a separate assignment;
- invalid and missing records are excluded;
- the one format-valid late submission is imported without an automatic penalty.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import zipfile
from datetime import datetime
from io import BytesIO
from pathlib import Path

import psycopg
import requests
from pypdf import PdfReader


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = PROJECT_ROOT / "submission"
ASSIGNMENT_ID = "assignment_csc3100_pascal_triangle_full_class"


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8-sig").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def extract_archive(archive_path: Path) -> tuple[str, str]:
    with zipfile.ZipFile(archive_path) as archive:
        code_names = [
            name for name in archive.namelist() if Path(name).name == "代码实现.txt"
        ]
        report_names = [
            name for name in archive.namelist() if Path(name).name == "报告.pdf"
        ]
        if len(code_names) != 1 or len(report_names) != 1:
            raise ValueError("archive must contain one 代码实现.txt and one 报告.pdf")

        code = archive.read(code_names[0]).decode("utf-8-sig").strip()
        reader = PdfReader(BytesIO(archive.read(report_names[0])))
        report = "\n".join((page.extract_text() or "").strip() for page in reader.pages)
        report = report.strip()
        if not code or not report:
            raise ValueError("code or report text is empty")
        return code, report


def grade_for_score(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-evaluate existing submissions (this increases evaluation versions).",
    )
    args = parser.parse_args()

    manifest_path = DATASET_ROOT / "submission_manifest.json"
    expected_path = DATASET_ROOT / "expected_grades.json"
    roster_path = DATASET_ROOT / "class_roster.csv"
    if not all(path.exists() for path in (manifest_path, expected_path, roster_path)):
        print(f"Official dataset is incomplete under: {DATASET_ROOT}", file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    expected_rows = json.loads(expected_path.read_text(encoding="utf-8-sig"))
    expected = {row["student_id"]: row for row in expected_rows}
    with roster_path.open(encoding="utf-8-sig", newline="") as file:
        roster = {row["student_id"]: row for row in csv.DictReader(file)}

    valid_students = [
        row
        for row in manifest["students"]
        if row["submission_state"] == "submitted" and row["format_state"] == "valid"
    ]

    env = load_env()
    database_url = os.getenv("DATABASE_URL") or (
        f"postgresql://{env.get('POSTGRES_USER', 'postgres')}:"
        f"{env.get('POSTGRES_PASSWORD', 'password')}@localhost:"
        f"{env.get('POSTGRES_PORT', '5434')}/{env.get('POSTGRES_DB', 'tide_final')}"
    )
    backend_url = os.getenv(
        "BACKEND_URL", f"http://localhost:{env.get('BACKEND_PORT', '3001')}"
    ).rstrip("/")

    try:
        health = requests.get(f"{backend_url}/health", timeout=5)
        health.raise_for_status()
    except requests.RequestException as error:
        print(f"Backend is unavailable at {backend_url}: {error}", file=sys.stderr)
        return 1

    imported: list[tuple[str, str, str, str]] = []
    with psycopg.connect(database_url, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT "id" FROM "User" WHERE "username" = %s AND "role" = %s',
                ("teacher01", "teacher"),
            )
            teacher = cursor.fetchone()
            if not teacher:
                print("teacher01 is missing; run the normal seed first.", file=sys.stderr)
                return 1

            cursor.execute(
                """
                INSERT INTO "Assignment"
                    ("id", "title", "question", "deadline", "instructions",
                     "status", "createdById", "createdAt", "updatedAt")
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                ON CONFLICT ("id") DO UPDATE SET
                    "title" = EXCLUDED."title",
                    "question" = EXCLUDED."question",
                    "deadline" = EXCLUDED."deadline",
                    "instructions" = EXCLUDED."instructions",
                    "status" = EXCLUDED."status",
                    "updatedAt" = NOW()
                """,
                (
                    ASSIGNMENT_ID,
                    "CSC3100 Assignment 1：杨辉三角（全班）",
                    "实现 generate(numRows: int)，返回杨辉三角的前 numRows 行；"
                    "1 ≤ numRows ≤ 20。",
                    datetime.fromisoformat(manifest["deadline"]),
                    "官方全班数据。Python 3.11；20个代码测试占50分；"
                    "报告按算法说明、正确性、复杂度、实现与示例、表达与原创性占50分。",
                    "published",
                    teacher[0],
                ),
            )

            for item in valid_students:
                student_id = item["student_id"]
                roster_row = roster[student_id]
                archive_path = DATASET_ROOT / item["archive"]
                try:
                    code, report = extract_archive(archive_path)
                except Exception as error:
                    print(f"{student_id}: cannot extract archive: {error}", file=sys.stderr)
                    return 1

                username = f"csc3100_{student_id}"
                cursor.execute(
                    """
                    INSERT INTO "User"
                        ("id", "username", "displayName", "email", "role",
                         "createdAt", "updatedAt")
                    VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT ("username") DO UPDATE SET
                        "displayName" = EXCLUDED."displayName",
                        "email" = EXCLUDED."email",
                        "role" = EXCLUDED."role",
                        "updatedAt" = NOW()
                    RETURNING "id"
                    """,
                    (
                        f"official_student_{student_id}",
                        username,
                        f"{roster_row['name']}（{student_id}）",
                        roster_row["email"],
                        "student",
                    ),
                )
                system_student_id = cursor.fetchone()[0]
                answer = f"代码实现:\n{code}\n\n报告:\n{report}"
                submission_id = f"official_full_submission_{student_id}"
                cursor.execute(
                    """
                    INSERT INTO "Submission"
                        ("id", "assignmentId", "studentId", "answer", "status",
                         "submittedAt", "createdAt", "updatedAt")
                    VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT ("assignmentId", "studentId") DO UPDATE SET
                        "answer" = EXCLUDED."answer",
                        "submittedAt" = EXCLUDED."submittedAt",
                        "updatedAt" = NOW()
                    RETURNING "id"
                    """,
                    (
                        submission_id,
                        ASSIGNMENT_ID,
                        system_student_id,
                        answer,
                        "submitted",
                        datetime.fromisoformat(item["submitted_at"]),
                    ),
                )
                submission_id = cursor.fetchone()[0]
                cursor.execute(
                    'SELECT "score", "grade" FROM "Evaluation" WHERE "submissionId" = %s',
                    (submission_id,),
                )
                current_evaluation = cursor.fetchone()

                if current_evaluation and not args.force:
                    actual_score, actual_grade = current_evaluation
                    source = "existing"
                else:
                    response = requests.post(
                        f"{backend_url}/submissions/{submission_id}/evaluate",
                        timeout=15,
                    )
                    response.raise_for_status()
                    payload = response.json()["evaluation"]
                    actual_score, actual_grade = payload["score"], payload["grade"]
                    source = "evaluated"

                official_score = round(expected[student_id]["suggested_total"])
                imported.append(
                    (
                        student_id,
                        f"{actual_score}/{actual_grade}",
                        f"{official_score}/{grade_for_score(official_score)}",
                        source,
                    )
                )

    print(f"Imported assignment: {ASSIGNMENT_ID}")
    print(f"Frontend: http://localhost:{env.get('FRONTEND_PORT', '5173')}")
    print()
    print("student    current Agent  official reference  source")
    print("---------  -------------  ------------------  ---------")
    for student_id, actual, official, source in imported:
        print(f"{student_id:<9}  {actual:<13}  {official:<18}  {source}")
    print()
    print(f"Result: {len(imported)}/{len(valid_students)} valid submissions available.")
    print("Note: official reference is shown for comparison; the UI stores current Agent results.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
