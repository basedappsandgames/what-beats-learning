const AUDIO_KIND = "audio";
const CONTENT_TYPE = "audio/mpeg";
const MAX_TEXT_LENGTH = 500;
const MINIMAX_MODEL = "speech-2.8-turbo";
const MANDARIN_VOICE = "Chinese_patitent_teacher";
const CANTONESE_VOICE = "Cantonese_KindWoman";
const FISH_MODEL = "s2.1-pro-free";
const FISH_VOICE = "default";

export const AUDIO_PACES = ["slowest", "slow", "normal"] as const;
export type AudioPace = (typeof AUDIO_PACES)[number];
export const DEFAULT_AUDIO_PACE: AudioPace = "slow";
const PACE_SPEED: Record<AudioPace, number> = {
	slowest: 0.65,
	slow: 0.8,
	normal: 1,
};

type AudioProvider = "minimax" | "fish";

type VoiceConfig = {
	provider: AudioProvider;
	model: string;
	voice: string;
	lang: string;
	pace: AudioPace;
	speed: number;
};

type MediaBindings = {
	MEDIA_BUCKET: R2Bucket;
	MEDIA_DB: D1Database;
	MINIMAX_API_KEY: string;
	FISH_API_KEY: string;
};

type MediaObjectRow = {
	hash: string;
	kind: string;
	provider: AudioProvider;
	model: string;
	voice: string;
	lang: string;
	source_text: string;
	r2_key: string;
	content_type: string;
	byte_size: number;
	created_at: number;
};

export type AudioReference = {
	kind: "audio";
	hash: string;
};

export type AudioResult = {
	hash: string;
	url: string;
	cached: boolean;
	provider: AudioProvider;
	model: string;
	voice: string;
	lang: string;
	pace: AudioPace;
};

export function normalizeTtsText(text: string): string {
	const normalized = text.normalize("NFC").trim().replace(/\s+/gu, " ");
	if (!normalized) throw new Error("Audio text cannot be empty");
	if (normalized.length > MAX_TEXT_LENGTH) {
		throw new Error(`Audio text cannot exceed ${MAX_TEXT_LENGTH} characters`);
	}
	return normalized;
}

export function resolvePace(pace?: string): AudioPace {
	if (pace === undefined) return DEFAULT_AUDIO_PACE;
	if (pace === "slowest" || pace === "slow" || pace === "normal") return pace;
	throw new Error("pace must be slowest, slow, or normal");
}

export function resolveVoice(lang: string, pace?: string): VoiceConfig {
	const resolvedPace = resolvePace(pace);
	const speed = PACE_SPEED[resolvedPace];
	const normalized = lang.trim().replaceAll("_", "-").toLowerCase();
	if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(normalized)) {
		throw new Error("lang must be a BCP-47 language tag such as zh-CN, yue, or es");
	}

	if (
		normalized === "yue" ||
		normalized.startsWith("yue-") ||
		normalized === "zh-yue" ||
		normalized.startsWith("zh-yue-") ||
		normalized === "zh-hk" ||
		normalized === "zh-mo"
	) {
		return {
			provider: "minimax",
			model: MINIMAX_MODEL,
			voice: CANTONESE_VOICE,
			lang: "yue-HK",
			pace: resolvedPace,
			speed,
		};
	}

	if (
		normalized === "zh" ||
		normalized.startsWith("zh-") ||
		normalized === "cmn" ||
		normalized.startsWith("cmn-")
	) {
		return {
			provider: "minimax",
			model: MINIMAX_MODEL,
			voice: MANDARIN_VOICE,
			lang: "zh-CN",
			pace: resolvedPace,
			speed,
		};
	}

	return {
		provider: "fish",
		model: FISH_MODEL,
		voice: FISH_VOICE,
		lang: normalized,
		pace: resolvedPace,
		speed,
	};
}

