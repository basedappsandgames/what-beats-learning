import { describe, expect, it } from "vitest";
import { GoogleHandler } from "../src/google-handler";

describe("legal pages", () => {
	it.each([
		["/docs/privacy", "Privacy Policy"],
		["/docs/terms", "Terms of Service"],
	])("serves %s", async (path, heading) => {
		const response = await GoogleHandler.request(`https://example.com${path}`);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(await response.text()).toContain(`<h1>${heading}</h1>`);
	});
});

describe("home page", () => {
	it("includes Grok, Claude, Cursor, and Codex install steps", async () => {
		const response = await GoogleHandler.request("https://whatbeatslearning.com/");
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain("https://whatbeatslearning.com/mcp");
		expect(html).toContain("Grok Bot");
		expect(html).toContain("please add this MCP and then prompt me to auth it");
		expect(html).toContain("Claude");
		expect(html).toContain("Customize → Connectors → Add custom connector");
		expect(html).toContain("Cursor");
		expect(html).toContain("Customize → MCPs");
		expect(html).toContain('"what-beats-learning"');
		expect(html).toContain("ChatGPT and Codex");
		expect(html).toContain("codex mcp add what-beats-learning --url https://whatbeatslearning.com/mcp");
		expect(html).toContain("codex mcp login what-beats-learning");
		expect(html).toContain("Plugins directory");
	});
});

describe("llms.txt", () => {
	it("serves homepage install steps and the agent VM install guide", async () => {
		const response = await GoogleHandler.request("https://whatbeatslearning.com/llms.txt");
		const text = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/plain");
		expect(text).toMatch(/^# What Beats Learning/u);
		expect(text).toContain("https://whatbeatslearning.com/mcp");
		expect(text).toContain("Grok Bot");
		expect(text).toContain('please add this MCP and then prompt me to auth it: "url": "https://whatbeatslearning.com/mcp"');
		expect(text).toContain("Customize → Connectors → Add custom connector");
		expect(text).toContain("Customize → MCPs");
		expect(text).toContain('"what-beats-learning"');
		expect(text).toContain("codex mcp add what-beats-learning --url https://whatbeatslearning.com/mcp");
		expect(text).toContain("codex mcp login what-beats-learning");
		expect(text).toContain("How to install on agents with VMs but not native custom MCP support");
		expect(text).toContain("POST https://whatbeatslearning.com/register");
		expect(text).toContain("token_endpoint_auth_method");
		expect(text).toContain("code_challenge_method=S256");
		expect(text).toContain("resource=https://whatbeatslearning.com/mcp");
		expect(text).toContain("application/x-www-form-urlencoded");
		expect(text).toContain("POST https://whatbeatslearning.com/token");
		expect(text).toContain("MCP-Protocol-Version");
	});

	it("uses the request origin for MCP and OAuth URLs", async () => {
		const response = await GoogleHandler.request("https://example.com/llms.txt");
		const text = await response.text();

		expect(text).toContain("https://example.com/mcp");
		expect(text).toContain("POST https://example.com/register");
		expect(text).not.toContain("https://whatbeatslearning.com");
	});
});
