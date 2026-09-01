import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("OAuth discovery", () => {
	it("advertises CIMD and public-client token auth for ChatGPT", async () => {
		const response = await SELF.fetch(
			"https://example.com/.well-known/oauth-authorization-server",
		);
		expect(response.status).toBe(200);
		const metadata = (await response.json()) as {
			client_id_metadata_document_supported?: boolean;
			token_endpoint_auth_methods_supported?: string[];
		};
		expect(metadata.client_id_metadata_document_supported).toBe(true);
		expect(metadata.token_endpoint_auth_methods_supported).toContain("none");
	});

	it("rejects authorize without a client_id locally instead of throwing", async () => {
		const response = await SELF.fetch("https://example.com/authorize");
		expect(response.status).toBe(400);
		expect(await response.text()).toMatch(/client/i);
	});
});
