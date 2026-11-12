# gap-claude-bridge

Chat with Claude Code from Gap (Basalam's Mattermost). Messages you write in one private channel are run through `claude -p` on this laptop and the reply is posted back via an incoming webhook.

## Restore on a new machine

1. Clone to `C:\Users\M.H.Rashadi\gap-claude-bridge` (paths in `start-hidden.vbs` and `.env` assume this).
2. Copy `.env.example` to `.env` and fill:
   - `MM_TOKEN`: Gap cookie `MMAUTHTOKEN` (DevTools > Application > Cookies).
   - `WEBHOOK_URL`: the channel's incoming webhook (Integrations > Incoming Webhooks).
3. Needs Node 18+ and Claude Code (`claude`) logged in.
4. Test with `start.cmd`.
5. Autostart: copy `start-hidden.vbs` to `shell:startup` as `gap-claude-bridge.vbs`.

## Files

- `bridge.mjs`: the bridge (websocket listener + Claude runner + webhook replies). Send `/new` in the channel to start a fresh conversation.
- `gap.mjs`: read-only Gap helper (unread, channels, read, search, inbox).
- `start.cmd`: run with a visible window. `start-hidden.vbs`: run hidden, log to `bridge.log`.

Never commit `.env`; it holds your Gap session token and the webhook URL.
