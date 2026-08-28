import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			// Workers AI is always remote; tests inject Flux. Keep the pool local.
			remoteBindings: false,
		}),
	],
});
