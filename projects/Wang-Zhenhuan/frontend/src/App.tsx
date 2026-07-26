import { useEffect, useMemo, useState } from "react";
import "./App.css";
import type {
  Assignment,
  Evaluation,
  EvaluationAudit,
  EvaluationAuditAction,
  EvaluationAuditResponse,
  EvaluationStatus,
  Submission,
  SubmissionSummary,
} from "./types/grading";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const TEACHER_ID = "user_teacher_001";

const statusLabels: Record<EvaluationStatus, string> = {
  generated: "待教师审核",
  confirmed: "教师已确认",
  modified: "教师已修改",
  regrading: "正在重新评估",
  failed: "评估失败",
};

const levelLabels: Record<string, string> = {
  complete: "完整",
  partial: "部分完整",
  incomplete: "不完整",
  correct: "正确",
  mostly_correct: "大体正确",
  partially_correct: "部分正确",
  incorrect: "错误",
  uncertain: "信息不足",
};

const auditActionLabels: Record<EvaluationAuditAction, string> = {
  baseline: "历史基线",
  generated: "Agent 初次评估",
  regraded: "Agent 重新评估",
  confirmed: "教师确认",
  modified: "教师修改",
};

const gradeOrder: Evaluation["grade"][] = ["A", "B", "C", "D", "F"];

type EditDraft = {
  score: number;
  grade: Evaluation["grade"];
  correctnessComment: string;
};

type SubmissionStatusFilter =
  | "all"
  | "unevaluated"
  | EvaluationStatus;

type SubmissionSort =
  | "newest"
  | "score-desc"
  | "score-asc"
  | "student";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? `请求失败：${response.status}`);
  }

  return data as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAuditSnapshot(audit: EvaluationAudit) {
  if (!isRecord(audit.snapshot)) return null;

  const nestedEvaluation = audit.snapshot.evaluation;
  return isRecord(nestedEvaluation) ? nestedEvaluation : audit.snapshot;
}

