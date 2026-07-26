-- CreateEnum
CREATE TYPE "EvaluationAuditAction" AS ENUM ('baseline', 'generated', 'regraded', 'confirmed', 'modified');

-- CreateTable
CREATE TABLE "EvaluationAudit" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT,
    "submissionId" TEXT NOT NULL,
    "action" "EvaluationAuditAction" NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT,
    "agentRawOutput" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvaluationAudit_evaluationId_createdAt_idx" ON "EvaluationAudit"("evaluationId", "createdAt");

-- CreateIndex
CREATE INDEX "EvaluationAudit_submissionId_createdAt_idx" ON "EvaluationAudit"("submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "EvaluationAudit_actorId_idx" ON "EvaluationAudit"("actorId");

-- Preserve the latest state of evaluations created before audit tracking existed.
INSERT INTO "EvaluationAudit" (
    "id",
    "evaluationId",
    "submissionId",
    "action",
    "version",
    "snapshot",
    "actorId",
    "agentRawOutput",
    "createdAt"
)
SELECT
    'audit_baseline_' || md5(random()::text || clock_timestamp()::text || evaluation."id"),
    evaluation."id",
    evaluation."submissionId",
    'baseline'::"EvaluationAuditAction",
    evaluation."version",
    jsonb_build_object(
        'evaluation',
        to_jsonb(evaluation),
        'baselineImported',
        true
    ),
    evaluation."reviewedById",
    evaluation."agentRawOutput",
    evaluation."updatedAt"
FROM "Evaluation" AS evaluation;

-- AddForeignKey
ALTER TABLE "EvaluationAudit" ADD CONSTRAINT "EvaluationAudit_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAudit" ADD CONSTRAINT "EvaluationAudit_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAudit" ADD CONSTRAINT "EvaluationAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
