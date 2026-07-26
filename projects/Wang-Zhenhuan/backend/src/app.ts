import cors from "cors";
import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import express from "express";
import { logError, logInfo, logWarn } from "./logger";
import { prisma } from "./prisma";

export const app = express();

const frontendOrigin =
  process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: frontendOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((request, response, next) => {
  const incomingRequestId = request.header("x-request-id");
  const requestId = isNonEmptyString(incomingRequestId)
    ? incomingRequestId
    : randomUUID();
  const startedAt = performance.now();

  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);

  response.on("finish", () => {
    const shouldLogHealth =
      process.env.LOG_HEALTH_REQUESTS?.toLowerCase() === "true";

    if (
      (request.path === "/health" || request.path === "/metrics") &&
      !shouldLogHealth
    ) {
      return;
    }

    logInfo("http.request.completed", {
      requestId,
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      remoteAddress: request.ip,
    });
  });

  next();
});

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sendServerError(
  response: express.Response,
  message: string,
  error: unknown,
) {
  const requestId = response.locals.requestId as string | undefined;
  logError("http.request.failed", error, { requestId, message });
  response.status(500).json({ message, requestId });
}

type AgentEvaluationResponse = {
  completeness: {
    level: "complete" | "partial" | "incomplete";
    comment: string;
  };
  correctness: {
    level:
      | "correct"
      | "mostly_correct"
      | "partially_correct"
      | "incorrect"
      | "uncertain";
    comment: string;
  };
  main_problems: string[];
  suggestions: string[];
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  provider: "mock" | "deepseek";
  attempts: number;
  raw_output: string;
};

type EvaluationAuditAction = "generated" | "regraded";

function isAgentEvaluationResponse(
  value: unknown,
): value is AgentEvaluationResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<AgentEvaluationResponse>;

  return (
    typeof result.completeness?.level === "string" &&
    typeof result.completeness.comment === "string" &&
    typeof result.correctness?.level === "string" &&
    typeof result.correctness.comment === "string" &&
    Array.isArray(result.main_problems) &&
    Array.isArray(result.suggestions) &&
    typeof result.score === "number" &&
    result.score >= 0 &&
    result.score <= 100 &&
    typeof result.grade === "string" &&
    typeof result.provider === "string" &&
    typeof result.attempts === "number" &&
    typeof result.raw_output === "string"
  );
}

