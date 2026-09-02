# What Beats Learning

Remote MCP for spaced-repetition tutoring. Each Google account gets an isolated Durable Object SQLite library with FSRS scheduling.

Live Worker: [https://what-beats-learning.bagapps.workers.dev](https://what-beats-learning.bagapps.workers.dev)

## Connect

| Transport | URL |
|-----------|-----|
| Streamable HTTP | `https://what-beats-learning.bagapps.workers.dev/mcp` |
| Local | `http://localhost:8788/mcp` |

Cursor configuration:

```json
{
  "mcpServers": {
    "what-beats-learning": {
      "url": "https://what-beats-learning.bagapps.workers.dev/mcp"
    }
  }
}
```

MCP Inspector: `npx @modelcontextprotocol/inspector@latest` then connect to `/mcp`.

## Plugin (Cursor / Grok Bot)

This repo is an [Agent Plugin](https://agent-plugins.org/) (`plugin.json`, `mcp.json`, `skills/`) that wraps the live Streamable HTTP MCP above. Google OAuth is handled by the Worker; the plugin does not store client secrets or plugin variables.

Marketplace listing comes later. Until then, install locally in Cursor by copying this repository into a **real directory** (not a symlink out of that folder):

```
~/.cursor/plugins/local/what-beats-learning
```

At minimum copy `plugin.json`, `mcp.json`, and `skills/`. Restart Cursor or run **Developer: Reload Window**, then open Customize and confirm the plugin, skill, and MCP server. Sign in with Google when the client prompts.

In Grok Bot, add the plugin from **Plugins** once it is listed in a marketplace, then finish Google sign-in in the browser. Until then, connect the same remote MCP URL from the table above.

## Tools

| Tool | Purpose |
|------|---------|
| `create_card` | One atomic cue→answer note. `reverse: true` adds a delayed reverse |
| `create_cards` | Atomically create up to 50 notes |
| `add_reverse` | Add a delayed reverse for existing `card_ids` (idempotent) |
| `get_next_card` | Next due review, else a new card. `empty: true` if nothing is due |
| `update_sequence` | Grade a specific `card_id`; `rating` is required |
| `get_learning_style_prompt` | Pedagogy constitution for this user |
| `update_learning_style_prompt` | Merge feedback or replace/reset (short ack by default) |
| `list_decks` / `list_due_cards` | Inventory of now-servable cards |
| `whoami` | Signed-in identity + card counts |

Isolation: the library Durable Object is keyed by the Google subject in the verified OAuth token. Tool arguments never select another user's database.

## Google OAuth (you do this)

Create **two** OAuth 2.0 Web application clients: one for local, one for production.

1. [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) → Create credentials → OAuth client ID → **Web application**.
2. Configure the OAuth consent screen with scopes `openid`, `email`, `profile`.
3. Authorized JavaScript origins + redirect URIs:

   **Local**
   - Origin: `http://localhost:8788`
   - Redirect: `http://localhost:8788/callback`

   **Production**
   - Origin: `https://what-beats-learning.bagapps.workers.dev`
   - Redirect: `https://what-beats-learning.bagapps.workers.dev/callback`

4. Local: copy `.dev.vars.example` to `.dev.vars` (already created with a cookie key) and fill:

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   COOKIE_ENCRYPTION_KEY=<already set, or openssl rand -hex 32>
   ```

5. Production secrets (cookie key is already set):

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

## Local dev

Requires Node 22+ (repo has `.nvmrc`).

```bash
nvm use
npm install
# edit .dev.vars with Google client id/secret
npm start   # http://localhost:8788
npm test
npm run type-check
```

## Schema

The runtime has five tables: decks, notes, cards, FSRS schedules, and metadata. Existing v0.3 libraries are migrated from the old Anki-shaped tables when their Durable Object next starts.

Scheduling uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs). Each direction has its own schedule. Reverse cards start one day later so the forward answer is not immediately tested as a cue. `update_sequence` requires the calling LLM to pass `again | hard | good | easy`; the Worker does not infer ratings.
