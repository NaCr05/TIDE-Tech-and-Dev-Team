import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { app } from "../src/app";
import { pool, prisma } from "../src/prisma";

type ApiResult = {
  response: Response;
  body: any;
};

async function parseResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

test("TIDE grading API complete workflow", async (suite) => {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));

  const address = server.address() as AddressInfo;
  const apiBase = `http://127.0.0.1:${address.port}`;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const teacherId = "user_teacher_001";
  const studentId = "user_student_001";
  const teacherBefore = await prisma.user.findUniqueOrThrow({
    where: { id: teacherId },
    select: { mattermostUserId: true },
  });
  const mattermostUserId =
    teacherBefore.mattermostUserId ?? `api-test-${uniqueSuffix}`;
  const slashToken = process.env.MATTERMOST_SLASH_TOKEN;
  let assignmentId: string | undefined;
  let submissionId: string | undefined;
  let evaluationId: string | undefined;

  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<ApiResult> {
    const response = await fetch(`${apiBase}${path}`, init);
    return { response, body: await parseResponse(response) };
  }

  try {
    await suite.test("health endpoint returns request correlation data", async () => {
      const { response, body } = await request("/health");
      assert.equal(response.status, 200);
      assert.equal(body.status, "ok");
      assert.equal(body.database, "connected");
      assert.ok(response.headers.get("x-request-id"));
    });

    await suite.test("publishing validates required fields and teacher role", async () => {
      const invalid = await request("/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "missing fields" }),
      });
      assert.equal(invalid.response.status, 400);

      const forbidden = await request("/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "student cannot publish",
          question: "permission test",
          deadline: "2027-07-26T15:59:00.000Z",
          createdById: studentId,
        }),
      });
      assert.equal(forbidden.response.status, 403);
    });

    await suite.test("teacher publishes an assignment", async () => {
      const result = await request("/assignments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": `api-test-publish-${uniqueSuffix}`,
        },
        body: JSON.stringify({
          title: `API 验收测试 ${uniqueSuffix}`,
          question: "请说明栈的后进先出特性。",
          deadline: "2027-07-26T15:59:00.000Z",
          instructions: "该记录会在测试完成后自动清理。",
          createdById: teacherId,
        }),
      });

      assert.equal(result.response.status, 201);
      assert.equal(
        result.response.headers.get("x-request-id"),
        `api-test-publish-${uniqueSuffix}`,
      );
      assignmentId = result.body.id;
      assert.ok(assignmentId);
    });

    await suite.test("submission endpoint enforces student role", async () => {
      assert.ok(assignmentId);
      const forbidden = await request(
        `/assignments/${assignmentId}/submissions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            studentId: teacherId,
            answer: "teacher should not submit",
          }),
        },
      );
      assert.equal(forbidden.response.status, 403);
    });

    await suite.test("student submits and Agent generates an evaluation", async () => {
      assert.ok(assignmentId);
      const submitted = await request(
        `/assignments/${assignmentId}/submissions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            studentId,
            answer:
              "栈遵循后进先出，最后压入的元素最先弹出，push 入栈，pop 出栈。",
          }),
        },
      );
      assert.equal(submitted.response.status, 201);
      submissionId = submitted.body.id;

      const evaluated = await request(
        `/submissions/${submissionId}/evaluate`,
        { method: "POST" },
      );
      assert.equal(evaluated.response.status, 200);
      assert.equal(typeof evaluated.body.evaluation.score, "number");
      assert.match(evaluated.body.evaluation.grade, /^[ABCDF]$/);
      assert.ok(["mock", "deepseek"].includes(evaluated.body.agent.provider));
      evaluationId = evaluated.body.evaluation.id;
    });

    await suite.test("teacher can regrade, modify and confirm", async () => {
      assert.ok(evaluationId);

      const regraded = await request(`/evaluations/${evaluationId}/regrade`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewedById: teacherId }),
      });
      assert.equal(regraded.response.status, 200);
      assert.ok(regraded.body.evaluation.version >= 2);

      const modified = await request(`/evaluations/${evaluationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewedById: teacherId,
          score: 88,
          grade: "B",
          correctnessComment: "API 测试：教师已复核。",
        }),
      });
      assert.equal(modified.response.status, 200);
      assert.equal(modified.body.status, "modified");
      assert.equal(modified.body.score, 88);
      assert.equal(modified.body.grade, "B");

      const confirmed = await request(
        `/evaluations/${evaluationId}/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reviewedById: teacherId }),
        },
      );
      assert.equal(confirmed.response.status, 200);
      assert.equal(confirmed.body.status, "confirmed");
    });

    await suite.test("summary and audit endpoints expose the complete chain", async () => {
      assert.ok(assignmentId);
      assert.ok(submissionId);

      const summary = await request(
        `/assignments/${assignmentId}/submissions`,
      );
      assert.equal(summary.response.status, 200);
      assert.equal(summary.body.count, 1);

      const audits = await request(
        `/submissions/${submissionId}/evaluation-audits`,
      );
      assert.equal(audits.response.status, 200);
      const actions = audits.body.audits.map(
        (audit: { action: string }) => audit.action,
      );
      assert.ok(actions.includes("generated"));
      assert.ok(actions.includes("regraded"));
      assert.ok(actions.includes("modified"));
      assert.ok(actions.includes("confirmed"));
    });

    await suite.test("Mattermost summary provides signed interactive buttons", async () => {
      assert.ok(slashToken, "MATTERMOST_SLASH_TOKEN must be configured");
      assert.ok(assignmentId);

      const invalidToken = await request("/mattermost/commands", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: `${slashToken}-invalid`,
          user_id: mattermostUserId,
          user_name: "teacher01",
          text: `summary | ${assignmentId}`,
        }),
      });
      assert.equal(invalidToken.response.status, 403);

      const summary = await request("/mattermost/commands", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: slashToken,
          user_id: mattermostUserId,
          user_name: "teacher01",
          text: `summary | ${assignmentId}`,
        }),
      });
      assert.equal(summary.response.status, 200);
      assert.equal(summary.body.response_type, "ephemeral");
      assert.equal(summary.body.attachments.length, 1);

      const confirmAction = summary.body.attachments[0].actions.find(
        (action: { integration: { context: { action: string } } }) =>
          action.integration.context.action === "confirm",
      );
      const regradeAction = summary.body.attachments[0].actions.find(
        (action: { integration: { context: { action: string } } }) =>
          action.integration.context.action === "regrade",
      );
      assert.ok(confirmAction);
      assert.ok(regradeAction);
      assert.match(confirmAction.id, /^[A-Za-z0-9]+$/);
      assert.match(regradeAction.id, /^[A-Za-z0-9]+$/);
      assert.match(confirmAction.integration.context.signature, /^[a-f0-9]{64}$/);

      const rejected = await request("/mattermost/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: mattermostUserId,
          user_name: "teacher01",
          context: {
            ...confirmAction.integration.context,
            signature: "0".repeat(64),
          },
        }),
      });
      assert.equal(rejected.response.status, 403);

      const studentRejected = await request("/mattermost/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: `api-test-student-${uniqueSuffix}`,
          user_name: "student01",
          context: confirmAction.integration.context,
        }),
      });
      assert.equal(studentRejected.response.status, 403);

      const confirmed = await request("/mattermost/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: mattermostUserId,
          user_name: "teacher01",
          context: confirmAction.integration.context,
        }),
      });
      assert.equal(confirmed.response.status, 200);
      assert.match(confirmed.body.ephemeral_text, /已确认评估/);
    });
  } finally {
    if (assignmentId) {
      await prisma.assignment.deleteMany({
        where: { id: assignmentId },
      });
    }

    if (!teacherBefore.mattermostUserId) {
      await prisma.user.update({
        where: { id: teacherId },
        data: { mattermostUserId: null },
      });
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await prisma.$disconnect();
    await pool.end();
  }
});
