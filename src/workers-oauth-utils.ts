import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";

const CSRF_COOKIE = "__Host-CSRF_TOKEN";
const STATE_COOKIE = "__Host-CONSENTED_STATE";
const APPROVED_COOKIE = "__Host-APPROVED_CLIENTS";
const TEN_MINUTES = 600;
const THIRTY_DAYS = 2_592_000;

export class OAuthError extends Error {
	constructor(
		public code: string,
		public description: string,
		public statusCode = 400,
	) {
		super(description);
		this.name = "OAuthError";
	}

	toResponse(): Response {
		return Response.json(
			{ error: this.code, error_description: this.description },
			{ status: this.statusCode },
		);
	}
}

function cookie(request: Request, name: string): string | null {
	const item = (request.headers.get("Cookie") ?? "")
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`));
	return item ? item.slice(name.length + 1) : null;
}

function clearCookie(name: string): string {
	return `${name}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

async function sha256(value: string): Promise<Uint8Array> {
	return new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
	);
}

function hexToBytes(value: string): Uint8Array | null {
	if (!/^[0-9a-f]{64}$/i.test(value)) return null;
	return Uint8Array.from(
		value.match(/.{2}/g) as string[],
		(byte) => Number.parseInt(byte, 16),
	);
}

function bytesToHex(value: Uint8Array): string {
	return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateCSRFProtection(): { token: string; setCookie: string } {
	const token = crypto.randomUUID();
	return {
		token,
		setCookie: `${CSRF_COOKIE}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${TEN_MINUTES}`,
	};
}

export function validateCSRFToken(
	formData: FormData,
	request: Request,
): { clearCookie: string } {
	const submitted = formData.get("csrf_token");
	const stored = cookie(request, CSRF_COOKIE);
	if (typeof submitted !== "string" || !stored || submitted !== stored) {
		throw new OAuthError("invalid_request", "Invalid CSRF token");
	}
	return { clearCookie: clearCookie(CSRF_COOKIE) };
}

export async function createOAuthState(
	oauthReqInfo: AuthRequest,
	kv: KVNamespace,
): Promise<{ stateToken: string }> {
	const stateToken = crypto.randomUUID();
	await kv.put(`oauth:state:${stateToken}`, JSON.stringify(oauthReqInfo), {
		expirationTtl: TEN_MINUTES,
	});
	return { stateToken };
}

export async function bindStateToSession(
	stateToken: string,
): Promise<{ setCookie: string }> {
	const digest = bytesToHex(await sha256(stateToken));
	return {
		setCookie: `${STATE_COOKIE}=${digest}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${TEN_MINUTES}`,
	};
}

export async function validateOAuthState(
	request: Request,
	kv: KVNamespace,
): Promise<{ oauthReqInfo: AuthRequest; clearCookie: string }> {
	const stateToken = new URL(request.url).searchParams.get("state");
	if (!stateToken) throw new OAuthError("invalid_request", "Missing state parameter");

	const stored = await kv.get(`oauth:state:${stateToken}`);
	if (!stored) throw new OAuthError("invalid_request", "Invalid or expired state");

	const expected = await sha256(stateToken);
	const actualHex = cookie(request, STATE_COOKIE);
	const actual = actualHex ? hexToBytes(actualHex) : null;
	if (!actual || !crypto.subtle.timingSafeEqual(expected, actual)) {
		throw new OAuthError("invalid_request", "OAuth state does not match this browser");
	}

	let oauthReqInfo: AuthRequest;
	try {
		oauthReqInfo = JSON.parse(stored) as AuthRequest;
	} catch {
		throw new OAuthError("server_error", "Stored OAuth state is invalid", 500);
	}

	await kv.delete(`oauth:state:${stateToken}`);
	return { oauthReqInfo, clearCookie: clearCookie(STATE_COOKIE) };
}

async function signingKey(secret: string): Promise<CryptoKey> {
	if (!secret) throw new Error("COOKIE_ENCRYPTION_KEY is required");
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

async function approvedClients(request: Request, secret: string): Promise<string[]> {
	const value = cookie(request, APPROVED_COOKIE);
	if (!value) return [];

	const separator = value.indexOf(".");
	if (separator === -1) return [];
	const signature = hexToBytes(value.slice(0, separator));
	if (!signature) return [];

	let payload: string;
	try {
		payload = atob(value.slice(separator + 1));
	} catch {
		return [];
	}

	const valid = await crypto.subtle.verify(
		"HMAC",
		await signingKey(secret),
		signature,
		new TextEncoder().encode(payload),
	);
	if (!valid) return [];

	try {
		const parsed = JSON.parse(payload) as unknown;
		return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
			? parsed
			: [];
	} catch {
		return [];
	}
}

export async function isClientApproved(
	request: Request,
	clientId: string,
	secret: string,
): Promise<boolean> {
	return (await approvedClients(request, secret)).includes(clientId);
}

export async function addApprovedClient(
	request: Request,
	clientId: string,
	secret: string,
): Promise<string> {
	const clients = Array.from(new Set([...(await approvedClients(request, secret)), clientId]));
	const payload = JSON.stringify(clients);
	const signature = bytesToHex(
		new Uint8Array(
			await crypto.subtle.sign(
				"HMAC",
				await signingKey(secret),
				new TextEncoder().encode(payload),
			),
		),
	);
	return `${APPROVED_COOKIE}=${signature}.${btoa(payload)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${THIRTY_DAYS}`;
}

export function renderApprovalDialog(
	_request: Request,
	options: {
		client: ClientInfo | null;
		server: { name: string; description: string };
		state: { oauthReqInfo: AuthRequest };
		csrfToken: string;
		setCookie: string;
	},
): Response {
	const client = escapeHtml(options.client?.clientName ?? "Unknown MCP client");
	const server = escapeHtml(options.server.name);
	const description = escapeHtml(options.server.description);
	const state = escapeHtml(btoa(JSON.stringify(options.state)));
	const csrf = escapeHtml(options.csrfToken);

	return new Response(
		`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width,initial-scale=1">
	<title>Authorize ${server}</title>
	<style>
		body{font:16px system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1.5rem;line-height:1.5}
		h1{font-size:1.5rem} .client{font-weight:600} form{margin-top:2rem}
		button{font:inherit;padding:.65rem 1rem;cursor:pointer}
	</style>
</head>
<body>
	<h1>Authorize ${server}</h1>
	<p><span class="client">${client}</span> wants to use this MCP server.</p>
	<p>${description}</p>
	<form method="post" action="/authorize">
		<input type="hidden" name="csrf_token" value="${csrf}">
		<input type="hidden" name="state" value="${state}">
		<button type="submit">Authorize</button>
	</form>
</body>
</html>`,
		{
			headers: {
				// Chrome applies form-action to the POST's 302 Location, so Google must be listed or Authorize appears to do nothing.
				"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'",
				"Content-Type": "text/html; charset=utf-8",
				"Set-Cookie": options.setCookie,
				"X-Frame-Options": "DENY",
			},
		},
	);
}
