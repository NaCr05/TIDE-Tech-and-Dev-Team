from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


CompletenessLevel = Literal["complete", "partial", "incomplete"]
CorrectnessLevel = Literal[
    "correct",
    "mostly_correct",
    "partially_correct",
    "incorrect",
    "uncertain",
]
Grade = Literal["A", "B", "C", "D", "F"]


class AssignmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1)
    question: str = Field(min_length=1)
    instructions: str | None = None


class SubmissionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    student: str = Field(min_length=1)
    answer: str = Field(min_length=1)


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignment: AssignmentInput
    submission: SubmissionInput
    rubric: str | None = None


class DimensionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    level: str = Field(min_length=1)
    comment: str = Field(min_length=1)


class CompletenessResult(DimensionResult):
    level: CompletenessLevel


class CorrectnessResult(DimensionResult):
    level: CorrectnessLevel


class EvaluationReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completeness: CompletenessResult
    correctness: CorrectnessResult
    main_problems: list[str] = Field(min_length=1)
    suggestions: list[str] = Field(min_length=1)
    score: int = Field(ge=0, le=100)
    grade: Grade

    @field_validator("main_problems", "suggestions")
    @classmethod
    def clean_list(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if value.strip()]
        if not cleaned:
            raise ValueError("At least one non-empty item is required.")
        return cleaned


class EvaluationResponse(EvaluationReport):
    provider: Literal["mock", "deepseek"]
    attempts: int = Field(ge=1, le=2)
    raw_output: str
