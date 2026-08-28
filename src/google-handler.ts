import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { privacyPolicyPage, termsOfServicePage } from "./legal-pages";
import { serveMedia } from "./media";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, type Props } from "./utils";
import {
	addApprovedClient,
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/", (c) => {
	const origin = new URL(c.req.url).origin;
	return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>What Beats Learning</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: Georgia, "Times New Roman", serif; margin: 0; background: #f4efe6; color: #1f1a14; }
    main { max-width: 40rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
    h1 { font-size: 2.1rem; letter-spacing: -0.02em; margin-bottom: 0.35rem; }
    p.lede { font-size: 1.15rem; line-height: 1.45; color: #4a4036; }
    code, .url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; background: #efe6d8; padding: 0.12em 0.35em; border-radius: 4px; }
    ul { line-height: 1.55; }
    a { color: #8a2f12; }
    footer { margin-top: 2.5rem; font-size: 0.9rem; color: #6b5e50; }
  </style>
</head>
<body>
  <main>
    <h1>What Beats Learning</h1>
    <p class="lede">A remote MCP for spaced-repetition tutoring. Sign in with Google, then point your agent at the streamable HTTP URL.</p>
    <p>Connect (OAuth required):</p>
    <ul>
      <li>Streamable HTTP: <span class="url">${origin}/mcp</span></li>
    </ul>
    <p>Each Google account gets its own isolated SQLite library with FSRS scheduling. Other users cannot read or write it.</p>
    <footer>
      Sign-in happens when an MCP client starts the OAuth flow — there is no separate login page.
      <br /><a href="/docs/privacy">Privacy</a> · <a href="/docs/terms">Terms</a>
    </footer>
  </main>
</body>
</html>`);
});

app.get("/docs/privacy", (c) => c.html(privacyPolicyPage()));
app.get("/docs/terms", (c) => c.html(termsOfServicePage()));
app.on(["GET", "HEAD"], "/media/:hash", (c) =>
	serveMedia(c.req.raw, c.env.MEDIA_BUCKET, c.env.MEDIA_DB, c.req.param("hash")),
);

app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
		const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);
		return redirectToGoogle(
			c.req.raw,
			c.env,
			stateToken,
			new Headers({ "Set-Cookie": sessionBindingCookie }),
		);
	}

	const { token: csrfToken, setCookie } = generateCSRFProtection();

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		csrfToken,
		server: {
			description:
				"What Beats Learning stores your spaced-repetition cards in a private library and lets your AI tutor quiz you with FSRS scheduling.",
			name: "What Beats Learning",
		},
		setCookie,
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	try {
		const formData = await c.req.raw.formData();
		const { clearCookie: clearCsrfCookie } = validateCSRFToken(formData, c.req.raw);

		const encodedState = formData.get("state");
		if (!encodedState || typeof encodedState !== "string") {
			return c.text("Missing state in form data", 400);
		}

		let state: { oauthReqInfo?: AuthRequest };
		try {
			state = JSON.parse(atob(encodedState));
		} catch {
			return c.text("Invalid state data", 400);
		}

		if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
			return c.text("Invalid request", 400);
		}

		const approvedClientCookie = await addApprovedClient(
			c.req.raw,
			state.oauthReqInfo.clientId,
			c.env.COOKIE_ENCRYPTION_KEY,
		);

		const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

		const headers = new Headers();
		headers.append("Set-Cookie", clearCsrfCookie);
		headers.append("Set-Cookie", approvedClientCookie);
		headers.append("Set-Cookie", sessionBindingCookie);

		return redirectToGoogle(c.req.raw, c.env, stateToken, headers);
	} catch (error: unknown) {
		console.error({ event: "oauth_authorize_error", error });
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		return c.text("Internal server error", 500);
	}
});

async function redirectToGoogle(
	request: Request,
	env: Env,
	stateToken: string,
	headers = new Headers(),
) {
	headers.set(
		"Location",
		getUpstreamAuthorizeUrl({
			clientId: env.GOOGLE_CLIENT_ID,
			redirectUri: new URL("/callback", request.url).href,
			scope: "openid email profile",
			state: stateToken,
			upstreamUrl: "https://accounts.google.com/o/oauth2/v2/auth",
		}),
	);
	return new Response(null, {
		headers,
		status: 302,
	});
}

app.get("/callback", async (c) => {
	let oauthReqInfo: AuthRequest;
	let clearSessionCookie: string;

	try {
		const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
		oauthReqInfo = result.oauthReqInfo;
		clearSessionCookie = result.clearCookie;
	} catch (error: unknown) {
		console.error({ event: "oauth_callback_state_error", error });
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		return c.text("Internal server error", 500);
	}

	if (!oauthReqInfo.clientId) {
		return c.text("Invalid OAuth request data", 400);
	}

	const code = c.req.query("code");
	if (!code) {
		return c.text("Missing code", 400);
	}

	const [accessToken, googleErrResponse] = await fetchUpstreamAuthToken({
		clientId: c.env.GOOGLE_CLIENT_ID,
		clientSecret: c.env.GOOGLE_CLIENT_SECRET,
		code,
		grantType: "authorization_code",
		redirectUri: new URL("/callback", c.req.url).href,
		upstreamUrl: "https://accounts.google.com/o/oauth2/token",
	});
	if (googleErrResponse) {
		return googleErrResponse;
	}

	const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!userResponse.ok) {
		console.error({
			event: "google_userinfo_failed",
			status: userResponse.status,
		});
		return c.text("Failed to fetch Google user info", 500);
	}

	const user = (await userResponse.json()) as Record<string, unknown>;
	if (
		typeof user.id !== "string" ||
		typeof user.name !== "string" ||
		typeof user.email !== "string"
	) {
		console.error({ event: "google_userinfo_invalid", user });
		return c.text("Google returned an invalid user profile", 500);
	}
	const { id, name, email } = user as { id: string; name: string; email: string };

	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: { label: name },
		props: {
			email,
			googleId: id,
			name,
		} satisfies Props,
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
		userId: id,
	});

	const headers = new Headers({
		Location: redirectTo,
		"Set-Cookie": clearSessionCookie,
	});

	return new Response(null, { status: 302, headers });
});

export { app as GoogleHandler };