async function runEvaluation(
  submissionId: string,
  auditAction: EvaluationAuditAction = "generated",
  actorId: string | null = null,
) {
  const startedAt = performance.now();
  logInfo("evaluation.started", {
    submissionId,
    auditAction,
    actorId,
  });

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      assignment: true,
      student: {
        select: { username: true, displayName: true },
      },
    },
  });

  if (!submission) {
    logWarn("evaluation.submission_not_found", {
      submissionId,
      auditAction,
      actorId,
    });
    return null;
  }

  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: "evaluating" },
  });

  try {
    const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000";
    const agentResponse = await fetch(`${agentUrl}/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assignment: {
          title: submission.assignment.title,
          question: submission.assignment.question,
          instructions: submission.assignment.instructions,
        },
        submission: {
          student: submission.student.displayName,
          answer: submission.answer,
        },
        rubric: submission.assignment.instructions,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!agentResponse.ok) {
      const details = await agentResponse.text();
      throw new Error(`Agent returned ${agentResponse.status}: ${details}`);
    }

    const agentResult: unknown = await agentResponse.json();

    if (!isAgentEvaluationResponse(agentResult)) {
      throw new Error("Agent response failed backend validation");
    }

    const existingEvaluation = await prisma.evaluation.findUnique({
      where: { submissionId },
      select: { id: true },
    });

    const evaluation = await prisma.$transaction(async (transaction) => {
      const savedEvaluation = existingEvaluation
        ? await transaction.evaluation.update({
            where: { submissionId },
            data: {
              completenessLevel: agentResult.completeness.level,
              completenessComment: agentResult.completeness.comment,
              correctnessLevel: agentResult.correctness.level,
              correctnessComment: agentResult.correctness.comment,
              mainProblems: agentResult.main_problems,
              suggestions: agentResult.suggestions,
              score: agentResult.score,
              grade: agentResult.grade,
              status: "generated",
              agentRawOutput: agentResult.raw_output,
              errorMessage: null,
              version: { increment: 1 },
              reviewedById: null,
              reviewedAt: null,
            },
          })
        : await transaction.evaluation.create({
            data: {
              submissionId,
              completenessLevel: agentResult.completeness.level,
              completenessComment: agentResult.completeness.comment,
              correctnessLevel: agentResult.correctness.level,
              correctnessComment: agentResult.correctness.comment,
              mainProblems: agentResult.main_problems,
              suggestions: agentResult.suggestions,
              score: agentResult.score,
              grade: agentResult.grade,
              status: "generated",
              agentRawOutput: agentResult.raw_output,
            },
          });

      await transaction.submission.update({
        where: { id: submissionId },
        data: { status: "evaluated" },
      });

      await transaction.evaluationAudit.create({
        data: {
          evaluationId: savedEvaluation.id,
          submissionId,
          action: auditAction,
          version: savedEvaluation.version,
          snapshot: JSON.parse(
            JSON.stringify({
              evaluation: savedEvaluation,
              agent: {
                provider: agentResult.provider,
                attempts: agentResult.attempts,
              },
            }),
          ),
          actorId,
          agentRawOutput: agentResult.raw_output,
        },
      });

      return savedEvaluation;
    });

    logInfo("evaluation.completed", {
      submissionId,
      evaluationId: evaluation.id,
      auditAction,
      actorId,
      provider: agentResult.provider,
      attempts: agentResult.attempts,
      score: evaluation.score,
      grade: evaluation.grade,
      version: evaluation.version,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    });

    return {
      evaluation,
      agent: {
        provider: agentResult.provider,
        attempts: agentResult.attempts,
      },
    };
  } catch (error) {
    await prisma.submission.update({
      where: { id: submissionId },
      data: { status: "failed" },
    });
    logError("evaluation.failed", error, {
      submissionId,
      auditAction,
      actorId,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    });
    throw error;
  }
}

async function findTeacher(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, role: "teacher" },
    select: { id: true, username: true, displayName: true },
  });
}

async function findMattermostUser(
  mattermostUserId: string,
  username: string,
) {
  let user = await prisma.user.findFirst({
    where: {
      OR: [{ mattermostUserId }, { username }],
    },
  });

  if (!user && username === process.env.MATTERMOST_TEACHER_USERNAME) {
    user = await prisma.user.findUnique({
      where: { username: "teacher01" },
    });
  }

  return user;
}

async function confirmEvaluationRecord(
  evaluationId: string,
  teacherId: string,
) {
  const evaluation = await prisma.evaluation.findUnique({
    where: { id: evaluationId },
  });

  if (!evaluation) {
    return null;
  }

  return prisma.$transaction(async (transaction) => {
    const savedEvaluation = await transaction.evaluation.update({
      where: { id: evaluation.id },
      data: {
        status: "confirmed",
        reviewedById: teacherId,
        reviewedAt: new Date(),
      },
      include: {
        reviewedBy: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    await transaction.evaluationAudit.create({
      data: {
        evaluationId: savedEvaluation.id,
        submissionId: savedEvaluation.submissionId,
        action: "confirmed",
        version: savedEvaluation.version,
        snapshot: JSON.parse(JSON.stringify(savedEvaluation)),
        actorId: teacherId,
        agentRawOutput: savedEvaluation.agentRawOutput,
      },
    });

    return savedEvaluation;
  });
}

async function regradeEvaluationRecord(
  evaluationId: string,
  teacherId: string,
) {
  const evaluation = await prisma.evaluation.findUnique({
    where: { id: evaluationId },
  });

  if (!evaluation) {
    return null;
  }

  await prisma.evaluation.update({
    where: { id: evaluation.id },
    data: {
      status: "regrading",
      reviewedById: teacherId,
      reviewedAt: new Date(),
    },
  });

  return runEvaluation(evaluation.submissionId, "regraded", teacherId);
}

app.get("/health", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    sendServerError(response, "Database health check failed", error);
  }
});

app.post("/assignments", async (request, response) => {
  try {
    const { title, question, deadline, instructions, createdById } =
      request.body;

    if (
      !isNonEmptyString(title) ||
      !isNonEmptyString(question) ||
      !isNonEmptyString(deadline) ||
      !isNonEmptyString(createdById)
    ) {
      return response.status(400).json({
        message: "title, question, deadline and createdById are required",
      });
    }

    const parsedDeadline = new Date(deadline);

    if (Number.isNaN(parsedDeadline.getTime())) {
      return response.status(400).json({
        message: "deadline must be a valid date",
      });
    }

    const teacher = await prisma.user.findUnique({
      where: { id: createdById },
    });

    if (!teacher) {
      return response.status(400).json({ message: "Creator user not found" });
    }

    if (teacher.role !== "teacher") {
      return response.status(403).json({
        message: "Only a teacher can publish an assignment",
      });
    }

    const assignment = await prisma.assignment.create({
      data: {
        title: title.trim(),
        question: question.trim(),
        deadline: parsedDeadline,
        instructions: isNonEmptyString(instructions)
          ? instructions.trim()
          : null,
        createdById,
      },
      include: {
        createdBy: {
          select: { id: true, username: true, displayName: true, role: true },
        },
        _count: { select: { submissions: true } },
      },
    });

    response.status(201).json(assignment);
  } catch (error) {
    sendServerError(response, "Failed to publish assignment", error);
  }
});

app.get("/assignments", async (_request, response) => {
  try {
    const assignments = await prisma.assignment.findMany({
      include: {
        createdBy: {
          select: { id: true, username: true, displayName: true, role: true },
        },
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    response.json(assignments);
  } catch (error) {
    sendServerError(response, "Failed to list assignments", error);
  }
});

app.get("/assignments/:id", async (request, response) => {
  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id: request.params.id },
      include: {
        createdBy: {
          select: { id: true, username: true, displayName: true, role: true },
        },
        _count: { select: { submissions: true } },
      },
    });

    if (!assignment) {
      return response.status(404).json({ message: "Assignment not found" });
    }

    response.json(assignment);
  } catch (error) {
    sendServerError(response, "Failed to get assignment", error);
  }
});

app.post("/assignments/:id/submissions", async (request, response) => {
  try {
    const assignmentId = request.params.id;
    const { studentId, answer } = request.body;

    if (!isNonEmptyString(studentId) || !isNonEmptyString(answer)) {
      return response.status(400).json({
        message: "studentId and answer are required",
      });
    }

    const [assignment, student] = await Promise.all([
      prisma.assignment.findUnique({ where: { id: assignmentId } }),
      prisma.user.findUnique({ where: { id: studentId } }),
    ]);

    if (!assignment) {
      return response.status(404).json({ message: "Assignment not found" });
    }

    if (assignment.status !== "published") {
      return response.status(409).json({ message: "Assignment is closed" });
    }

    if (!student) {
      return response.status(400).json({ message: "Student user not found" });
    }

    if (student.role !== "student") {
      return response.status(403).json({
        message: "Only a student can submit an answer",
      });
    }

    const existing = await prisma.submission.findUnique({
      where: {
        assignmentId_studentId: { assignmentId, studentId },
      },
    });

    const submission = await prisma.$transaction(async (transaction) => {
      if (existing) {
        await transaction.evaluation.deleteMany({
          where: { submissionId: existing.id },
        });

        return transaction.submission.update({
          where: { id: existing.id },
          data: {
            answer: answer.trim(),
            status: "submitted",
            submittedAt: new Date(),
          },
          include: {
            student: {
              select: {
                id: true,
                username: true,
                displayName: true,
                role: true,
              },
            },
            evaluation: true,
          },
        });
      }

      return transaction.submission.create({
        data: { assignmentId, studentId, answer: answer.trim() },
        include: {
          student: {
            select: {
              id: true,
              username: true,
              displayName: true,
              role: true,
            },
          },
          evaluation: true,
        },
      });
    });

    response.status(existing ? 200 : 201).json(submission);
  } catch (error) {
    sendServerError(response, "Failed to submit answer", error);
  }
});

app.get("/assignments/:id/submissions", async (request, response) => {
  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id: request.params.id },
      select: { id: true, title: true },
    });

    if (!assignment) {
      return response.status(404).json({ message: "Assignment not found" });
    }

    const submissions = await prisma.submission.findMany({
      where: { assignmentId: request.params.id },
      include: {
        student: {
          select: { id: true, username: true, displayName: true, role: true },
        },
        evaluation: true,
      },
      orderBy: { submittedAt: "asc" },
    });

    response.json({ assignment, count: submissions.length, submissions });
  } catch (error) {
    sendServerError(response, "Failed to summarize submissions", error);
  }
});

app.get("/submissions/:id", async (request, response) => {
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: request.params.id },
      include: {
        assignment: true,
        student: {
          select: { id: true, username: true, displayName: true, role: true },
        },
        evaluation: true,
      },
    });

    if (!submission) {
      return response.status(404).json({ message: "Submission not found" });
    }

    response.json(submission);
  } catch (error) {
    sendServerError(response, "Failed to get submission", error);
  }
});

app.post("/submissions/:id/evaluate", async (request, response) => {
  const submissionId = request.params.id;

  try {
    const result = await runEvaluation(submissionId);

    if (!result) {
      return response.status(404).json({ message: "Submission not found" });
    }

    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("evaluation.http_request_failed", error, {
      requestId: response.locals.requestId,
      submissionId,
    });
    response.status(502).json({
      message: "Failed to evaluate submission",
      detail: message,
      requestId: response.locals.requestId,
    });
  }
});

app.get("/submissions/:id/evaluation", async (request, response) => {
  try {
    const evaluation = await prisma.evaluation.findUnique({
      where: { submissionId: request.params.id },
      include: {
        reviewedBy: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    if (!evaluation) {
      return response.status(404).json({ message: "Evaluation not found" });
    }

    response.json(evaluation);
  } catch (error) {
    sendServerError(response, "Failed to get evaluation", error);
  }
});

app.get("/submissions/:id/evaluation-audits", async (request, response) => {
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });

    if (!submission) {
      return response.status(404).json({ message: "Submission not found" });
    }

    const audits = await prisma.evaluationAudit.findMany({
      where: { submissionId: submission.id },
      include: {
        actor: {
          select: { id: true, username: true, displayName: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    response.json({ submissionId: submission.id, count: audits.length, audits });
  } catch (error) {
    sendServerError(response, "Failed to get evaluation audits", error);
  }
});

app.post("/evaluations/:id/confirm", async (request, response) => {
  try {
    const { reviewedById } = request.body;

    if (!isNonEmptyString(reviewedById)) {
      return response.status(400).json({ message: "reviewedById is required" });
    }

    const teacher = await findTeacher(reviewedById);
    if (!teacher) {
      return response.status(403).json({
        message: "Only a teacher can confirm an evaluation",
      });
    }

    const confirmed = await confirmEvaluationRecord(
      request.params.id,
      teacher.id,
    );

    if (!confirmed) {
      return response.status(404).json({ message: "Evaluation not found" });
    }

    response.json(confirmed);
  } catch (error) {
    sendServerError(response, "Failed to confirm evaluation", error);
  }
});

app.patch("/evaluations/:id", async (request, response) => {
  try {
    const {
      reviewedById,
      score,
      grade,
      completenessComment,
      correctnessComment,
      mainProblems,
      suggestions,
    } = request.body;

    if (!isNonEmptyString(reviewedById)) {
      return response.status(400).json({ message: "reviewedById is required" });
    }

    const hasEditableField =
      score !== undefined ||
      grade !== undefined ||
      completenessComment !== undefined ||
      correctnessComment !== undefined ||
      mainProblems !== undefined ||
      suggestions !== undefined;

    if (!hasEditableField) {
      return response.status(400).json({
        message: "At least one editable evaluation field is required",
      });
    }

    if (
      score !== undefined &&
      (!Number.isInteger(score) || score < 0 || score > 100)
    ) {
      return response.status(400).json({
        message: "score must be an integer between 0 and 100",
      });
    }

    const grades = ["A", "B", "C", "D", "F"] as const;
    if (grade !== undefined && !grades.includes(grade)) {
      return response.status(400).json({
        message: "grade must be A, B, C, D or F",
      });
    }

    if (
      completenessComment !== undefined &&
      !isNonEmptyString(completenessComment)
    ) {
      return response.status(400).json({
        message: "completenessComment must be a non-empty string",
      });
    }

    if (
      correctnessComment !== undefined &&
      !isNonEmptyString(correctnessComment)
    ) {
      return response.status(400).json({
        message: "correctnessComment must be a non-empty string",
      });
    }

    const validTextList = (value: unknown) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => isNonEmptyString(item));

    if (mainProblems !== undefined && !validTextList(mainProblems)) {
      return response.status(400).json({
        message: "mainProblems must be a non-empty string array",
      });
    }

    if (suggestions !== undefined && !validTextList(suggestions)) {
      return response.status(400).json({
        message: "suggestions must be a non-empty string array",
      });
    }

    const [evaluation, teacher] = await Promise.all([
      prisma.evaluation.findUnique({ where: { id: request.params.id } }),
      findTeacher(reviewedById),
    ]);

    if (!evaluation) {
      return response.status(404).json({ message: "Evaluation not found" });
    }

    if (!teacher) {
      return response.status(403).json({
        message: "Only a teacher can modify an evaluation",
      });
    }

    const modified = await prisma.$transaction(async (transaction) => {
      const savedEvaluation = await transaction.evaluation.update({
        where: { id: evaluation.id },
        data: {
          ...(score !== undefined ? { score } : {}),
          ...(grade !== undefined ? { grade } : {}),
          ...(completenessComment !== undefined
            ? { completenessComment: completenessComment.trim() }
            : {}),
          ...(correctnessComment !== undefined
            ? { correctnessComment: correctnessComment.trim() }
            : {}),
          ...(mainProblems !== undefined ? { mainProblems } : {}),
          ...(suggestions !== undefined ? { suggestions } : {}),
          status: "modified",
          version: { increment: 1 },
          reviewedById: teacher.id,
          reviewedAt: new Date(),
        },
        include: {
          reviewedBy: {
            select: { id: true, username: true, displayName: true },
          },
        },
      });

      await transaction.evaluationAudit.create({
        data: {
          evaluationId: savedEvaluation.id,
          submissionId: savedEvaluation.submissionId,
          action: "modified",
          version: savedEvaluation.version,
          snapshot: JSON.parse(JSON.stringify(savedEvaluation)),
          actorId: teacher.id,
          agentRawOutput: savedEvaluation.agentRawOutput,
        },
      });

      return savedEvaluation;
    });

    response.json(modified);
  } catch (error) {
    sendServerError(response, "Failed to modify evaluation", error);
  }
});

app.post("/evaluations/:id/regrade", async (request, response) => {
  try {
    const { reviewedById } = request.body;

    if (!isNonEmptyString(reviewedById)) {
      return response.status(400).json({ message: "reviewedById is required" });
    }

    const teacher = await findTeacher(reviewedById);
    if (!teacher) {
      return response.status(403).json({
        message: "Only a teacher can request regrading",
      });
    }

    const result = await regradeEvaluationRecord(
      request.params.id,
      teacher.id,
    );

    if (!result) {
      return response.status(404).json({ message: "Submission not found" });
    }

    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("evaluation.regrade_http_request_failed", error, {
      requestId: response.locals.requestId,
      evaluationId: request.params.id,
    });
    response.status(502).json({
      message: "Failed to regrade evaluation",
      detail: message,
      requestId: response.locals.requestId,
    });
  }
});

type MattermostInteractiveAction = "confirm" | "regrade";

type MattermostAttachment = {
  fallback: string;
  color: string;
  title: string;
  text: string;
  fields: Array<{
    short: boolean;
    title: string;
    value: string;
  }>;
  actions: Array<{
    id: string;
    name: string;
    type: "button";
    style?: "primary" | "danger";
    integration: {
      url: string;
      context: {
        action: MattermostInteractiveAction;
        evaluationId: string;
        submissionId: string;
        signature: string;
      };
    };
  }>;
};

function mattermostReply(
  text: string,
  inChannel = false,
  attachments: MattermostAttachment[] = [],
) {
  return {
    response_type: inChannel ? "in_channel" : "ephemeral",
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function parseMattermostDeadline(value: string) {
  const chinaLocalTime = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/.exec(value);
  return chinaLocalTime
    ? new Date(`${chinaLocalTime[1]}T${chinaLocalTime[2]}:00+08:00`)
    : new Date(value);
}

function signMattermostAction(
  action: MattermostInteractiveAction,
  evaluationId: string,
  submissionId: string,
) {
  const secret = process.env.MATTERMOST_SLASH_TOKEN;

  if (!isNonEmptyString(secret)) {
    return "";
  }

  return createHmac("sha256", secret)
    .update(`${action}:${evaluationId}:${submissionId}`)
    .digest("hex");
}

function verifyMattermostAction(
  action: MattermostInteractiveAction,
  evaluationId: string,
  submissionId: string,
  signature: string,
) {
  const expected = signMattermostAction(
    action,
    evaluationId,
    submissionId,
  );

  if (!expected || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex"),
  );
}

function resolveMattermostActionUrl(request: express.Request) {
  const configuredUrl = process.env.MATTERMOST_ACTION_URL;

  if (isNonEmptyString(configuredUrl)) {
    return configuredUrl.trim();
  }

  const forwardedProtocol = request
    .header("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProtocol || request.protocol;
  const host = request.get("host");

  return `${protocol}://${host}/mattermost/actions`;
}

function buildMattermostEvaluationAttachment(
  request: express.Request,
  input: {
    submissionId: string;
    studentName: string;
    answer: string;
    evaluation: {
      id: string;
      score: number;
      grade: string;
      status: string;
      version: number;
    };
  },
): MattermostAttachment {
  const actionUrl = resolveMattermostActionUrl(request);
  const answerPreview =
    input.answer.length > 120
      ? `${input.answer.slice(0, 120)}…`
      : input.answer;
  const createAction = (
    action: MattermostInteractiveAction,
    name: string,
    style?: "primary" | "danger",
  ) => ({
    id: `${action}${input.evaluation.id}`,
    name,
    type: "button" as const,
    ...(style ? { style } : {}),
    integration: {
      url: actionUrl,
      context: {
        action,
        evaluationId: input.evaluation.id,
        submissionId: input.submissionId,
        signature: signMattermostAction(
          action,
          input.evaluation.id,
          input.submissionId,
        ),
      },
    },
  });

  return {
    fallback: `${input.studentName}：${input.evaluation.score} 分 / ${input.evaluation.grade}`,
    color: input.evaluation.status === "confirmed" ? "#2E7D32" : "#C98245",
    title: `${input.studentName} · AI 评估`,
    text: answerPreview,
    fields: [
      {
        short: true,
        title: "评分",
        value: `${input.evaluation.score} / 100（${input.evaluation.grade}）`,
      },
      {
        short: true,
        title: "状态 / 版本",
        value: `${input.evaluation.status} / v${input.evaluation.version}`,
      },
    ],
    actions: [
      createAction("confirm", "确认评估", "primary"),
      createAction("regrade", "重新评估"),
    ],
  };
}

app.post("/mattermost/commands", async (request, response) => {
  try {
    const { token, user_id: mattermostUserId, user_name: username, text } =
      request.body;
    const expectedToken = process.env.MATTERMOST_SLASH_TOKEN;

    if (!expectedToken) {
      return response.status(503).json(
        mattermostReply("后端尚未配置 MATTERMOST_SLASH_TOKEN。"),
      );
    }

    if (token !== expectedToken) {
      return response.status(403).json(mattermostReply("Slash Command Token 无效。"));
    }

    if (!isNonEmptyString(mattermostUserId) || !isNonEmptyString(username)) {
      return response.status(400).json(mattermostReply("缺少 Mattermost 用户信息。"));
    }

    const user = await findMattermostUser(mattermostUserId, username);

    if (!user) {
      return response.json(
        mattermostReply(
          `未找到系统用户 @${username}。请使用 teacher01 或 student01–student03 对应的 Mattermost 账号。`,
        ),
      );
    }

    if (!user.mattermostUserId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { mattermostUserId },
      });
    }

    const parts = String(text ?? "")
      .split("|")
      .map((part) => part.trim());
    const command = parts[0]?.toLowerCase();

    logInfo("mattermost.command_received", {
      requestId: response.locals.requestId,
      command: command || "help",
      mattermostUserId,
      username,
      systemUserId: user.id,
      role: user.role,
    });

    if (!command || command === "help") {
      return response.json(
        mattermostReply(
          [
            "### 数据结构作业助手",
            "教师发布：`/ds publish | 标题 | 2026-07-25 23:59 | 题目内容 | 其他说明`",
            "学生提交：`/ds submit | assignment_id | 答案内容`",
            "教师汇总：`/ds summary | assignment_id`",
          ].join("\n"),
        ),
      );
    }

    if (command === "publish") {
      if (user.role !== "teacher") {
        return response.json(mattermostReply("只有教师账号可以发布作业。"));
      }

      const [, title, deadlineText, question, instructions] = parts;

      if (!title || !deadlineText || !question) {
        return response.json(
          mattermostReply(
            "格式错误：`/ds publish | 标题 | 截止时间 | 题目内容 | 其他说明`",
          ),
        );
      }

      const deadline = parseMattermostDeadline(deadlineText);
      if (Number.isNaN(deadline.getTime())) {
        return response.json(mattermostReply("截止时间格式无效。"));
      }

      const assignment = await prisma.assignment.create({
        data: {
          title,
          question,
          deadline,
          instructions: instructions || null,
          createdById: user.id,
        },
      });

      return response.json(
        mattermostReply(
          [
            `### 作业已发布：${assignment.title}`,
            `- 作业 ID：\`${assignment.id}\``,
            `- 截止时间：${assignment.deadline.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
            `- 题目：${assignment.question}`,
          ].join("\n"),
          true,
        ),
      );
    }

    if (command === "submit") {
      if (user.role !== "student") {
        return response.json(mattermostReply("只有学生账号可以提交答案。"));
      }

      const [, assignmentId, ...answerParts] = parts;
      const answer = answerParts.join(" | ").trim();

      if (!assignmentId || !answer) {
        return response.json(
          mattermostReply("格式错误：`/ds submit | assignment_id | 答案内容`"),
        );
      }

      const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
      });

      if (!assignment) {
        return response.json(mattermostReply("未找到对应作业。"));
      }

      if (assignment.status !== "published") {
        return response.json(mattermostReply("该作业已经关闭。"));
      }

      const existing = await prisma.submission.findUnique({
        where: {
          assignmentId_studentId: {
            assignmentId,
            studentId: user.id,
          },
        },
      });

      const submission = await prisma.$transaction(async (transaction) => {
        if (existing) {
          await transaction.evaluation.deleteMany({
            where: { submissionId: existing.id },
          });

          return transaction.submission.update({
            where: { id: existing.id },
            data: {
              answer,
              status: "submitted",
              submittedAt: new Date(),
            },
          });
        }

        return transaction.submission.create({
          data: { assignmentId, studentId: user.id, answer },
        });
      });

      try {
        const result = await runEvaluation(submission.id);
        const evaluation = result?.evaluation;

        return response.json(
          mattermostReply(
            [
              `答案已提交：**${assignment.title}**`,
              `提交 ID：\`${submission.id}\``,
              evaluation
                ? `AI 基础评估已生成：**${evaluation.score} 分 / ${evaluation.grade}**（等待教师审核）`
                : "AI 基础评估尚未生成。",
            ].join("\n"),
          ),
        );
      } catch (error) {
        logError("mattermost.submission_evaluation_failed", error, {
          requestId: response.locals.requestId,
          submissionId: submission.id,
          assignmentId: assignment.id,
          userId: user.id,
        });
        return response.json(
          mattermostReply(
            [
              `答案已提交：**${assignment.title}**`,
              `提交 ID：\`${submission.id}\``,
              "AI 评估暂时失败，教师可在审核页面重新评估。",
            ].join("\n"),
          ),
        );
      }
    }

    if (command === "summary") {
      if (user.role !== "teacher") {
        return response.json(mattermostReply("只有教师账号可以查看汇总。"));
      }

      const assignmentId = parts[1];
      if (!assignmentId) {
        return response.json(
          mattermostReply("格式错误：`/ds summary | assignment_id`"),
        );
      }

      const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
          submissions: {
            include: { student: true, evaluation: true },
            orderBy: { submittedAt: "asc" },
          },
        },
      });

      if (!assignment) {
        return response.json(mattermostReply("未找到对应作业。"));
      }

      const rows = assignment.submissions.map((submission) => {
        const result = submission.evaluation
          ? `${submission.evaluation.score} 分 / ${submission.evaluation.grade} / ${submission.evaluation.status}`
          : "尚未评估";
        const answerPreview =
          submission.answer.length > 80
            ? `${submission.answer.slice(0, 80)}…`
            : submission.answer;
        return `- **${submission.student.displayName}**：${result}\n  > ${answerPreview}`;
      });
      const attachments = assignment.submissions.flatMap((submission) =>
        submission.evaluation
          ? [
              buildMattermostEvaluationAttachment(request, {
                submissionId: submission.id,
                studentName: submission.student.displayName,
                answer: submission.answer,
                evaluation: submission.evaluation,
              }),
            ]
          : [],
      );

      return response.json(
        mattermostReply(
          [
            `### ${assignment.title} · 提交汇总`,
            `共 ${assignment.submissions.length} 份提交`,
            ...rows,
            `\n教师审核页面：http://localhost:5173`,
          ].join("\n"),
          false,
          attachments,
        ),
      );
    }

    return response.json(
      mattermostReply(`未知子命令：${command}。请输入 \`/ds help\`。`),
    );
  } catch (error) {
    logError("mattermost.command_failed", error, {
      requestId: response.locals.requestId,
    });
    response.status(500).json(mattermostReply("命令处理失败，请检查后端日志。"));
  }
});

