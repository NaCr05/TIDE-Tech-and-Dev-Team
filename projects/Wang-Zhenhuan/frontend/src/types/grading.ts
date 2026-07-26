export type EvaluationStatus =
  | "generated"
  | "confirmed"
  | "modified"
  | "regrading"
  | "failed";

export interface Assignment {
  id: string;
  title: string;
  question: string;
  deadline: string;
  instructions: string | null;
  status: "published" | "closed";
  createdBy: {
    id: string;
    username: string;
    displayName: string;
  };
  _count: {
    submissions: number;
  };
}

export interface Evaluation {
  id: string;
  completenessLevel: "complete" | "partial" | "incomplete";
  completenessComment: string;
  correctnessLevel:
    | "correct"
    | "mostly_correct"
    | "partially_correct"
    | "incorrect"
    | "uncertain";
  correctnessComment: string;
  mainProblems: string[];
  suggestions: string[];
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  status: EvaluationStatus;
  version: number;
  reviewedById: string | null;
  reviewedAt: string | null;
}

export interface Submission {
  id: string;
  answer: string;
  status: "submitted" | "evaluating" | "evaluated" | "failed";
  submittedAt: string;
  student: {
    id: string;
    username: string;
    displayName: string;
  };
  evaluation: Evaluation | null;
}

export interface SubmissionSummary {
  assignment: {
    id: string;
    title: string;
  };
  count: number;
  submissions: Submission[];
}

export type EvaluationAuditAction =
  | "baseline"
  | "generated"
  | "regraded"
  | "confirmed"
  | "modified";

export interface EvaluationAudit {
  id: string;
  evaluationId: string | null;
  submissionId: string;
  action: EvaluationAuditAction;
  version: number;
  snapshot: unknown;
  actorId: string | null;
  actor: {
    id: string;
    username: string;
    displayName: string;
  } | null;
  createdAt: string;
}

export interface EvaluationAuditResponse {
  submissionId: string;
  count: number;
  audits: EvaluationAudit[];
}
