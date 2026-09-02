import { describe, expect, it } from "vitest";
import marketplace from "../.agents/plugins/marketplace.json";
import plugin from "../.codex-plugin/plugin.json";
import mcp from "../.mcp.json";
import submission from "../chatgpt-app-submission.json";

describe("Codex / ChatGPT plugin package", () => {
	it("has a complete plugin.json for directory listing", () => {
		expect(plugin.name).toBe("what-beats-learning");
		expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(plugin.description.length).toBeGreaterThan(10);
		expect(plugin.author.name).toBeTruthy();
		expect(plugin.mcpServers).toBe("./.mcp.json");
		expect(plugin.interface.displayName).toBe("What Beats Learning");
		expect(plugin.interface.category).toBe("Education");
		expect(plugin.interface.websiteURL).toBe("https://whatbeatslearning.com");
		expect(plugin.interface.privacyPolicyURL).toMatch(/^https:\/\//);
		expect(plugin.interface.termsOfServiceURL).toMatch(/^https:\/\//);
		expect(plugin.interface.composerIcon).toBe("./assets/icon.png");
		expect(plugin.interface.logo).toBe("./assets/icon.png");
		expect(plugin.interface.defaultPrompt).toHaveLength(3);
		for (const prompt of plugin.interface.defaultPrompt) {
			expect(prompt.length).toBeGreaterThan(0);
			expect(prompt.length).toBeLessThanOrEqual(128);
		}
	});

	it("points the bundled MCP server at the public HTTP endpoint", () => {
		expect(mcp.mcpServers["what-beats-learning"]).toEqual({
			type: "http",
			url: "https://whatbeatslearning.com/mcp",
		});
	});

	it("exposes the repo-root plugin in the local marketplace", () => {
		expect(marketplace.plugins).toHaveLength(1);
		expect(marketplace.plugins[0]?.name).toBe("what-beats-learning");
		expect(marketplace.plugins[0]?.source.path).toBe("./");
		expect(marketplace.plugins[0]?.policy.installation).toBe("AVAILABLE");
		expect(marketplace.plugins[0]?.policy.authentication).toBe("ON_INSTALL");
		expect(marketplace.plugins[0]?.category).toBe("Education");
	});

	it("pre-fills ChatGPT store submission metadata", () => {
		expect(submission.schema_version).toBe(1);
		expect(submission.app_info.category).toBe("EDUCATION");
		expect(submission.app_info.subtitle.length).toBeLessThanOrEqual(30);
		expect(Object.keys(submission.tools).length).toBeGreaterThanOrEqual(16);
		expect(submission.test_cases.length).toBeGreaterThanOrEqual(5);
		expect(submission.negative_test_cases.length).toBeGreaterThanOrEqual(3);
	});
});
