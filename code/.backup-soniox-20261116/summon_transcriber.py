"""The ONLY place Pesar Khaleh writes as the owner on Telegram (owner's permission, 2026-10-31).

It does exactly one thing: in the owner's own private group, reply "@KhanoomJBot" to a voice message
the owner himself sent, so the transcriber bot (which bots cannot summon) transcribes it.
Chat, text and sender checks are hard-coded; anything else is refused.

Usage: python summon_transcriber.py <message_id>   (run with the telegram-mcp venv's python)
"""
import asyncio
import os
import sys

from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession

GROUP_ID = -1004487332493          # the owner's private «پسرخاله» group
TEXT = "@KhanoomJBot"              # the only text this script can ever send
MCP_DIR = r"C:\Users\M.H.Rashadi\tools\telegram-mcp"


async def main(msg_id: int) -> int:
    load_dotenv(os.path.join(MCP_DIR, ".env"))
    session = os.getenv("TELEGRAM_SESSION_STRING")
    client = TelegramClient(StringSession(session), int(os.environ["TELEGRAM_API_ID"]), os.environ["TELEGRAM_API_HASH"])
    await client.connect()
    try:
        me = await client.get_me()
        msg = await client.get_messages(GROUP_ID, ids=msg_id)
        if not msg or msg.sender_id != me.id or not (msg.voice or msg.audio or msg.video_note):
            print("refused: not the owner's own voice in his group")
            return 2
        await client.send_message(GROUP_ID, TEXT, reply_to=msg_id)
        print("ok")
        return 0
    finally:
        await client.disconnect()


if __name__ == "__main__":
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        print("usage: summon_transcriber.py <message_id>")
        sys.exit(1)
    sys.exit(asyncio.run(main(int(sys.argv[1]))))
