---
name: pesarkhaleh
description: همه‌چیز درباره‌ی «پسرخاله»، دستیار/مغز مرکزی محمدحسین که از گپ (Mattermost باسلام) و ربات تلگرام @PesarKhaleh_bot با Claude Code حرف می‌زند؛ معماری، کد، راه‌اندازی از صفر، نگهداری، عیب‌یابی و تصمیم‌ها. هر وقت درباره‌ی پسرخاله/غلام حسین/پل گپ/ربات تلگرام/Worker کلودفلر سؤال یا تغییری هست، یا باید از نو راهش انداخت یا به VPS برد، از این استفاده کن. Use for anything about Pesar Khaleh (the Gap + Telegram bridge to Claude Code): architecture, code, setup from scratch, operations, troubleshooting, changes, migration.
---

# پسرخاله (Pesar Khaleh)

Pesar Khaleh is the user's always-on personal assistant and "central brain": a bridge that lets
محمدحسین (mh.rashadi) talk to Claude Code from **Gap** (Basalam's Mattermost) and from the
Telegram bot **@PesarKhaleh_bot**, with read-only eyes on his Gap and Telegram, hands on Google
Calendar/Docs and the laptop, a notebook (`brain/`), and scheduled briefs. Persona name from
Kolah Ghermezi's پسرخاله: tone only; usefulness first; always call the user «محمدحسین».

## Standing order: keep this skill current

**Every time Pesar Khaleh changes** (code, config, behaviour, accounts, decisions), update this
skill's docs if they are affected, then run:

```
node "%USERPROFILE%\.claude\skills\pesarkhaleh\sync.mjs" "<what changed>"
```

It copies the live code from `C:\Users\M.H.Rashadi\gap-claude-bridge` into `code/`, commits and
pushes this skill repo (private: github.com/mh9rashadi/pesarkhaleh) — the code's **only** GitHub home
(the old gap-claude-bridge repo was retired). `!save` in chat runs the same sync.

## Where things are

| What | Where |
|---|---|
| Live code (runs from here) | `C:\Users\M.H.Rashadi\gap-claude-bridge` |
| Copy of the code in this skill | `code/` (written by `sync.mjs`; don't edit here) |
| Cloudflare Worker | `code/worker/` → `https://pesarkhaleh.mh9rashady.workers.dev` (CF account "Mh9rashady@gmail.com's Account", id 46f655b5…) |
| Telegram MCP (read-only) | `C:\Users\M.H.Rashadi\tools\telegram-mcp` (chigwell/telegram-mcp, user-scope MCP `telegram`) |
| Autostart | `shell:startup\gap-claude-bridge.vbs` → `start-hidden.vbs` → `supervisor.mjs` |
| Log | `gap-claude-bridge\bridge.log` |
| Secrets (local only, never on GitHub) | `gap-claude-bridge\.env` (MM_TOKEN, WEBHOOK_URL, TG_BOT_TOKEN, TG_OWNER_ID, WORKER_URL, LAPTOP_SECRET, TG_WEBHOOK_SECRET, EYVAN_TOKEN, ANTHROPIC_API_KEY when added; template `.env.example`) and `telegram-mcp\.env` (API ID/hash, session string). The user keeps the raw file himself and hands it over when needed. |

## Read next, by task

- How it works, component by component → `references/architecture.md`
- Rebuild from zero / move to a new machine or VPS → `references/setup.md`
- Day-to-day: commands, restart, logs, rotating secrets, changing code safely → `references/operations.md`
- Why things are the way they are, mistakes made, open items → `references/history.md`

## Hard rules (from the user; never relax without being asked)

1. **Telegram as the user is read-only.** Claude never sends, replies, deletes or reacts as the
   user's Telegram account. The MCP runs with `TELEGRAM_EXPOSED_TOOLS=read-only`. Claude writes on
   Telegram **only through the bot**. Drafts for him to send himself are fine.
   User-approved exceptions, both toward the transcription bot @KhanoomJBot (id 7758315663):
   `summon_transcriber.py` (2026-10-31, bot DM) and `call-recorder\khanoom_sender.py` (2026-11-04,
   sends Zoiper call recordings as voice notes to the group «Parda Call», id -1003932363325, members:
   the user + the bot). No other writing as the user.
2. **Gap is read-only** apart from the bridge channel (replies via incoming webhook, status reactions
   and file posts there). Never post, edit or react elsewhere on Gap. One user-approved exception
   (2026-11-04): `call-recorder\call_sync.py` posts short Parda seller-call reports in the user's DM
   with @a.rajabi only (skill `parda-calls`).
3. **Nothing risky for the Gap server.** Ask before anything that could load or change it.
4. The owner is the master: Gap posts by `mh.rashadi` in the bridge channel; Telegram user id
   `7278666599`. Keep the bridge channel single-member. **Other Telegram users ("guests") are answered
   only by the isolated, tool-less guest runner** (see architecture.md → Guests) — never route a
   guest's text into the main session, and never give the guest runner tools, MCP, skills or raw person skills.
5. `inbox/` and `brain/` (coworkers' messages and notes about them) stay local: gitignored in both repos.
6. **Secrets never go to GitHub** (neither repo) and are never printed or pasted in chat. Only the empty
   template `code/.env.example` is published. Check secrets by format/length or by calling the API, never by echoing.
7. **When rebuilding for someone (or on a new machine): tell the person they must fill the secrets files
   themselves** — `gap-claude-bridge\.env` (from `.env.example`) and `tools\telegram-mcp\.env` — following
   `references/setup.md`. Never ask them to paste a secret into the chat.
8. Replies in Persian; Telegram replies are plain text (no markdown).
