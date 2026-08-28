import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	audioHash,
	generateAudio,
	normalizeTtsText,
	publicOrigin,
	resolveVoice,
	serveAudio,
} from "../src/media";

describe("audio cache identity", () => {
	beforeAll(async () => {
		await env.MEDIA_DB.prepare(`CREATE TABLE media_objects (
			hash TEXT PRIMARY KEY,
			kind TEXT NOT NULL,
			provider TEXT NOT NULL,
			model TEXT NOT NULL,
			voice TEXT NOT NULL,
			lang TEXT NOT NULL,
			source_text TEXT NOT NULL,
			r2_key TEXT NOT NULL UNIQUE,
			content_type TEXT NOT NULL,
			byte_size INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`).run();
	});

	it("normalizes Unicode and whitespace without changing punctuation or case", () => {
		expect(normalizeTtsText("  ni\t hao\n")).toBe("ni hao");
		expect(normalizeTtsText("ni\u3000\u3000hao")).toBe("ni hao");
		expect(normalizeTtsText("Cafe\u0301")).toBe("Café");
		expect(normalizeTtsText("Ni hao?")).toBe("Ni hao?");
	});

	it("gives equivalent whitespace the same hash", async () => {
		const voice = resolveVoice("en-US");
		const first = await audioHash(normalizeTtsText("ni hao"), voice);
		const second = await audioHash(normalizeTtsText("  ni   hao  "), voice);
		expect(first).toBe(second);
	});

	it("defaults pace to slow and hashes other paces separately", async () => {
		const omitted = resolveVoice("zh-CN");
		const slow = resolveVoice("zh-CN", "slow");
		expect(omitted.pace).toBe("slow");
		expect(omitted.speed).toBe(0.8);
		expect(await audioHash("你好", omitted)).toBe(await audioHash("你好", slow));
		expect(await audioHash("你好", resolveVoice("zh-CN", "slowest"))).not.toBe(
			await audioHash("你好", slow),
		);
		expect(await audioHash("你好", resolveVoice("zh-CN", "normal"))).not.toBe(
			await audioHash("你好", slow),
		);
	});

	it("pins public media URLs to PUBLIC_ORIGIN except on localhost", () => {
		expect(
			publicOrigin(
				new Request("https://what-beats-learning.bagapps.workers.dev/mcp"),
				"https://whatbeatslearning.com/",
			),
		).toBe("https://whatbeatslearning.com");
		expect(
			publicOrigin(new Request("http://localhost:8788/mcp"), "https://whatbeatslearning.com"),
		).toBe("http://localhost:8788");
	});

	it("routes Mandarin and Cantonese to their exact MiniMax voices", () => {
		expect(resolveVoice("zh-CN")).toMatchObject({
			provider: "minimax",
			model: "speech-2.8-turbo",
			voice: "Chinese_patitent_teacher",
			lang: "zh-CN",
		});
		expect(resolveVoice("yue")).toMatchObject({
			provider: "minimax",
			voice: "Cantonese_KindWoman",
			lang: "yue-HK",
		});
		expect(resolveVoice("es")).toMatchObject({
			provider: "fish",
			model: "s2.1-pro-free",
		});
	});

	it("stores a Fish response once and serves ranged audio from R2", async () => {
		const fetcher: typeof fetch = vi.fn(async () => {
			return new Response(new Uint8Array([1, 2, 3, 4]), {
				headers: { "Content-Type": "audio/mpeg" },
			});
		});
		const bindings = {
			MEDIA_DB: env.MEDIA_DB,
			MEDIA_BUCKET: env.MEDIA_BUCKET,
			MINIMAX_API_KEY: "test-minimax-key",
			FISH_API_KEY: "test-fish-key",
		};

		const created = await generateAudio(
			bindings,
			{ text: "  hola   mundo ", lang: "es" },
			"https://example.com",
			fetcher,
		);
		const cached = await generateAudio(
			bindings,
			{ text: "hola mundo", lang: "es" },
			"https://example.com",
			fetcher,
		);

		expect(created.cached).toBe(false);
		expect(created.pace).toBe("slow");
		expect(cached).toMatchObject({ cached: true, hash: created.hash, pace: "slow" });
		expect(fetcher).toHaveBeenCalledTimes(1);

		const response = await serveAudio(
			new Request(created.url, { headers: { Range: "bytes=1-2" } }),
			env.MEDIA_BUCKET,
			created.hash,
		);
		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe("bytes 1-2/4");
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3]);
	});

	it("calls MiniMax with the exact Mandarin voice", async () => {
		const fetcher: typeof fetch = vi.fn(async (_input, init) => {
			const request = JSON.parse(String(init?.body)) as {
				model: string;
				language_boost: string;
				voice_setting: { voice_id: string; speed: number };
			};
			expect(request).toMatchObject({
				model: "speech-2.8-turbo",
				language_boost: "Chinese",
				voice_setting: { voice_id: "Chinese_patitent_teacher", speed: 0.8 },
			});
			return Response.json({
				data: { audio: "01020304", status: 2 },
				base_resp: { status_code: 0, status_msg: "success" },
			});
		});

		const generated = await generateAudio(
			{
				MEDIA_DB: env.MEDIA_DB,
				MEDIA_BUCKET: env.MEDIA_BUCKET,
				MINIMAX_API_KEY: "test-minimax-key",
				FISH_API_KEY: "test-fish-key",
			},
			{ text: "你好", lang: "zh-CN" },
			"https://example.com",
			fetcher,
		);

		expect(generated).toMatchObject({
			cached: false,
			provider: "minimax",
			voice: "Chinese_patitent_teacher",
			pace: "slow",
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
