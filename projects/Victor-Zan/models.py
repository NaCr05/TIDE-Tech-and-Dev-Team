import psycopg2
import psycopg2.extras
from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD


def get_db():
    """获取 PostgreSQL 数据库连接（返回字典格式的结果）"""
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    return conn


def init_db():
    """创建所有表（如果不存在的话）"""
    conn = get_db()
    cursor = conn.cursor()

    # 表1：作业
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assignments (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            deadline TEXT,
            teacher TEXT DEFAULT 'teacher',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 表2：学生提交
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            id SERIAL PRIMARY KEY,
            assignment_id INTEGER NOT NULL REFERENCES assignments(id),
            student TEXT NOT NULL,
            answer TEXT NOT NULL,
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 表3：AI 评估
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS evaluations (
            id SERIAL PRIMARY KEY,
            submission_id INTEGER NOT NULL UNIQUE REFERENCES submissions(id),
            completeness TEXT,
            correctness TEXT,
            issues TEXT,
            suggestions TEXT,
            score TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    cursor.close()
    conn.close()
    print("✅ PostgreSQL 数据库初始化完成！3 张表已创建。")


if __name__ == "__main__":
    init_db()
