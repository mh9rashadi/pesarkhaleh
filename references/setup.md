# Setup from zero (new laptop, reinstall, or VPS)

Steps marked **[user]** need the user's hands (logins, tokens, BotFather). Never ask for secrets in chat:
have him paste them into the `.env` file himself, then verify by format or an API call.

## 0. Prerequisites
Node 18+ (24 used), Git, `gh` logged in, Python 3.11+ (for telegram MCP), Claude Code logged in
(`claude`; on a VPS use `claude setup-token` **[user]**).

## 1. Code
```
git clone https://github.com/mh9rashadi/pesarkhaleh C:\Users\M.H.Rashadi\.claude\skills\pesarkhaleh
xcopy /E /I C:\Users\M.H.Rashadi\.claude\skills\pesarkhaleh\code C:\Users\M.H.Rashadi\gap-claude-bridge
cd C:\Users\M.H.Rashadi\gap-claude-bridge\worker && npm install
```
The live folder keeps its historical name `gap-claude-bridge` (paths in `start-hidden.vbs` and `sync.mjs`
assume it). **No secrets are in the repo.** Copy `.env.example` to `.env` and
tell the person to fill it themselves (or to drop in the raw `.env` they keep privately). Same for
`tools\telegram-mcp\.env`. Never ask for secret values in chat; verify by format or API call.

## 2. Gap (Mattermost) — https://gap.bk1.basalam.dev
- The user is `system_user`: cannot create bots or personal access tokens; can create own incoming webhooks.
- Bridge channel: private, single-member, created by the user (currently «غلام حسین», id `myxe366c87r1imtyeyxfrrsoxr`).
- **[user]** Integrations → Incoming Webhooks → Add: title `Claude bridge`, channel = bridge channel,
  username `claude`, lock to channel → `WEBHOOK_URL`. (Claude's auto mode refuses to create it.)
- **[user]** `MM_TOKEN` = cookie `MMAUTHTOKEN` (DevTools → Application → Cookies). Expires on logout;
  then replace and restart.
- Verify: `GET /api/v4/users/me` with Bearer token → 200 `mh.rashadi`.

## 3. Telegram bot
- **[user]** @BotFather `/newbot` → token into `.env` as `TG_BOT_TOKEN=<token>` (exactly that form:
  a missing `=` once broke everything and leaked a token into the transcript → it was revoked).
- **[user]** `/setinline` (placeholder text) and `/setinlinefeedback` → Enabled. Restart the Telegram app
  (inline settings are cached client-side). `/start` the bot.
- `TG_OWNER_ID=7278666599`.

## 4. Telegram MCP (read-only eyes)
```
git clone https://github.com/chigwell/telegram-mcp C:\Users\M.H.Rashadi\tools\telegram-mcp
cd C:\Users\M.H.Rashadi\tools\telegram-mcp
python -m venv .venv ; .venv\Scripts\python -m pip install .
```
- `.env`: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` **[user]** (my.telegram.org → API development tools;
  it rate-limits: "Too many attempts", retry later / other network), `TELEGRAM_SESSION_NAME=rashadi_session`,
  `TELEGRAM_EXPOSED_TOOLS=read-only`.
- **[user]** in a separate PowerShell: `.venv\Scripts\python session_string_generator.py --qr`, empty label,
  scan via Telegram → Settings → Devices → Link Desktop Device, answer `y` to write `.env`.
- `claude mcp add telegram --scope user -- C:\Users\M.H.Rashadi\tools\telegram-mcp\.venv\Scripts\telegram-mcp.exe`
- Verify: `claude mcp list` shows Connected; a `claude -p` asking for the 5 latest chat names works.

## 5. Run on the laptop
- Test: `start.cmd` (window stays open on error).
- Autostart: copy `start-hidden.vbs` to `shell:startup\gap-claude-bridge.vbs` (runs supervisor hidden,
  logs to `bridge.log`). Start now: `wscript "<startup>\gap-claude-bridge.vbs"`.
- Check `bridge.log` for `connected`, `telegram bot @PesarKhaleh_bot, inline on`, `telegram via worker …`.

## 6. Cloudflare Worker (always-on front door)
- **[user]** `npx wrangler login` (browser). Two accounts exist; the Worker lives on
  "Mh9rashady@gmail.com's Account" (`account_id` pinned in `wrangler.jsonc`).
- `cd worker ; npm install ; npx tsc --noEmit ; npx wrangler deploy`
- `.env` needs `WORKER_URL`, `LAPTOP_SECRET`, `TG_WEBHOOK_SECRET` (random hex, generate with
  `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
- `node push-secrets.mjs` (pipes secrets from `.env` to `wrangler secret put`, prints names only).
- Order when switching: restart bridge first (so it polls the Worker), then `node set-webhook.mjs`.
  To go back to direct polling: `node set-webhook.mjs off` and remove `WORKER_URL` from `.env`.
- Lite mode needs `ANTHROPIC_API_KEY` **[user]** (console.anthropic.com, billing + monthly limit) → `.env`
  → `node push-secrets.mjs`.

## 7. Moving the brain to a VPS (shelved 2026-10-28: user decided not to buy one for now; only if he asks)
- Small VPS outside Iran (e.g. Hetzner ~€5/mo, 4 GB). Linux: Node, Python, git, Claude Code
  (`claude setup-token` with the subscription — allowed because it is Claude Code itself).
- Copy code + `.env` + `tools/telegram-mcp` (+ its `.env`) + `~/.claude/skills`, `~/.claude/projects/*/memory`.
- Replace `start-hidden.vbs`/Startup with a systemd unit running `node supervisor.mjs` (Restart=always).
- `killTree` already handles non-Windows (`SIGTERM`); `CLAUDE_BIN` → `claude`; `CLAUDE_CWD` → home.
- Keep the Worker in front; the VPS polls it exactly like the laptop. Stop the laptop bridge (two
  pollers would split updates).
- Loses access to laptop files; Google connectors depend on the Claude login on that machine (verify).
- Data note: Gap coworker messages and the Telegram session would live on the VPS — harden SSH, disk encryption if possible.
