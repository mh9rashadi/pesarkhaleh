# History, decisions and lessons

## Timeline (all 2026-10-28)
1. Gap found to be Mattermost; user is `system_user` → no bot account, no PAT. Chose: incoming webhook for
   replies + user session token for reading, in a private single-member channel.
2. v1 bridge (websocket → `claude -p` → webhook). Autostart via Startup folder; single-instance lock.
3. Private repo `gap-claude-bridge`. User first asked to push everything incl. `.env` (reversed in step 12);
   coworker data (`inbox/`, later `brain/`) always kept out.
4. v2: supervisor with rollback, `!` commands, files both ways, reactions, stream-json progress, cost.
5. Brain: scheduled digest/brief/evening, `brain/commitments.md`, `brain/journal/`, `gap.mjs recent`.
   (Pesar Khaleh later added a `study` job and `brain/study.md` by itself.)
6. Telegram MCP finished (API ID obtained after "Too many attempts" days). First allowed send/reply with
   approval; **user then ruled: Telegram account read-only, writing only through a bot.**
7. Bot channel added (first on @Voice_recorder_claude_bot, then moved to the new **@PesarKhaleh_bot**);
   persona renamed from «غلام حسین» to «پسرخاله». All briefs go to Telegram.
8. Inline mode for "@bot set a meeting at 5" from inside chats.
9. Cloudflare Worker front door with Durable Object queue + heartbeat; lite mode pending API key.
10. User asked why the subscription can't be used from Cloudflare → explained; VPS considered.
11. Skill + private repo `pesarkhaleh` created; sync after every change.
12. **Secrets policy reversed**: user ruled secrets never go to GitHub; the raw `.env` stays with him and is
    handed over when needed. `.env` untracked from `gap-claude-bridge` (still present in that repo's old
    commits unless history is purged). VPS shelved for now.
