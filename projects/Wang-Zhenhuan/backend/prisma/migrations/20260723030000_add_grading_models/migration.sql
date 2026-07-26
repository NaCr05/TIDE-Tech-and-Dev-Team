-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('teacher', 'student');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('published', 'closed');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('submitted', 'evaluating', 'evaluated', 'failed');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('generated', 'confirmed', 'modified', 'regrading', 'failed');

-- CreateEnum
CREATE TYPE "CompletenessLevel" AS ENUM ('complete', 'partial', 'incomplete');

-- CreateEnum
CREATE TYPE "CorrectnessLevel" AS ENUM ('correct', 'mostly_correct', 'partially_correct', 'incorrect', 'uncertain');

-- CreateEnum
CREATE TYPE "EvaluationGrade" AS ENUM ('A', 'B', 'C', 'D', 'F');

-- AlterTable
ALTER TABLE "User" DROP COLUMN "name",
ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "mattermostUserId" TEXT,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'student',
ADD COLUMN     "username" TEXT NOT NULL,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "instructions" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'published',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'submitted',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "completenessLevel" "CompletenessLevel" NOT NULL,
    "completenessComment" TEXT NOT NULL,
    "correctnessLevel" "CorrectnessLevel" NOT NULL,
    "correctnessComment" TEXT NOT NULL,
    "mainProblems" JSONB NOT NULL,
    "suggestions" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "grade" "EvaluationGrade" NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'generated',
    "agentRawOutput" TEXT,
    "errorMessage" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assignment_createdById_idx" ON "Assignment"("createdById");

-- CreateIndex
CREATE INDEX "Assignment_status_deadline_idx" ON "Assignment"("status", "deadline");

-- CreateIndex
CREATE INDEX "Submission_assignmentId_status_idx" ON "Submission"("assignmentId", "status");

-- CreateIndex
CREATE INDEX "Submission_studentId_idx" ON "Submission"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_assignmentId_studentId_key" ON "Submission"("assignmentId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_submissionId_key" ON "Evaluation"("submissionId");

-- CreateIndex
CREATE INDEX "Evaluation_status_idx" ON "Evaluation"("status");

-- CreateIndex
CREATE INDEX "Evaluation_reviewedById_idx" ON "Evaluation"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "User_mattermostUserId_key" ON "User"("mattermostUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