export async function audioHash(text: string, config: VoiceConfig): Promise<string> {
	const bytes = new TextEncoder().encode(
		JSON.stringify({
			kind: AUDIO_KIND,
			provider: config.provider,
			model: config.model,
			voice: config.voice,
			lang: config.lang,
			pace: config.pace,
			text,
		}),
	);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
}

export function mediaUrl(origin: string, hash: string): string {
	return new URL(`/media/${hash}`, origin).href;
}

function resultFromRow(
	row: MediaObjectRow,
	origin: string,
	cached: boolean,
	pace: AudioPace,
): AudioResult {
	if (row.kind !== AUDIO_KIND) throw new Error(`Unexpected media kind ${row.kind}`);
	return {
		hash: row.hash,
		url: mediaUrl(origin, row.hash),
		cached,
		provider: row.provider,
		model: row.model,
		voice: row.voice,
		lang: row.lang,
		pace,
	};
}

function hexToBytes(hex: string): Uint8Array {
	if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(hex)) {
		throw new Error("MiniMax returned invalid audio data");
	}
	const bytes = new Uint8Array(hex.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

async function synthesizeMiniMax(
	text: string,
	config: VoiceConfig,
	apiKey: string,
	fetcher: typeof fetch,
): Promise<Uint8Array> {
	if (!apiKey) throw new Error("MINIMAX_API_KEY is not configured");
	const response = await fetcher("https://api.minimax.io/v1/t2a_v2", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: config.model,
			text,
			stream: false,
			language_boost: config.lang === "yue-HK" ? "Chinese,Yue" : "Chinese",
			output_format: "hex",
			voice_setting: {
				voice_id: config.voice,
				speed: config.speed,
				vol: 1,
				pitch: 0,
			},
			audio_setting: {
				sample_rate: 32000,
				bitrate: 64000,
				format: "mp3",
				channel: 1,
			},
		}),
	});
	if (!response.ok) throw new Error(`MiniMax TTS failed with HTTP ${response.status}`);

	const body = (await response.json()) as {
		data?: { audio?: unknown };
		base_resp?: { status_code?: unknown; status_msg?: unknown };
	};
	if (body.base_resp?.status_code !== 0) {
		throw new Error(
			`MiniMax TTS failed with status ${String(body.base_resp?.status_code)}: ${String(
				body.base_resp?.status_msg,
			)}`,
		);
	}
	if (typeof body.data?.audio !== "string") {
		throw new Error("MiniMax TTS response did not contain audio");
	}
	return hexToBytes(body.data.audio);
}

async function synthesizeFish(
	text: string,
	config: VoiceConfig,
	apiKey: string,
	fetcher: typeof fetch,
): Promise<ReadableStream> {
	if (!apiKey) throw new Error("FISH_API_KEY is not configured");
	const response = await fetcher("https://api.fish.audio/v1/tts", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			model: config.model,
		},
		body: JSON.stringify({
			text,
			format: "mp3",
			sample_rate: 44100,
			mp3_bitrate: 64,
			normalize: true,
			latency: "normal",
			prosody: {
				speed: config.speed,
				volume: 0,
				normalize_loudness: true,
			},
		}),
	});
	if (!response.ok) throw new Error(`Fish Audio TTS failed with HTTP ${response.status}`);
	if (!response.body) throw new Error("Fish Audio TTS response did not contain audio");
	return response.body;
}

