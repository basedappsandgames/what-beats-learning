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
		expect(html).toContain("Codex");
		expect(html).toContain("codex mcp add what-beats-learning --url https://whatbeatslearning.com/mcp");
		expect(html).toContain("codex mcp login what-beats-learning");
	});
});
