# Operations

## Chat commands (Gap needs `!`; Telegram takes `!` or `/`)
| Command | Effect |
|---|---|
| `!help` | list |
| `!new [force]` | fresh session for this topic: the old one is compacted into a ≤450-word hand-over summary (copy in `brain/topics/`), given to the fresh session; `force` skips the summary |
| `!delete` / `!delete yes` | in an owner topic: archive the chat (summary + full .jsonl) to `brain/trash/`, forget the session, delete the topic in Telegram (deleteForumTopic). Refused for main and the bot's own topics |
| `!stop` | kill the Claude run of THIS topic/session (instant); `!stop all` = every run. `!status` shows which topics are running (x/MAX_PARALLEL) |
| `!status` | model, cwd, verbose, session, busy, queue, approx cost, uptime (instant) |
| `!brain <n\|name> [agent]` | pick this topic's brain (model [+ agent]); every owner-made topic gets its own session and asks first (instant)
| `!about <text>` | set this topic's permanent charter (`brain/topics/about-<id>.md`) — appended to the system prompt of every session here, survives `!new`; `!about` shows, `!about off` clears (instant)
| `!batch <sec>\|off` | wait and merge rapid-fire messages into one request (default 8 s) (instant)
| `!model <name>` | switch model (persisted, **turns the router off**). Aliases opus/sonnet/fable/haiku or real names (glm-5.3, claude-opus-5-5, gpt-5.5, MiniMax-M3, k3); resolveModel() maps per backend |
| `!router [on|off|easy|normal|hard <model>]` | show/change difficulty routing: easy->flash, normal->glm-5.3, hard->opus-5-5 (instant) |
| `!cwd <path>` | Claude's working directory |
| `!verbose on\|off` | stream tool calls into chat |
| `!save [msg]` | run the skill's `sync.mjs` (copy code into this skill repo and push) |
| `!restart` | planned restart (exit 75) |
| `!brief` `!digest` `!study` `!evening` | run a scheduled job now |
| (scheduled) `vendors` 09:00 | daily 09:00 scan of the Telegram group «توسعه‌دهندگان 🤝 غرفه‌داران» (@salam_ecosystem): crawl ALL of yesterday via telegram MCP (get_history pages of 100), but report ONLY items directly/indirectly related to the products **پردا and فردا** (payment/checkout links for social media, selling outside the app, installments/SalamPay, DM automation, competitor payment-link features; marginal ones marked «شاید») — per user request 2026-11-13 general Basalam topics are no longer referred to him. Persian report «🛍 دیده‌بان پردا و فردا» to the 📋 گزارش‌ها topic; NOTHING_DUE when nothing relates |
| `!todo` | open commitments |
| `!guests [on\|off]` | who messaged the bot; turn guest replies on/off (instant) |
| `!send <text>` | reply to a 📨 notice: the bot sends the text to that guest (instant) |
| `!block <id>` / `!unblock <id>` | stop/allow replies to one guest (instant) |
| `!forget <id>` | delete a contact's cached card + guest session (instant) |
| `!contacts` | build `brain/contacts.json` from Telegram contacts, matched to person skills |
| `@PesarKhaleh_bot <request>` | inline, from inside any Telegram chat |

## Health checks (no secrets printed)
- Processes: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? CommandLine -like '*bridge.mjs*'`
  (expect supervisor + bridge). Busy = a `claude.exe` whose command line contains `stream-json`.
- Log tail: `Get-Content C:\Users\M.H.Rashadi\gap-claude-bridge\bridge.log -Tail 20`.
- Telegram bot: `getMe` (name, `supports_inline_queries`) and `getWebhookInfo` (url, pending, last error)
  via a small node one-liner that reads `.env` — or `node worker\set-webhook.mjs` (re-sets and prints info).
- Worker: `npx wrangler tail` in `worker/` for live logs; `GET /` returns a greeting.

## Restarting safely
0. **The bridge must have been up > 30 s** before you kill it: a death within 30 s of a (re)spawn counts as a crash of new code and the supervisor rolls `bridge.mjs` back to `.last-good/` (this lost changes twice on 2026-11-12). Check the node process CreationDate first. Also check nobody (a Pesar Khaleh session) edited `bridge.mjs` since you read it.
1. Make sure it is idle (no `stream-json` claude.exe), or the in-flight reply is lost.
2. Kill only the **bridge** node process; the supervisor respawns it in ~5s.
3. Wait for `connected` in the log.
Never kill the supervisor unless replacing it; to start everything: run the Startup `.vbs`.

## Changing the code
- From chat: Claude edits, runs `node --check`, creates `restart.flag`; supervisor rolls back if it dies in 30s.
- From the terminal: edit, `node --check bridge.mjs`, restart as above, watch the log.
- Worker: edit `worker/src/index.ts`, `npx tsc --noEmit`, `npx wrangler deploy`.
- Afterwards: update `references/*.md` if behaviour changed, then run this skill's
  `sync.mjs "<what changed>"`. (The live folder still has a local `.git` with old history, no remote; ignore it.)

## Rotating secrets
- Gap token expired → user pastes new `MMAUTHTOKEN` into `.env` → restart.
- Bot token → BotFather `/revoke` → `.env` → `node worker\push-secrets.mjs` → restart → `node worker\set-webhook.mjs`.
- Telegram session leaked/unwanted → Telegram → Settings → Devices → terminate the QR session; re-run the generator.
- Webhook URL (Gap) → recreate in Integrations → `.env` → restart.

## Topic separation rule (user, 2026-10-31)
- In the 📚 درس topic: study ONLY. Never mention work items (no meetings, no work deadlines). 100% study focus.
- Work talk stays in 💼 کار. Cross-references between the two are not made unless the user brings them up himself.

## Division of labour in the 💼 کار topic (user, 2026-10-31)
- The user REPORTS what he is doing during the day (no action needed beyond recording it in brain/journal + commitments.md).
- He sometimes delegates a concrete task → do it fully, report back.
- Pesar Khaleh REMINDS him of his open items (commitments.md, deadlines) — in digests and when relevant. Do not nag; surface what is due.

## Schedule
Edit `schedule.json` (laptop local time; arrays allowed). Picked up within a minute, no restart.
