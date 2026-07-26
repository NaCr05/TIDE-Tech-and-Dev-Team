import os
from dotenv import load_dotenv

load_dotenv()

# Mattermost 配置
MATTERMOST_URL = "http://localhost:8065"
BOT_TOKEN = os.getenv("BOT_TOKEN", "")

# DeepSeek API 配置
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"

# PostgreSQL 配置
DB_HOST = "localhost"
DB_PORT = 5434
DB_NAME = "homework_db"
DB_USER = "homework"
DB_PASSWORD = "homework123"

# Mattermost 频道 ID
MATTERMOST_CHANNEL_ID = "tdd3w8bu3tr1tjm51epr4dfrdy"