function getAuditValue(
  audit: EvaluationAudit,
  key: "score" | "grade" | "status",
) {
  const snapshot = getAuditSnapshot(audit);
  const value = snapshot?.[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function App() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [summary, setSummary] = useState<SubmissionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [submissionSearch, setSubmissionSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<SubmissionStatusFilter>("all");
  const [gradeFilter, setGradeFilter] = useState<"all" | Evaluation["grade"]>(
    "all",
  );
  const [sortBy, setSortBy] = useState<SubmissionSort>("newest");
  const [expandedAuditId, setExpandedAuditId] = useState("");
  const [auditLoadingId, setAuditLoadingId] = useState("");
  const [auditBySubmission, setAuditBySubmission] = useState<
    Record<string, EvaluationAudit[]>
  >({});
  const [auditErrors, setAuditErrors] = useState<Record<string, string>>({});

  const selectedAssignment = assignments.find(
    (assignment) => assignment.id === selectedId,
  );

  const visibleAssignments = useMemo(() => {
    const query = assignmentSearch.trim().toLocaleLowerCase("zh-CN");
    if (!query) return assignments;

    const matches = assignments.filter((assignment) =>
      `${assignment.title} ${assignment.question}`
        .toLocaleLowerCase("zh-CN")
        .includes(query),
    );
    const selected = assignments.find(
      (assignment) => assignment.id === selectedId,
    );

    return selected && !matches.some((assignment) => assignment.id === selected.id)
      ? [selected, ...matches]
      : matches;
  }, [assignmentSearch, assignments, selectedId]);

  async function loadAssignments() {
    const response = await fetch(`${API_BASE}/assignments`);
    const data = await readJson<Assignment[]>(response);
    setAssignments(data);

    if (!selectedId && data.length > 0) {
      const bestDemoAssignment = [...data].sort(
        (left, right) => right._count.submissions - left._count.submissions,
      )[0];
      setSelectedId(bestDemoAssignment.id);
    }
  }

  async function loadSummary(assignmentId: string) {
    const response = await fetch(
      `${API_BASE}/assignments/${assignmentId}/submissions`,
    );
    const data = await readJson<SubmissionSummary>(response);
    setSummary(data);
  }

  async function refresh() {
    try {
      setLoading(true);
      setError("");
      await loadAssignments();
      if (selectedId) {
        await loadSummary(selectedId);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "页面数据加载失败",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_BASE}/assignments`, { signal: controller.signal })
      .then((response) => readJson<Assignment[]>(response))
      .then((data) => {
        setAssignments(data);

        if (data.length > 0) {
          const bestDemoAssignment = [...data].sort(
            (left, right) =>
              right._count.submissions - left._count.submissions,
          )[0];
          setSelectedId(bestDemoAssignment.id);
        }
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "页面数据加载失败",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedId) return;

    const controller = new AbortController();

    fetch(`${API_BASE}/assignments/${selectedId}/submissions`, {
      signal: controller.signal,
    })
      .then((response) => readJson<SubmissionSummary>(response))
      .then(setSummary)
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "提交汇总加载失败",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedId]);

  const stats = useMemo(() => {
    const submissions = summary?.submissions ?? [];
    return {
      total: submissions.length,
      pending: submissions.filter(
        (item) => !item.evaluation || item.evaluation.status === "generated",
      ).length,
      confirmed: submissions.filter(
        (item) => item.evaluation?.status === "confirmed",
      ).length,
      modified: submissions.filter(
        (item) => item.evaluation?.status === "modified",
      ).length,
    };
  }, [summary]);

  const agentStats = useMemo(() => {
    const submissions = summary?.submissions ?? [];
    const evaluations = submissions.flatMap((submission) =>
      submission.evaluation ? [submission.evaluation] : [],
    );
    const scores = evaluations.map((evaluation) => evaluation.score);
    const gradeCounts = Object.fromEntries(
      gradeOrder.map((grade) => [
        grade,
        evaluations.filter((evaluation) => evaluation.grade === grade).length,
      ]),
    ) as Record<Evaluation["grade"], number>;
    const completenessCounts = {
      complete: evaluations.filter(
        (evaluation) => evaluation.completenessLevel === "complete",
      ).length,
      partial: evaluations.filter(
        (evaluation) => evaluation.completenessLevel === "partial",
      ).length,
      incomplete: evaluations.filter(
        (evaluation) => evaluation.completenessLevel === "incomplete",
      ).length,
    };

    return {
      evaluated: evaluations.length,
      average:
        scores.length > 0
          ? Math.round(
              scores.reduce((total, score) => total + score, 0) / scores.length,
            )
          : null,
      highest: scores.length > 0 ? Math.max(...scores) : null,
      lowest: scores.length > 0 ? Math.min(...scores) : null,
      gradeCounts,
      completenessCounts,
      maxGradeCount: Math.max(1, ...Object.values(gradeCounts)),
    };
  }, [summary]);

  const filteredSubmissions = useMemo(() => {
    const query = submissionSearch.trim().toLocaleLowerCase("zh-CN");
    const submissions = [...(summary?.submissions ?? [])].filter(
      (submission) => {
        const evaluation = submission.evaluation;
        const matchesSearch =
          !query ||
          `${submission.student.displayName} ${submission.student.username} ${submission.answer}`
            .toLocaleLowerCase("zh-CN")
            .includes(query);
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "unevaluated"
            ? !evaluation
            : evaluation?.status === statusFilter);
        const matchesGrade =
          gradeFilter === "all" || evaluation?.grade === gradeFilter;

        return matchesSearch && matchesStatus && matchesGrade;
      },
    );

    return submissions.sort((left, right) => {
      if (sortBy === "student") {
        return left.student.displayName.localeCompare(
          right.student.displayName,
          "zh-CN",
        );
      }
      if (sortBy === "score-desc") {
        return (right.evaluation?.score ?? -1) - (left.evaluation?.score ?? -1);
      }
      if (sortBy === "score-asc") {
        return (left.evaluation?.score ?? 101) - (right.evaluation?.score ?? 101);
      }
      return (
        new Date(right.submittedAt).getTime() -
        new Date(left.submittedAt).getTime()
      );
    });
  }, [gradeFilter, sortBy, statusFilter, submissionSearch, summary]);

  const hasActiveFilters =
    submissionSearch.trim().length > 0 ||
    statusFilter !== "all" ||
    gradeFilter !== "all" ||
    sortBy !== "newest";

  async function loadAudits(submissionId: string) {
    try {
      setAuditLoadingId(submissionId);
      setAuditErrors((current) => ({ ...current, [submissionId]: "" }));
      const response = await fetch(
        `${API_BASE}/submissions/${submissionId}/evaluation-audits`,
      );
      const data = await readJson<EvaluationAuditResponse>(response);
      setAuditBySubmission((current) => ({
        ...current,
        [submissionId]: data.audits,
      }));
    } catch (requestError) {
      setAuditErrors((current) => ({
        ...current,
        [submissionId]:
          requestError instanceof Error
            ? requestError.message
            : "审计记录加载失败",
      }));
    } finally {
      setAuditLoadingId("");
    }
  }

  async function toggleAudit(submissionId: string) {
    if (expandedAuditId === submissionId) {
      setExpandedAuditId("");
      return;
    }

    setExpandedAuditId(submissionId);
    await loadAudits(submissionId);
  }

  async function runAction(
    id: string,
    action: () => Promise<Response>,
    successMessage: string,
  ) {
    try {
      setBusyId(id);
      setError("");
      setNotice("");
      const response = await action();
      await readJson(response);
      if (selectedId) await loadSummary(selectedId);
      if (expandedAuditId) await loadAudits(expandedAuditId);
      setNotice(successMessage);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "操作失败",
      );
    } finally {
      setBusyId("");
    }
  }

  function confirmEvaluation(evaluation: Evaluation) {
    return runAction(
      evaluation.id,
      () =>
        fetch(`${API_BASE}/evaluations/${evaluation.id}/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reviewedById: TEACHER_ID }),
        }),
      "评估结果已确认。",
    );
  }

  function regradeEvaluation(evaluation: Evaluation) {
    return runAction(
      evaluation.id,
      () =>
        fetch(`${API_BASE}/evaluations/${evaluation.id}/regrade`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reviewedById: TEACHER_ID }),
        }),
      "Agent 已完成重新评估，版本号已更新。",
    );
  }

  function createEvaluation(submission: Submission) {
    return runAction(
      submission.id,
      () =>
        fetch(`${API_BASE}/submissions/${submission.id}/evaluate`, {
          method: "POST",
        }),
      "基础评估报告已生成。",
    );
  }

  function beginEditing(evaluation: Evaluation) {
    setEditingId(evaluation.id);
    setEditDraft({
      score: evaluation.score,
      grade: evaluation.grade,
      correctnessComment: evaluation.correctnessComment,
    });
  }

  async function saveEdit(evaluation: Evaluation) {
    if (!editDraft) return;

    await runAction(
      evaluation.id,
      () =>
        fetch(`${API_BASE}/evaluations/${evaluation.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reviewedById: TEACHER_ID,
            ...editDraft,
          }),
        }),
      "教师修改已保存。",
    );
    setEditingId("");
    setEditDraft(null);
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#review-queue">
        跳到审核队列
      </a>
      <header className="hero">
        <div className="hero__brand">
          <span className="brand-mark" aria-hidden="true">
            <span>T</span>
          </span>
          <div>
            <p className="hero__kicker">TIDE / DATA STRUCTURES</p>
            <h1>作业评估工作台</h1>
            <p className="hero__subtitle">发布、评估与复核的统一教师工作区</p>
          </div>
        </div>
        <div className="hero__actions">
          <label>
            <span>搜索作业</span>
            <input
              value={assignmentSearch}
              onChange={(event) => setAssignmentSearch(event.target.value)}
              placeholder="输入标题或题目关键词"
              aria-label="搜索作业"
            />
          </label>
          <label>
            <span>当前作业</span>
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              aria-label="选择作业"
            >
              {visibleAssignments.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.title} · {assignment._count.submissions} 份提交
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void refresh()}
          >
            刷新数据
          </button>
        </div>
      </header>

      {selectedAssignment && (
        <section className="assignment-brief">
          <div className="assignment-brief__copy">
            <p className="eyebrow">Problem context</p>
            <h2>{selectedAssignment.title}</h2>
            <p>{selectedAssignment.question}</p>
            <ol className="assignment-flow" aria-label="作业处理流程">
              <li>
                <span>01</span>
                <strong>学生提交</strong>
              </li>
              <li>
                <span>02</span>
                <strong>Agent 评估</strong>
              </li>
              <li>
                <span>03</span>
                <strong>教师复核</strong>
              </li>
            </ol>
          </div>
          <dl>
            <div>
              <dt>发布教师</dt>
              <dd>{selectedAssignment.createdBy.displayName}</dd>
            </div>
            <div>
              <dt>截止时间</dt>
              <dd>{formatDate(selectedAssignment.deadline)}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="stats" aria-label="审核进度">
        <div><span>提交总数</span><strong>{stats.total}</strong></div>
        <div><span>待审核</span><strong>{stats.pending}</strong></div>
        <div><span>已确认</span><strong>{stats.confirmed}</strong></div>
        <div><span>已修改</span><strong>{stats.modified}</strong></div>
      </section>

      <section className="analytics" aria-labelledby="analytics-title">
        <div className="analytics__heading">
          <div>
            <p className="eyebrow">Model analysis</p>
            <h2 id="analytics-title">评估统计概览</h2>
          </div>
          <p>
            已评估 {agentStats.evaluated}/{stats.total} 份
          </p>
        </div>
        <div className="analytics__content">
          <div className="analytics__metrics">
            <div><span>平均分</span><strong>{agentStats.average ?? "—"}</strong></div>
            <div><span>最高分</span><strong>{agentStats.highest ?? "—"}</strong></div>
            <div><span>最低分</span><strong>{agentStats.lowest ?? "—"}</strong></div>
            <div>
              <span>完整答案</span>
              <strong>{agentStats.completenessCounts.complete}</strong>
            </div>
          </div>
          <div className="grade-chart" aria-label="等级分布图">
            <h3>等级分布</h3>
            {gradeOrder.map((grade) => {
              const count = agentStats.gradeCounts[grade];
              const width = `${(count / agentStats.maxGradeCount) * 100}%`;
              return (
                <div className="grade-chart__row" key={grade}>
                  <span>{grade}</span>
                  <div>
                    <i style={{ width }} />
                  </div>
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>
          <div className="completeness-summary">
            <h3>完整性分布</h3>
            <div>
              <span>完整<strong>{agentStats.completenessCounts.complete}</strong></span>
              <span>部分完整<strong>{agentStats.completenessCounts.partial}</strong></span>
              <span>不完整<strong>{agentStats.completenessCounts.incomplete}</strong></span>
            </div>
          </div>
        </div>
      </section>

      {(error || notice) && (
        <div
          className={`toast ${error ? "toast--error" : "toast--success"}`}
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
        >
          <span>{error || notice}</span>
          {error && (
            <button type="button" onClick={() => void refresh()}>
              重新加载
            </button>
          )}
        </div>
      )}

      <section
        id="review-queue"
        className="submissions-section"
        aria-labelledby="review-queue-title"
        tabIndex={-1}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Review pipeline</p>
            <h2 id="review-queue-title">学生提交与评估报告</h2>
          </div>
          <p>AI 结果仅作辅助，最终结论由教师确认。</p>
        </div>

        <div className="filters" aria-label="提交筛选">
          <label className="filters__search">
            <span>搜索学生或答案</span>
            <input
              value={submissionSearch}
              onChange={(event) => setSubmissionSearch(event.target.value)}
              placeholder="姓名、用户名或答案关键词"
            />
          </label>
          <label>
            <span>审核状态</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as SubmissionStatusFilter)
              }
            >
              <option value="all">全部状态</option>
              <option value="unevaluated">尚未评估</option>
              <option value="generated">待教师审核</option>
              <option value="confirmed">教师已确认</option>
              <option value="modified">教师已修改</option>
              <option value="regrading">正在重新评估</option>
              <option value="failed">评估失败</option>
            </select>
          </label>
          <label>
            <span>等级</span>
            <select
              value={gradeFilter}
              onChange={(event) =>
                setGradeFilter(
                  event.target.value as "all" | Evaluation["grade"],
                )
              }
            >
              <option value="all">全部等级</option>
              {gradeOrder.map((grade) => (
                <option value={grade} key={grade}>{grade}</option>
              ))}
            </select>
          </label>
          <label>
            <span>排序</span>
            <select
              value={sortBy}
              onChange={(event) =>
                setSortBy(event.target.value as SubmissionSort)
              }
            >
              <option value="newest">最新提交</option>
              <option value="score-desc">分数从高到低</option>
              <option value="score-asc">分数从低到高</option>
              <option value="student">学生姓名</option>
            </select>
          </label>
          <button
            className="button button--ghost filters__reset"
            disabled={!hasActiveFilters}
            onClick={() => {
              setSubmissionSearch("");
              setStatusFilter("all");
              setGradeFilter("all");
              setSortBy("newest");
            }}
          >
            清除筛选
          </button>
        </div>
        {!loading && summary && summary.submissions.length > 0 && (
          <p className="filter-result">
            显示 {filteredSubmissions.length} / {summary.submissions.length} 份提交
          </p>
        )}

        {loading && <div className="empty-state">正在加载审核队列…</div>}

        {!loading && summary?.submissions.length === 0 && (
          <div className="empty-state">该作业暂时没有学生提交。</div>
        )}

        {!loading &&
          summary &&
          summary.submissions.length > 0 &&
          filteredSubmissions.length === 0 && (
            <div className="empty-state">
              没有符合当前搜索或筛选条件的提交。
            </div>
          )}

        {!loading && summary && (
          <div className="submission-list">
            {filteredSubmissions.map((submission, submissionIndex) => {
              const evaluation = submission.evaluation;
              const isEditing = evaluation?.id === editingId;
              const isBusy = busyId === (evaluation?.id ?? submission.id);
              const isAuditOpen = expandedAuditId === submission.id;
              const audits = auditBySubmission[submission.id] ?? [];

              return (
                <article className="submission-card" key={submission.id}>
                  <div className="submission-card__node" aria-hidden="true">
                    <span>{String(submissionIndex + 1).padStart(2, "0")}</span>
                  </div>
                  <div className="submission-card__student">
                    <div className="avatar">
                      {submission.student.displayName.slice(-1)}
                    </div>
                    <div>
                      <h3>{submission.student.displayName}</h3>
                      <p>@{submission.student.username} · {formatDate(submission.submittedAt)}</p>
                    </div>
                    {evaluation && (
                      <span className={`status status--${evaluation.status}`}>
                        {statusLabels[evaluation.status]}
                      </span>
                    )}
                  </div>

                  <div className="answer-block">
                    <span>学生答案</span>
                    <p>{submission.answer}</p>
                  </div>

                  {!evaluation ? (
                    <div className="no-evaluation">
                      <p>这份提交尚未生成评估报告。</p>
                      <button
                        className="button"
                        disabled={isBusy}
                        onClick={() => void createEvaluation(submission)}
                      >
                        {isBusy ? "评估中…" : "生成基础评估"}
                      </button>
                    </div>
                  ) : (
                    <div className="evaluation-panel">
                      <div className="score-box">
                        <small className="score-box__label">Agent 评分</small>
                        <div>
                          <strong>{evaluation.score}</strong><span>/100</span>
                        </div>
                        <b>{evaluation.grade}</b>
                        <small>版本 {evaluation.version}</small>
                      </div>

                      <div className="evaluation-content">
                        <div className="dimension-grid">
                          <div>
                            <span>答案完整性 · {levelLabels[evaluation.completenessLevel]}</span>
                            <p>{evaluation.completenessComment}</p>
                          </div>
                          <div>
                            <span>正确性判断 · {levelLabels[evaluation.correctnessLevel]}</span>
                            <p>{evaluation.correctnessComment}</p>
                          </div>
                        </div>
                        <div className="feedback-grid">
                          <div>
                            <h4>主要问题</h4>
                            <ul>{evaluation.mainProblems.map((item) => <li key={item}>{item}</li>)}</ul>
                          </div>
                          <div>
                            <h4>修改建议</h4>
                            <ul>{evaluation.suggestions.map((item) => <li key={item}>{item}</li>)}</ul>
                          </div>
                        </div>

                        {isEditing && editDraft && (
                          <div className="edit-form">
                            <label>分数<input type="number" min="0" max="100" value={editDraft.score} onChange={(event) => setEditDraft({ ...editDraft, score: Number(event.target.value) })} /></label>
                            <label>等级<select value={editDraft.grade} onChange={(event) => setEditDraft({ ...editDraft, grade: event.target.value as Evaluation["grade"] })}>{["A", "B", "C", "D", "F"].map((grade) => <option key={grade}>{grade}</option>)}</select></label>
                            <label className="edit-form__comment">正确性评语<textarea rows={3} value={editDraft.correctnessComment} onChange={(event) => setEditDraft({ ...editDraft, correctnessComment: event.target.value })} /></label>
                          </div>
                        )}

                        <div className="card-actions">
                          {isEditing ? (
                            <>
                              <button className="button" disabled={isBusy} onClick={() => void saveEdit(evaluation)}>保存修改</button>
                              <button className="button button--ghost" onClick={() => setEditingId("")}>取消</button>
                            </>
                          ) : (
                            <>
                              <button className="button" disabled={isBusy || evaluation.status === "confirmed"} onClick={() => void confirmEvaluation(evaluation)}>确认评估</button>
                              <button className="button button--secondary" disabled={isBusy} onClick={() => beginEditing(evaluation)}>修改结果</button>
                              <button className="button button--ghost" disabled={isBusy} onClick={() => void regradeEvaluation(evaluation)}>{isBusy ? "处理中…" : "重新评估"}</button>
                            </>
                          )}
                          <button
                            className="button button--ghost"
                            disabled={auditLoadingId === submission.id}
                            onClick={() => void toggleAudit(submission.id)}
                            aria-expanded={isAuditOpen}
                          >
                            {auditLoadingId === submission.id
                              ? "加载历史…"
                              : isAuditOpen
                                ? "收起评估历史"
                                : "查看评估历史"}
                          </button>
                        </div>

                        {isAuditOpen && (
                          <section className="audit-panel">
                            <div className="audit-panel__heading">
                              <div>
                                <p className="eyebrow">Evaluation audit</p>
                                <h3>评估审计时间线</h3>
                              </div>
                              <span>{audits.length} 条不可变记录</span>
                            </div>
                            {auditErrors[submission.id] && (
                              <div className="audit-panel__error">
                                {auditErrors[submission.id]}
                                <button
                                  type="button"
                                  onClick={() => void loadAudits(submission.id)}
                                >
                                  重试
                                </button>
                              </div>
                            )}
                            {!auditErrors[submission.id] &&
                              auditLoadingId !== submission.id &&
                              audits.length === 0 && (
                                <p className="audit-panel__empty">
                                  暂无评估审计记录。
                                </p>
                              )}
                            {audits.length > 0 && (
                              <ol className="audit-timeline">
                                {[...audits].reverse().map((audit) => {
                                  const score = getAuditValue(audit, "score");
                                  const grade = getAuditValue(audit, "grade");
                                  const status = getAuditValue(audit, "status");
                                  return (
                                    <li key={audit.id}>
                                      <span
                                        className={`audit-dot audit-dot--${audit.action}`}
                                        aria-hidden="true"
                                      />
                                      <div>
                                        <div className="audit-timeline__title">
                                          <strong>{auditActionLabels[audit.action]}</strong>
                                          <time>{formatDate(audit.createdAt)}</time>
                                        </div>
                                        <p>
                                          版本 {audit.version}
                                          {score ? ` · ${score} 分` : ""}
                                          {grade ? ` / ${grade}` : ""}
                                          {status ? ` · ${statusLabels[status as EvaluationStatus] ?? status}` : ""}
                                        </p>
                                        <small>
                                          操作者：
                                          {audit.actor
                                            ? `${audit.actor.displayName} (@${audit.actor.username})`
                                            : audit.action === "generated"
                                              ? "AI Agent"
                                              : "系统"}
                                        </small>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ol>
                            )}
                          </section>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
