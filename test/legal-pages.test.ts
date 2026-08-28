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
