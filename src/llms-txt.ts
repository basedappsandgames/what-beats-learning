export function llmsTxt(origin: string): string {
	return `# What Beats Learning

> A remote MCP for spaced-repetition tutoring. Connect your agent, sign in with Google, then ask it to make flashcards.

MCP URL: ${origin}/mcp

Privacy: ${origin}/docs/privacy
Terms: ${origin}/docs/terms

## Install

### Grok Bot

Tell your Bot:

\`\`\`
please add this MCP and then prompt me to auth it: "url": "${origin}/mcp"
\`\`\`

Then sign in with Google and ask Bot to make you any flashcards you want.

### Claude

1. Go to Customize → Connectors → Add custom connector.
2. Name it What Beats Learning and paste ${origin}/mcp.
3. Select the recommended settings, then Continue.
4. Authorize, sign in with Google, and ask Claude to make any flashcards you want.

### Cursor

Open Customize → MCPs (or Cursor Settings → MCP). Add a custom server with:

\`\`\`
{
  "mcpServers": {
    "what-beats-learning": {
      "url": "${origin}/mcp"
    }
  }
}
\`\`\`

Connect, sign in with Google, then ask Cursor to make you any flashcards you want.

### ChatGPT and Codex

In a terminal:

\`\`\`
codex mcp add what-beats-learning --url ${origin}/mcp
codex mcp login what-beats-learning
\`\`\`

Sign in with Google when prompted. In the ChatGPT desktop app you can paste ${origin}/mcp under Settings → MCP servers, or install What Beats Learning from the Plugins directory when it is listed. Then ask it to make you any flashcards you want.

Each Google account gets its own isolated SQLite library with FSRS scheduling. Other users cannot read or write it.

Sign-in happens when an MCP client starts the OAuth flow — there is no separate login page.

## How to install on agents with VMs but not native custom MCP support

When agent doesn't have a one-click "add MCP server" button like Claude or Cursor. Instead, you just ask it — agent builds the integration itself, including the OAuth sign-in.

### For your users (the short version)

1. Tell agent: **"Connect to the What Beats Learning MCP at ${origin}/mcp"**
2. Agent will reply with a Google sign-in link. Open it on your phone and sign in.
3. After signing in, your browser tries to open a page that fails to load — that's expected. Copy the full URL from the address bar and paste it back to Agent.
4. Done. Ask Agent to make flashcards, quiz you, or run a review session.

Each Google account gets its own isolated SQLite library with FSRS scheduling. Other users cannot read or write it.

### What Agent does behind the scenes

For the technically curious — this is the exact flow an agent follows:

**1. Register an OAuth client** (dynamic client registration, public client):

\`\`\`
POST ${origin}/register
Content-Type: application/json

{
  "redirect_uris": ["http://127.0.0.1:8765/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "client_name": "AGENT"
}
\`\`\`

Save the returned \`client_id\`.

**2. Build the sign-in link** (OAuth 2.1 + PKCE S256):

\`\`\`
${origin}/authorize
  ?response_type=code
  &client_id=<client_id>
  &redirect_uri=http://127.0.0.1:8765/callback
  &code_challenge=<S256 challenge>
  &code_challenge_method=S256
  &state=<random>
  &resource=${origin}/mcp
\`\`\`

The \`resource\` parameter (RFC 8707) is required.

**3. User signs in with Google**, then pastes back the redirect URL. Extract \`code\` from its query string.

**4. Exchange the code for tokens.** ⚠️ The token endpoint requires \`application/x-www-form-urlencoded\`, not JSON:

\`\`\`
POST ${origin}/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<code>
&redirect_uri=http://127.0.0.1:8765/callback
&client_id=<client_id>
&code_verifier=<verifier>
\`\`\`

Store \`access_token\`, \`refresh_token\`, and expiry. Refresh with \`grant_type=refresh_token\` (also form-encoded) when the access token expires.

**5. Talk MCP over streamable HTTP.** \`POST ${origin}/mcp\` with:

\`\`\`
Accept: application/json, text/event-stream
Authorization: Bearer <access_token>
\`\`\`

Then the standard handshake: \`initialize\` → \`notifications/initialized\` → \`tools/list\` / \`tools/call\`. Honor the \`Mcp-Session-Id\` response header and send \`MCP-Protocol-Version\` on subsequent requests.

### Notes

- Sign-in happens when the client starts the OAuth flow — there is no separate login page.
- The \`127.0.0.1\` redirect never loads on the user's phone; the auth code is recovered by copying it from the address bar. Any loopback port works.
- Available tools include \`whoami\`, \`create_card\` / \`create_cards\`, \`get_next_card\`, \`update_sequence\` (grade + FSRS reschedule), \`list_decks\`, \`list_due_cards\`, \`list_cards\`, and audio/image generation + attachment tools. Call \`tools/list\` at session start rather than hardcoding them.
`;
}
