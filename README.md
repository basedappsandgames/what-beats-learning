# What Beats Learning

Remote MCP for spaced-repetition tutoring. Each Google account gets an isolated Durable Object SQLite library with FSRS scheduling.

Live site: [https://whatbeatslearning.com](https://whatbeatslearning.com)

## Connect

| Transport | URL |
|-----------|-----|
| Streamable HTTP | `https://whatbeatslearning.com/mcp` |
| Workers.dev | `https://what-beats-learning.bagapps.workers.dev/mcp` |
| Local | `http://localhost:8788/mcp` |

Cursor configuration:

```json
{
  "mcpServers": {
    "what-beats-learning": {
      "url": "https://whatbeatslearning.com/mcp"
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

## Plugin (ChatGPT / Codex)

Codex / ChatGPT desktop:

```bash
codex mcp add what-beats-learning --url https://whatbeatslearning.com/mcp
codex mcp login what-beats-learning
```

This repo is also an MCP-only Codex/ChatGPT plugin package (`.codex-plugin/plugin.json`, `.mcp.json`, `assets/icon.png`). For local directory testing, the repo marketplace is `.agents/plugins/marketplace.json` (`codex plugin marketplace add .` from the repo root, then restart ChatGPT desktop). There is no `.app.json` yet: that file is only added after ChatGPT developer mode issues a `plugin_asdk_app…` connection ID. Public listing does not use that ID.

To submit to the ChatGPT / Codex Plugins Directory:

1. Verify the OpenAI organization (Apps Management write access + developer/business identity).
2. Open the [plugin submission portal](https://developers.openai.com/plugins/deploy/submission), create a plugin **with MCP**, and use the universal URL `https://whatbeatslearning.com/mcp`.
3. Listing copy, logo, category, website, privacy, and terms are already in `.codex-plugin/plugin.json`. Tool hint justifications and sample prompts are in `chatgpt-app-submission.json`.
4. When the portal asks for domain verification, host the exact token at `https://whatbeatslearning.com/.well-known/openai-apps-challenge` (plain text, that token only).
5. Scan tools, add five positive and three negative test cases, then submit. Publishing is a separate step after review.

## Tools

| Tool | Purpose |
|------|---------|
| `create_card` | One atomic cue→answer note. `reverse: true` adds a delayed reverse |
| `create_cards` | Atomically create up to 50 notes |
| `generate_audio` | Generate or reuse a globally cached pronunciation clip |
| `attach_audio` | Attach generated audio to an existing note field |
| `generate_image` | Prefer another default image gen tool first; else generate or reuse a cached study image (Workers AI Flux) |
| `import_image` | Fetch a host-tool image URL (Grok Imagine, etc.) into R2; returns an attachable hash |
| `attach_image` | Attach generated or imported image to an existing note field |
| `add_reverse` | Add a delayed reverse for existing `card_ids` (idempotent) |
| `get_next_card` | Next due review, else a new card. `empty: true` if nothing is due |
| `update_sequence` | Grade a specific `card_id`; `rating` is required |
| `get_learning_style_prompt` | Pedagogy constitution for this user |
| `update_learning_style_prompt` | Merge feedback or replace/reset (short ack by default) |
| `list_decks` / `list_due_cards` | Deck counts and now-servable queue |
| `list_cards` | Full library inventory with card ids and media hashes |
| `whoami` | Signed-in identity + card counts |

Isolation: the library Durable Object is keyed by the Google subject in the verified OAuth token. Tool arguments never select another user's database.

## Audio

`generate_audio` requires explicit text and a BCP-47 language tag. Mandarin uses MiniMax `speech-2.8-turbo` with `Chinese_patitent_teacher`; Cantonese uses `Cantonese_KindWoman`; other languages use Fish Audio `s2.1-pro-free`. Provider failures are returned directly—there is no cross-provider fallback.

Pace is one of `slowest` (0.65×), `slow` (0.8×, default), or `normal` (1×). Cache identity uses NFC-normalized, trimmed text with whitespace runs collapsed to one space, plus language, pace, provider, model, and voice. R2 stores the MP3 once and D1 stores its metadata. `create_card` can attach the returned hash while creating a note, and `attach_audio` can add it later.

## Images

Prefer a host image tool (Grok Imagine, Cursor, …), then `import_image` with the HTTPS URL and a short `subject` label. That downloads PNG/JPEG/GIF/WebP (max 8MB), stores bytes in R2 keyed by content hash, and returns an attachable hash.

`generate_image` is the fallback when no host tool is available. It takes a short stable `subject` (the cache key) and a `prompt` (the drawing instruction). Workers AI `flux-2-klein-4b` runs only on a cache miss, or when `replace: true` overwrites a bad subject cache. `tibia` and `Tibia` are the same subject; two different anatomy-book prompts for `tibia` share the first image unless replaced. Use a different subject if you need a second view (`tibia anterior`). Attach with `create_card` `media.kind: "image"` or `attach_image` (`replace: true` swaps an existing field image).

Apply D1 migrations before deploying a version that uses audio:

```bash
npx wrangler d1 migrations apply what-beats-learning-media --remote
```

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
   MINIMAX_API_KEY=...
   FISH_API_KEY=...
   ```

5. Production secrets (cookie key is already set):

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put MINIMAX_API_KEY
   npx wrangler secret put FISH_API_KEY
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

Each user library has decks, notes, cards, FSRS schedules, note media references, and metadata. Existing libraries add the media-reference table when their Durable Object next starts. Generated audio bytes are stored once in R2; a global D1 table indexes each clip by a hash of its normalized text, language, provider, model, and voice.

Scheduling uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs). Each direction has its own schedule. Reverse cards start one day later so the forward answer is not immediately tested as a cue. `update_sequence` requires the calling LLM to pass `again | hard | good | easy`; the Worker does not infer ratings.
