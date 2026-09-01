import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const plugin = JSON.parse(readFileSync(".codex-plugin/plugin.json", "utf8")) as {
	name: string;
	version: string;
	description: string;
	author: { name: string };
	mcpServers: string;
	interface: {
		displayName: string;
		websiteURL: string;
		privacyPolicyURL: string;
		termsOfServiceURL: string;
		defaultPrompt: string[];
		composerIcon: string;
		logo: string;
		category: string;
	};
};

const mcp = JSON.parse(readFileSync(".mcp.json", "utf8")) as {
	mcpServers: Record<string, { type: string; url: string }>;
};

const marketplace = JSON.parse(
	readFileSync(".agents/plugins/marketplace.json", "utf8"),
) as {
	plugins: Array<{
		name: string;
		source: { path: string };
		policy: { installation: string; authentication: string };
		category: string;
	}>;
};

const submission = JSON.parse(readFileSync("chatgpt-app-submission.json", "utf8")) as {
	schema_version: number;
	app_info: { subtitle: string; category: string };
	tools: Record<string, unknown>;
	test_cases: unknown[];
	negative_test_cases: unknown[];
};

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

	it("ships a PNG logo for the plugin listing", () => {
		const bytes = readFileSync("assets/icon.png");
		expect(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
			true,
		);
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