export async function generateAudio(
	env: MediaBindings,
	input: { text: string; lang: string; pace?: string },
	origin: string,
	fetcher: typeof fetch = fetch,
): Promise<AudioResult> {
	const text = normalizeTtsText(input.text);
	const config = resolveVoice(input.lang, input.pace);
	const hash = await audioHash(text, config);
	const existing = await env.MEDIA_DB.prepare(
		`SELECT hash, kind, provider, model, voice, lang, source_text,
				r2_key, content_type, byte_size, created_at
		 FROM media_objects WHERE hash = ?`,
	)
		.bind(hash)
		.first<MediaObjectRow>();
	if (existing) return resultFromRow(existing, origin, true, config.pace);

	const audio =
		config.provider === "minimax"
			? await synthesizeMiniMax(text, config, env.MINIMAX_API_KEY, fetcher)
			: await synthesizeFish(text, config, env.FISH_API_KEY, fetcher);
	const r2Key = `${AUDIO_KIND}/${hash}.mp3`;
	const object = await env.MEDIA_BUCKET.put(r2Key, audio, {
		httpMetadata: {
			contentType: CONTENT_TYPE,
			cacheControl: "public, max-age=31536000, immutable",
		},
		customMetadata: { hash, provider: config.provider },
	});
	if (!object) throw new Error("R2 did not store generated audio");

	const createdAt = Date.now();
	await env.MEDIA_DB.prepare(
		`INSERT INTO media_objects
			(hash, kind, provider, model, voice, lang, source_text, r2_key,
			 content_type, byte_size, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(hash) DO NOTHING`,
	)
		.bind(
			hash,
			AUDIO_KIND,
			config.provider,
			config.model,
			config.voice,
			config.lang,
			text,
			r2Key,
			CONTENT_TYPE,
			object.size,
			createdAt,
		)
		.run();

	return resultFromRow(
		{
			hash,
			kind: AUDIO_KIND,
			provider: config.provider,
			model: config.model,
			voice: config.voice,
			lang: config.lang,
			source_text: text,
			r2_key: r2Key,
			content_type: CONTENT_TYPE,
			byte_size: object.size,
			created_at: createdAt,
		},
		origin,
		false,
		config.pace,
	);
}

export async function requireAudioHashes(db: D1Database, hashes: string[]): Promise<void> {
	const unique = [...new Set(hashes)];
	if (unique.length === 0) return;
	const placeholders = unique.map(() => "?").join(", ");
	const result = await db
		.prepare(`SELECT hash FROM media_objects WHERE kind = 'audio' AND hash IN (${placeholders})`)
		.bind(...unique)
		.all<{ hash: string }>();
	const found = new Set(result.results.map((row) => row.hash));
	const missing = unique.filter((hash) => !found.has(hash));
	if (missing.length) throw new Error(`Unknown audio hash: ${missing.join(", ")}`);
}

export async function serveAudio(
	request: Request,
	bucket: R2Bucket,
	hash: string,
): Promise<Response> {
	if (!/^[0-9a-f]{64}$/u.test(hash)) return new Response("Not found", { status: 404 });
	const key = `${AUDIO_KIND}/${hash}.mp3`;

	if (request.method === "HEAD") {
		const object = await bucket.head(key);
		if (!object) return new Response("Not found", { status: 404 });
		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set("Accept-Ranges", "bytes");
		headers.set("Content-Length", String(object.size));
		headers.set("ETag", object.httpEtag);
		headers.set("X-Content-Type-Options", "nosniff");
		return new Response(null, { headers });
	}

	const object = await bucket.get(key, { range: request.headers });
	if (!object) return new Response("Not found", { status: 404 });
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Accept-Ranges", "bytes");
	headers.set("ETag", object.httpEtag);
	headers.set("X-Content-Type-Options", "nosniff");

	let status = 200;
	if (object.range) {
		const suffix =
			"suffix" in object.range && typeof object.range.suffix === "number"
				? object.range.suffix
				: null;
		const start =
			suffix === null
				? "offset" in object.range && typeof object.range.offset === "number"
					? object.range.offset
					: 0
				: Math.max(0, object.size - suffix);
		const length =
			suffix === null
				? "length" in object.range && typeof object.range.length === "number"
					? object.range.length
					: object.size - start
				: Math.min(suffix, object.size);
		headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${object.size}`);
		headers.set("Content-Length", String(length));
		status = 206;
	} else {
		headers.set("Content-Length", String(object.size));
	}

	return new Response(object.body, { status, headers });
}