app.post("/mattermost/actions", async (request, response) => {
  try {
    const {
      user_id: mattermostUserId,
      user_name: username,
      context,
    } = request.body as {
      user_id?: unknown;
      user_name?: unknown;
      context?: unknown;
    };

    if (
      !isNonEmptyString(mattermostUserId) ||
      !isNonEmptyString(username) ||
      !context ||
      typeof context !== "object"
    ) {
      return response.status(400).json({
        ephemeral_text: "交互请求缺少用户或操作信息。",
      });
    }

    const actionContext = context as Record<string, unknown>;
    const action = actionContext.action;
    const evaluationId = actionContext.evaluationId;
    const submissionId = actionContext.submissionId;
    const signature = actionContext.signature;

    if (
      (action !== "confirm" && action !== "regrade") ||
      !isNonEmptyString(evaluationId) ||
      !isNonEmptyString(submissionId) ||
      !isNonEmptyString(signature)
    ) {
      return response.status(400).json({
        ephemeral_text: "交互操作参数无效。",
      });
    }

    if (
      !verifyMattermostAction(
        action,
        evaluationId,
        submissionId,
        signature,
      )
    ) {
      logWarn("mattermost.action_signature_rejected", {
        requestId: response.locals.requestId,
        action,
        evaluationId,
        submissionId,
        mattermostUserId,
        username,
      });
      return response.status(403).json({
        ephemeral_text: "交互操作签名无效，请重新执行 /ds summary。",
      });
    }

    const user = await findMattermostUser(mattermostUserId, username);

    if (!user || user.role !== "teacher") {
      logWarn("mattermost.action_permission_rejected", {
        requestId: response.locals.requestId,
        action,
        evaluationId,
        submissionId,
        mattermostUserId,
        username,
      });
      return response.status(403).json({
        ephemeral_text: "只有教师账号可以审核评估结果。",
      });
    }

    const evaluation = await prisma.evaluation.findUnique({
      where: { id: evaluationId },
      select: {
        id: true,
        submissionId: true,
        score: true,
        grade: true,
        version: true,
      },
    });

    if (!evaluation || evaluation.submissionId !== submissionId) {
      return response.status(404).json({
        ephemeral_text: "评估记录不存在或已经更新，请重新执行 /ds summary。",
      });
    }

    logInfo("mattermost.action_received", {
      requestId: response.locals.requestId,
      action,
      evaluationId,
      submissionId,
      systemUserId: user.id,
      username,
    });

    if (action === "confirm") {
      const confirmed = await confirmEvaluationRecord(
        evaluationId,
        user.id,
      );

      if (!confirmed) {
        return response.status(404).json({
          ephemeral_text: "评估记录不存在。",
        });
      }

      logInfo("mattermost.action_completed", {
        requestId: response.locals.requestId,
        action,
        evaluationId,
        submissionId,
        systemUserId: user.id,
        version: confirmed.version,
      });

      return response.json({
        ephemeral_text: `已确认评估：${confirmed.score} 分 / ${confirmed.grade}（v${confirmed.version}）。`,
        skip_slack_parsing: true,
      });
    }

    void regradeEvaluationRecord(evaluationId, user.id)
      .then((result) => {
        if (!result) {
          logWarn("mattermost.regrade_record_missing", {
            evaluationId,
            submissionId,
            systemUserId: user.id,
          });
          return;
        }

        logInfo("mattermost.action_completed", {
          action,
          evaluationId: result.evaluation.id,
          submissionId,
          systemUserId: user.id,
          version: result.evaluation.version,
          score: result.evaluation.score,
          grade: result.evaluation.grade,
        });
      })
      .catch((error) => {
        logError("mattermost.regrade_failed", error, {
          evaluationId,
          submissionId,
          systemUserId: user.id,
        });
      });

    return response.json({
      ephemeral_text:
        "已触发 Agent 重新评估。请稍后刷新教师审核页面，或再次执行 /ds summary 查看结果。",
      skip_slack_parsing: true,
    });
  } catch (error) {
    logError("mattermost.action_failed", error, {
      requestId: response.locals.requestId,
    });
    response.status(500).json({
      ephemeral_text: "交互操作处理失败，请检查后端日志。",
    });
  }
});

app.use((_request, response) => {
  response.status(404).json({ message: "Route not found" });
});
