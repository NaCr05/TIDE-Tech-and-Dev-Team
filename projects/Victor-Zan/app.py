from flask import Flask, request, jsonify, render_template, redirect
from models import get_db
from ai_agent import evaluate, parse_report
from mattermost_bot import send_message
from config import MATTERMOST_CHANNEL_ID


app = Flask(__name__)


@app.route("/")
def home():
    """首页"""
    return render_template("index.html")


@app.route("/hello", methods=["POST"])
def hello():
    """接收 Mattermost Slash Command 并回复"""
    user_name = request.form.get("user_name", "未知用户")
    command = request.form.get("command", "")
    text = request.form.get("text", "")

    return jsonify({
        "response_type": "ephemeral",
        "text": f"👋 你好 **{user_name}**！你输入了 `/{command} {text}`\n\n作业批改助手已就绪。"
    })


@app.route("/publish", methods=["GET", "POST"])
def publish():
    """教师发布作业"""
    if request.method == "GET":
        return render_template("publish.html")

    title = request.form["title"]
    content = request.form["content"]
    deadline = request.form.get("deadline", "")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO assignments (title, content, deadline) VALUES (%s, %s, %s)",
        (title, content, deadline)
    )
    conn.commit()
    cursor.close()
    conn.close()

    return redirect("/")


@app.route("/submit", methods=["GET", "POST"])
def submit():
    """学生提交作业"""
    conn = get_db()
    cursor = conn.cursor()

    if request.method == "GET":
        cursor.execute("SELECT id, title, deadline FROM assignments ORDER BY id DESC")
        assignments = cursor.fetchall()
        cursor.close()
        conn.close()
        return render_template("submit.html", assignments=assignments)

    assignment_id = request.form["assignment_id"]
    if not assignment_id:
        return "❌ 请选择一个作业再提交！<br><a href='/submit'>← 返回</a>"

    student = request.form["student"]
    answer = request.form["answer"]

    cursor.execute(
        "INSERT INTO submissions (assignment_id, student, answer) VALUES (%s, %s, %s)",
        (assignment_id, student, answer)
    )
    conn.commit()

    # Bot 通知频道
    send_message(MATTERMOST_CHANNEL_ID,
        f"📤 **{student}** 提交了作业 #{assignment_id}\n预览：{answer[:100]}...")

    cursor.execute("SELECT id, title, deadline FROM assignments ORDER BY id DESC")
    assignments = cursor.fetchall()
    cursor.close()
    conn.close()

    return render_template("submit.html", assignments=assignments, success=True)


@app.route("/summary")
def summary():
    """教师查看所有作业的提交汇总"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.id, a.title, a.deadline, COUNT(s.id) as count
        FROM assignments a
        LEFT JOIN submissions s ON a.id = s.assignment_id
        GROUP BY a.id
        ORDER BY a.id DESC
    """)
    homework = cursor.fetchall()
    cursor.close()
    conn.close()
    return render_template("summary.html", homework=homework)


@app.route("/summary/<int:assignment_id>")
def assignment_detail(assignment_id):
    """查看某份作业的详情和所有提交"""
    conn = get_db()
    cursor = conn.cursor()

    # 查询作业信息
    cursor.execute("SELECT * FROM assignments WHERE id = %s", (assignment_id,))
    assignment = cursor.fetchone()

    # 查询所有提交 + 关联的评估结果
    cursor.execute("""
        SELECT s.*, e.score, e.status, e.report
        FROM submissions s
        LEFT JOIN evaluations e ON s.id = e.submission_id
        WHERE s.assignment_id = %s
        ORDER BY s.submitted_at DESC
    """, (assignment_id,))
    submissions = cursor.fetchall()

    cursor.close()
    conn.close()
    return render_template("assignment_detail.html",
                           assignment=assignment, submissions=submissions)


@app.route("/evaluate/<int:submission_id>")
def evaluate_submission(submission_id):
    """AI 评估一份学生提交"""
    conn = get_db()
    cursor = conn.cursor()

    # 1. 查出提交内容和对应的作业题目
    cursor.execute("""
        SELECT s.id, s.answer, a.content as assignment_content, a.id as assignment_id
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        WHERE s.id = %s
    """, (submission_id,))
    sub = cursor.fetchone()

    # 2. 调用 DeepSeek
    report = evaluate(sub["assignment_content"], sub["answer"])

    # 3. 解析报告为 5 个字段
    fields = parse_report(report)

    # 4. 保存评估结果（有则更新，无则插入）
    cursor.execute("""
        INSERT INTO evaluations (submission_id, report, status,
            completeness, correctness, issues, suggestions, score)
        VALUES (%s, %s, 'pending', %s, %s, %s, %s, %s)
        ON CONFLICT (submission_id)
        DO UPDATE SET report = %s, status = 'pending',
            completeness = %s, correctness = %s, issues = %s, suggestions = %s, score = %s,
            created_at = CURRENT_TIMESTAMP
    """, (
        submission_id, report,
        fields["completeness"], fields["correctness"], fields["issues"],
        fields["suggestions"], fields["score"],
        report,
        fields["completeness"], fields["correctness"], fields["issues"],
        fields["suggestions"], fields["score"],
    ))
    conn.commit()

    # Bot 通知频道
    send_message(MATTERMOST_CHANNEL_ID,
        f"🤖 AI 评估完成！提交 #{submission_id} 报告已生成。\n👉 http://localhost:5000/review/{submission_id}")

    cursor.close()
    conn.close()

    # 4. 跳回作业详情页
    return redirect(f"/summary/{sub['assignment_id']}")

