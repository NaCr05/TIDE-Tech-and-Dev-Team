import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from openai import OpenAI
from pydantic import ValidationError

from models import EvaluationReport, EvaluationRequest, EvaluationResponse
from pascal_grader import evaluate_pascal_submission, is_pascal_assignment
from prompts import SYSTEM_PROMPT, build_user_prompt


load_dotenv()

app = FastAPI(title="TIDE Evaluation Agent", version="1.0.0")


def mock_evaluate(
    request: EvaluationRequest,
) -> tuple[EvaluationReport, dict[str, object]]:
    if is_pascal_assignment(request):
        return evaluate_pascal_submission(request)

    answer = request.submission.answer.lower()

    if all(keyword in answer for keyword in ("prev", "current", "next", "o(n)", "o(1)")):
        return EvaluationReport(
            completeness={
                "level": "complete",
                "comment": "答案覆盖了核心算法、复杂度和边界情况。",
            },
            correctness={
                "level": "correct",
                "comment": "三指针迭代思路正确，指针更新顺序合理。",
            },
            main_problems=["当前为文本静态评估，尚未实际编译或运行代码。"],
            suggestions=["补充可执行代码以及空链表、单节点链表测试。"],
            score=95,
            grade="A",
        ), {"strategy": "linked_list_mock"}

    if "next" in answer and ("前一个" in answer or "previous" in answer):
        return EvaluationReport(
            completeness={
                "level": "partial",
                "comment": "描述了反转方向和时间复杂度，但缺少完整步骤与空间复杂度。",
            },
            correctness={
                "level": "mostly_correct",
                "comment": "总体方向正确，但没有说明如何保存原 next 指针。",
            },
            main_problems=["缺少防止后续链表丢失的临时指针说明。"],
            suggestions=["写出 prev、current、next 的完整更新顺序，并补充空间复杂度。"],
            score=76,
            grade="C",
        ), {"strategy": "linked_list_mock"}

    if "排序" in request.submission.answer or "sort" in answer:
        return EvaluationReport(
            completeness={
                "level": "incomplete",
                "comment": "答案没有给出链表指针反转过程或复杂度分析。",
            },
            correctness={
                "level": "incorrect",
                "comment": "排序节点值不等同于反转链表结构。",
            },
            main_problems=["混淆了值排序与链表节点连接方向反转。"],
            suggestions=["从修改每个节点 next 指针的方向重新思考。"],
            score=20,
            grade="F",
        ), {"strategy": "linked_list_mock"}

    return EvaluationReport(
        completeness={
            "level": "partial",
            "comment": "答案包含部分描述，但无法确认是否覆盖全部要求。",
        },
        correctness={
            "level": "uncertain",
            "comment": "现有信息不足以稳定判断算法是否正确。",
        },
        main_problems=["关键算法步骤或复杂度分析不够明确。"],
        suggestions=["补充伪代码、关键指针变化和复杂度说明。"],
        score=55,
        grade="F",
    ), {"strategy": "generic_mock"}


def live_evaluate(request: EvaluationRequest) -> tuple[EvaluationReport, str, int]:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise ValueError("DEEPSEEK_API_KEY is required when AGENT_MODE=live.")

    client = OpenAI(
        api_key=api_key,
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
    )
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro")
    retry_error: str | None = None
    last_raw_output = ""

    for attempt in range(1, 3):
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(request, retry_error)},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=1200,
        )
        last_raw_output = response.choices[0].message.content or ""

        try:
            report = EvaluationReport.model_validate_json(last_raw_output)
            return report, last_raw_output, attempt
        except ValidationError as error:
            retry_error = str(error)

    raise ValueError(f"Model output failed validation twice: {last_raw_output}")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": os.getenv("AGENT_MODE", "mock")}


@app.post("/evaluate", response_model=EvaluationResponse)
def evaluate(request: EvaluationRequest) -> EvaluationResponse:
    mode = os.getenv("AGENT_MODE", "mock").lower()

    try:
        if mode == "mock":
            report, evidence = mock_evaluate(request)
            raw_output = json.dumps(
                {
                    "report": report.model_dump(),
                    "evidence": evidence,
                },
                ensure_ascii=False,
            )
            return EvaluationResponse(
                **report.model_dump(),
                provider="mock",
                attempts=1,
                raw_output=raw_output,
            )

        if mode == "live":
            report, raw_output, attempts = live_evaluate(request)
            return EvaluationResponse(
                **report.model_dump(),
                provider="deepseek",
                attempts=attempts,
                raw_output=raw_output,
            )

        raise ValueError("AGENT_MODE must be mock or live.")
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