13. Old repo `gap-claude-bridge` retired (user's choice): `pesarkhaleh` is the only GitHub home; `!save`
    now runs `sync.mjs`; local remote removed. Deleting it on GitHub needs `gh auth refresh -s delete_repo` (user).

14. (2026-10-29) **Guests**: bot answers other people too, owner is the master, others treated as
    strangers unless matched to a contact; known contacts get the owner's manner via a public-safe card.
    Answered by a tool-less sandboxed Claude; owner notified of every exchange.
15. Owner replies carry the quoted message; the brain saves who a guest is (first: the owner's mother).
16. "Wow" hooks for known contacts from their PUBLIC channel/bio only (user wanted people to go "how does
17. Study nagging toned down (user: too focused on deadlines): study job once a day, friendly, silent when nothing is due within 72h; brief mentions only <48h items in one line.
18. Guests found it too secretive → playful persona + games, and a whitelist `brain/public.md` of what may be said (everyone / known-only).
19. Playful tone was too «لوس» → guests get a serious, polite tone; games only on request, no emoji.
20. (2026-10-30) Secretary mode instead of paid lite mode: laptop off → queue + one notice per chat.
21. (2026-10-30) Telegram forum group with 5 topics becomes the main workspace (user wanted categorized output;
    designed, self-reviewed once: merged report topics, Worker group support, anonymous-admin + fallback cases).
22. (2026-10-30) Study tutor built (Moodle mirror via «مَمّد»'s token, local page index, nightly course-brain builder)
    and then fully REMOVED at the user's request: the real problem is time (work 6 days, only Fridays for study),
    not course knowledge. Don't rebuild it unless he asks. Lessons: headless claude -p can't write under ~/.claude;
    reading course files hit the 5-hour subscription limit.
24. (2026-10-31) Worker-poll network blips logged at most once a minute with context (was: bare "fetch failed" every 3s).
25. (2026-11-02) Worker poll got a 15s timeout: ~5% of requests to the Worker hang on the VPN, and with no timeout each hang stalled Telegram input for ~90s (log showed "fetch failed" every ~90s). Error log now names the cause (TimeoutError etc.).
23. (2026-10-30) Instead: a week-shaped Pesar Khaleh (Thursday closes work, Friday = study plan, work quiet on Friday).
    it know that?!"; line drawn at public content — private DMs/Gap/third parties would be creepy and leak).

## Decisions and why
- **Webhook + user token** instead of a bot account: no permission to create bots/PATs.
- **Commands use `!`**: Mattermost swallows unknown `/` commands client-side.
- **Single Claude session for Gap + Telegram + scheduled jobs**: user can follow up anywhere.
- **Durable Object, not KV**: KV is eventually consistent; the queue/heartbeat must be exact.
- **Lite mode uses the API, not the subscription**: subscription tokens belong to Claude's own apps /
  Claude Code; using them in a custom server risks the account. Running Claude Code itself on a VPS is fine.
- **Model**: Opus everywhere by default (`claude-opus-5-5` in the Worker, effort low for chat).
- **Guests never touch the main brain**: the main session can read the owner's Gap, Telegram, files and
  notes; one prompt injection from a stranger could leak them. So guests get a separate run with zero
  tools and only a sanitized card — person skills contain private judgements that must not reach the person.
- **Recommended free alternative if no API key**: "secretary mode" (queue only, answer when laptop is back).

## Mistakes / gotchas (don't repeat)
- Claude's auto-mode classifier blocks creating Mattermost webhooks/integrations → the user does it.
- PowerShell: `R` is an alias of `Invoke-History`; `[IO.File]` paths are relative to .NET's cwd, not
  PowerShell's — use absolute paths. `2>&1` on native exes makes false errors.
- A stale `getUpdates` offset from another bot swallows updates → bridge resets offset when bot id changes.
- `Start-Sleep` + check in one call is blocked; use background until-loops / Monitor.
- Diagnosing a token line by printing "the key part" leaked a token because `=` was missing → always
  validate with regex booleans only.
- Inline didn't appear: inline was disabled on that bot, and Telegram clients cache inline support → restart app.
- Gap posts made with the user token look like the user → tag them `props.from_bridge` and ignore on input,
  or the bridge would answer itself.
- `claude -p` lists the telegram MCP as "still connecting" at start; it becomes available shortly after.

## Open items
- Lite AI mode stays off (no API key); secretary mode chosen 2026-10-30.
- VPS: shelved by the user; don't raise it unless he does (plan in setup.md §7).
- Voice pipeline: recorder → speech-to-text → Telegram → brain (old bot @Voice_recorder_claude_bot; Groq blocked laptop's VPN IP).
- Gap channel display name is still «غلام حسین» (cosmetic).

## Cleanup 2026-11-02
- sync.mjs no longer publishes `state.json` (guest Telegram ids, session ids), `guests/`, `hw*` folders or `*.bak`. Older commits of this repo still contain state.json (private repo).
- `start-hidden.vbs` rotates `bridge.log` to `bridge.log.1` at start when it passes ~2 MB (Startup copy updated).
- Homework that Pesar Khaleh wrote lives in `Documents\study\`, not in the bridge folder.
- Old GitHub repo `mh9rashadi/gap-claude-bridge` (old commits contained `.env`) deleted by the user.

- 2026-11-02: on the HooshCode backend runs use `dontAsk` + `GLM_TOOLS` allow-list; `mcp__my-chrome__*` was missing, so Pesar Khaleh fell back to the empty chrome-devtools Chrome (no logins, e.g. Eyvan room booking failed). Added `mcp__my-chrome__*` to `GLM_TOOLS` and a BROWSER rule to SYSTEM (logged-in sites via my-chrome; no passwords/OTP; no pay/delete/send without OK). Note: no auto-mode classifier on this path, so my-chrome runs unchecked.
- 2026-11-02: Eyvan opened to full access (user: «محدودیت رو بردار، هر کاری می‌خواد انجام بده»). eyvan.mjs rewritten with room commands (rooms/day/free/mine/reserve/edit/cancel) + raw `call`; tested book+cancel on room 9. Note: «اتاق برای غدیر» means salon غدیر (a building), not a person.
- 2026-11-02: standing order (user): every Eyvan task goes through eyvan.mjs + token, never a browser/Chrome tab; Eyvan removed from the BROWSER rule examples.
Rule 2 restored: no Gap write exception. rajabi.mjs deleted 2026-11-03 at the user's request; Claude never posts to @a.rajabi.

- 2026-11-12: sessions per topic + brain choice per topic + `!new` with compaction (see architecture.md → Sessions per topic). Asked by the user: every new topic = separate session, model/agent chosen at start, no more fixed GLM; `!new` summarizes the old chat and hands it to the fresh session so context does not fill. Backup of the pre-change code: `bridge.mjs.bak-topics` (live folder only, not synced). Untested end to end on Telegram yet (bridge restarted clean; no real topic created).
- 2026-11-12: message batching (sliding 8 s window, cap 45 s, `!batch`): several quick messages in a row are merged into one request. Asked by the user. Restarted clean; not yet tested with real messages.
- 2026-11-12 (TRIAL, one day): Telegram relay through the Worker. Cause: bot replies were lost ("fetch failed") because api.telegram.org is unreachable from the laptop without a VPN, while workers.dev is reachable. Worker got `POST /laptop/tg/<method>` and `GET /laptop/tgfile/<path>` (Bearer LAPTOP_SECRET; token stays in the Worker, deployed version a2adb030). bridge.mjs `tgFetch`/`tgFile` use the relay when `.env` has `TG_VIA_WORKER=1`, falling back to direct if the relay fails. Verified: getMe + sendMessage via relay OK, no-auth → 403. Rollback: set `TG_VIA_WORKER=0` and restart the bridge (pre-change copies in `gap-claude-bridge\.pre-tgproxy\`). The user will say in Pesar Khaleh whether to make it permanent; if yes, drop the "trial" wording here and in architecture.md.
- 2026-11-12: the relay code was lost once: a Pesar Khaleh session edited bridge.mjs (voice retry) from a copy without it, and a later kill-restart within 30 s of a respawn made the supervisor roll back to an old `.last-good`. Restored = voice retry + relay, now also in `.last-good`. Gotcha: when restarting by killing the bridge, make sure it has been up > 30 s, or the supervisor treats it as a crash of new code and rolls back.
- 2026-11-12: speed audit (user: "Pesar Khaleh is very slow"). Measured: Worker 0.6 s, HooshCode 0.5 s, raw glm-5.3-flash call ~2 s; api.telegram.org unreachable. Costs per message before the fix: batch wait 8 s + router classifier 10-15 s (it spawned a full `claude -p` for one word) + main run 12-20 s even for "." + every Telegram send timing out (~10 s × up to 4 fallbacks) while api.telegram.org was blocked. Fixes: Telegram relay through the Worker (see above); `classifyDifficulty` is now a direct HooshCode `/v1/messages` call (thinking disabled, 10 s timeout, falls back to "normal"), ~2 s; default batch wait 8 → 3 s (`!batch 8` restores). Not changed: the main `claude -p` run (start-up ~3-4 s + model time); 3 s worker poll interval (Cloudflare free-plan request budget). Network drops (DNS ENOTFOUND, ECONNRESET, "worker poll failed 10 times in a row; restarting bridge") are the network's fault, not the code's.
- 2026-11-12: parallel sessions (user asked: several topics should work at the same time). Before: ONE global promise chain, so a 3-minute job in one topic blocked every other topic. Now per-session-key chains + MAX_PARALLEL=3 slots, local `target`, `running` map, per-run outbox, `!stop` per topic / `!stop all`, deferred restart. Tested live: the Kourosh job, the DM and topic «Test» ran at once (3 claude processes), a 4th message started as soon as a slot freed. Backups: `gap-claude-bridge\.backup-parallel-20261112-2154\` (and an earlier one). Also: relay sends now retry (2 s, 6 s) before giving up — a Kourosh draft reply was lost to a network blip during the test (the draft file itself was saved by the job). Gotcha hit twice today: killing the bridge < 30 s after a respawn triggers the supervisor rollback.
- 2026-11-12: auto-rotation of sessions (owner's request): after ROTATE_AFTER (default 100, .env, 0 = off) messages in one session (each topic, and `main`), the session is compacted like `!new` (summary to `brain/topics/`, carried into the next session) and a fresh one starts on the SAME model (S.brain / state.model untouched). Counter: `S.msgCount` / `state.mainMsgCount`, counted after each run (a batch counts all its messages), reset by `!new` too; shown in `!status`. If the summary fails, the session is kept and rotation is retried after the next message. Shared code: `closeSession()`, `maybeRotate()`. Counting started at 0 on 2026-11-12 (older messages of existing sessions are not counted). Tested offline with stubs, deployed; backup `.backup-rotate-20261112-2231\`.
- 2026-11-12: topic clean-up (owner's request: deleted topics kept their sessions). The Bot API sends no event on topic deletion. Now: (1) `!delete` → confirm with `!delete yes` → `archiveTopic()` (summary via summarizeSession + metadata + charter to `brain/trash/<date>-<name>-t<id>.md`, raw transcript copied as `.jsonl`, charter file moved there, run outbox removed, session dropped) → `deleteForumTopic`; result posted in ⚙️ سیستم. (2) Auto: a send failing with "message thread not found"/"TOPIC_ID_INVALID" → `topicGone()` queues an internal `/purge` on that topic's own chain (same archive, no Telegram call). (3) `probeTopics()` 20 s after start and every 12 h. Probe method matters: `sendChatAction` and a no-op `editForumTopic` return ok for DELETED topics; `reopenForumTopic` is reliable (deleted → TOPIC_ID_INVALID, open → TOPIC_NOT_MODIFIED; side effect: reopens a closed topic). First run purged #774 Test, #848 and #853 (old «Report to kourosh»). End-to-end `!delete` tested on a throwaway topic #941 (archived, gone in Telegram). Bot is admin with can_manage_topics. Backup `.backup-topicdel-20261112-2248\`.
- 2026-11-12: "!new hangs" report: it had NOT hung — the summary was written (topic-879-…-457792b1.md) and the session closed, but the "✅" reply was lost: the network was down at that moment (relay ×3, direct and DM fallback all "fetch failed"). Fix: undelivered Telegram replies (network errors only) go to `state.unsent` and `flushUnsent()` resends them every minute for 24 h with a "was ready N min ago" prefix. Also (owner's rule): a manual `!new` in an owner topic now drops the brain and shows the brain menu again (old brain shown first); the automatic 100-message rotation keeps the brain. `!brain` mid-chat still works: it resumes the SAME session on the new model (history kept). Tested on throwaway topic #964 (!brain → !new → awaiting → "3" → glm-5.3-flash → !delete). Backup `.backup-newbrain-20261112-2259\`.