@app.route("/review/<int:submission_id>")
def review_page(submission_id):
    """审核页面"""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM submissions WHERE id = %s", (submission_id,))
    sub = cursor.fetchone()

    cursor.execute("SELECT * FROM evaluations WHERE submission_id = %s", (submission_id,))
    eval_data = cursor.fetchone()

    cursor.close()
    conn.close()
    return render_template("review.html", sub=sub, eval=eval_data)


@app.route("/review/<int:eval_id>/confirm", methods=["POST"])
def review_confirm(eval_id):
    """确认评估"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE evaluations SET status = 'confirmed' WHERE id = %s", (eval_id,))
    conn.commit()

    cursor.execute("SELECT submission_id FROM evaluations WHERE id = %s", (eval_id,))
    sub_id = cursor.fetchone()["submission_id"]
    cursor.execute("SELECT assignment_id FROM submissions WHERE id = %s", (sub_id,))
    assignment_id = cursor.fetchone()["assignment_id"]

    cursor.close()
    conn.close()
    return redirect(f"/summary/{assignment_id}")


@app.route("/review/<int:eval_id>/modify", methods=["POST"])
def review_modify(eval_id):
    """修改评估"""
    score = request.form.get("score", "")
    report = request.form.get("report", "")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE evaluations SET score = %s, report = %s, status = 'modified' WHERE id = %s",
        (score, report, eval_id)
    )
    conn.commit()

    cursor.execute("SELECT submission_id FROM evaluations WHERE id = %s", (eval_id,))
    sub_id = cursor.fetchone()["submission_id"]
    cursor.execute("SELECT assignment_id FROM submissions WHERE id = %s", (sub_id,))
    assignment_id = cursor.fetchone()["assignment_id"]

    cursor.close()
    conn.close()
    return redirect(f"/summary/{assignment_id}")


@app.route("/review/<int:eval_id>/reevaluate", methods=["POST"])
def review_reevaluate(eval_id):
    """重新评估"""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT s.id as submission_id, s.answer, a.content as assignment_content, a.id as assignment_id
        FROM evaluations e
        JOIN submissions s ON e.submission_id = s.id
        JOIN assignments a ON s.assignment_id = a.id
        WHERE e.id = %s
    """, (eval_id,))
    data = cursor.fetchone()

    new_report = evaluate(data["assignment_content"], data["answer"])
    fields = parse_report(new_report)

    cursor.execute(
        """UPDATE evaluations SET report = %s, status = 'pending',
            completeness = %s, correctness = %s, issues = %s, suggestions = %s, score = %s,
            created_at = CURRENT_TIMESTAMP WHERE id = %s""",
        (new_report,
         fields["completeness"], fields["correctness"], fields["issues"],
         fields["suggestions"], fields["score"],
         eval_id)
    )
    conn.commit()

    cursor.close()
    conn.close()
    return redirect(f"/summary/{data['assignment_id']}")



@app.route("/slash/publish", methods=["POST"])
def slash_publish():
    """Mattermost Slash Command：教师发布作业"""
    user_name = request.form.get("user_name", "teacher")
    text = request.form.get("text", "")

    # 格式：/publish 作业标题 | 题目内容 | 截止时间(可选)
    parts = [p.strip() for p in text.split("|")]
    if len(parts) < 2:
        return jsonify({
            "response_type": "ephemeral",
            "text": "❌ 格式错误！正确格式：\n`/publish 作业标题 | 题目内容 | 截止时间（可选）`"
        })

    title = parts[0]
    content = parts[1]
    deadline = parts[2] if len(parts) >= 3 else ""

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO assignments (title, content, deadline, teacher) VALUES (%s, %s, %s, %s)",
        (title, content, deadline, user_name)
    )
    conn.commit()
    cursor.close()
    conn.close()

    # 频道公开通知
    send_message(MATTERMOST_CHANNEL_ID,
        f"📝 **{user_name}** 发布了新作业：**{title}**\n"
        f"截止：{deadline or '不限'}\n"
        f"👉 http://localhost:5000/submit")

    return jsonify({
        "response_type": "in_channel",
        "text": f"✅ 作业发布成功！\n**{title}**\n{content[:200]}"
    })


@app.route("/slash/submit", methods=["POST"])
def slash_submit():
    """Mattermost Slash Command：学生提交作业"""
    user_name = request.form.get("user_name", "unknown")
    text = request.form.get("text", "")

    # 格式：/submit 作业ID 答案内容
    parts = text.split(" ", 1)
    if len(parts) < 2:
        return jsonify({
            "response_type": "ephemeral",
            "text": "❌ 格式错误！正确格式：\n`/submit 作业ID 你的答案`\n查作业ID：http://localhost:5000/submit"
        })

    assignment_id = parts[0].strip()
    answer = parts[1].strip()

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO submissions (assignment_id, student, answer) VALUES (%s, %s, %s)",
        (assignment_id, user_name, answer)
    )
    conn.commit()
    cursor.close()
    conn.close()

    send_message(MATTERMOST_CHANNEL_ID,
        f"📤 **{user_name}** 提交了作业 #{assignment_id}")

    return jsonify({
        "response_type": "ephemeral",
        "text": f"✅ 提交成功！作业 #{assignment_id} 已收到。"
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
