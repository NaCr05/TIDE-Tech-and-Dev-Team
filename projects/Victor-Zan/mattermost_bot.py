import requests
from config import MATTERMOST_URL, BOT_TOKEN


def send_message(channel_id, message):
    """Bot 主动发送消息到指定频道"""
    url = f"{MATTERMOST_URL}/api/v4/posts"
    headers = {
        "Authorization": f"Bearer {BOT_TOKEN}",
        "Content-Type": "application/json",
    }
    data = {
        "channel_id": channel_id,
        "message": message,
    }
    response = requests.post(url, json=data, headers=headers)
    return response.json()


def get_channel_id(channel_name, team_name="ds-homework"):
    """根据频道名获取 channel_id"""
    # 先获取团队ID
    headers = {"Authorization": f"Bearer {BOT_TOKEN}"}
    team_url = f"{MATTERMOST_URL}/api/v4/teams/name/{team_name}"
    team_resp = requests.get(team_url, headers=headers)
    team_id = team_resp.json()["id"]

    # 再获取频道ID
    channel_url = f"{MATTERMOST_URL}/api/v4/teams/{team_id}/channels/name/{channel_name}"
    channel_resp = requests.get(channel_url, headers=headers)
    return channel_resp.json()["id"]
