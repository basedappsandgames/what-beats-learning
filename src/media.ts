const AUDIO_KIND = "audio";
const IMAGE_KIND = "image";
const CONTENT_TYPE = "audio/mpeg";
const IMAGE_CONTENT_TYPE = "image/png";
const MAX_TEXT_LENGTH = 500;
const MAX_IMAGE_SUBJECT_LENGTH = 80;
const MAX_IMAGE_PROMPT_LENGTH = 1500;
const MAX_IMPORT_URL_LENGTH = 2048;
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const IMAGE_PROVIDER = "workers-ai";
const IMPORT_PROVIDER = "import";
const IMPORT_MODEL = "url";
const IMAGE_WIDTH = 1024;
const IMAGE_HEIGHT = 1024;
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
	provider: string;
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

export type ImageResult = {
	hash: string;
	url: string;
	cached: boolean;
	provider: "workers-ai";
	model: string;
	subject: string;
	width: number;
	height: number;
};

export type ImportedImageResult = {
	hash: string;
	url: string;
	cached: boolean;
	provider: "import";
	model: "url";
	subject: string;
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

export function publicOrigin(request: Request, configured?: string): string {
	const requestUrl = new URL(request.url);
	if (requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1") {
		return requestUrl.origin;
	}
	const trimmed = configured?.trim();
	if (trimmed) return new URL(trimmed).origin;
	return requestUrl.origin;
}

function resultFromRow(
	row: MediaObjectRow,
	origin: string,
	cached: boolean,
	pace: AudioPace,
): AudioResult {
	if (row.kind !== AUDIO_KIND) throw new Error(`Unexpected media kind ${row.kind}`);
	if (row.provider !== "minimax" && row.provider !== "fish") {
		throw new Error(`Unexpected audio provider ${row.provider}`);
	}
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

export function normalizeImageSubject(subject: string): string {
	const normalized = subject.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
	if (!normalized) throw new Error("Image subject cannot be empty");
	if (normalized.length > MAX_IMAGE_SUBJECT_LENGTH) {
		throw new Error(`Image subject cannot exceed ${MAX_IMAGE_SUBJECT_LENGTH} characters`);
	}
	return normalized;
}

export function normalizeImagePrompt(prompt: string): string {
	const normalized = prompt.normalize("NFC").trim().replace(/\s+/gu, " ");
	if (!normalized) throw new Error("Image prompt cannot be empty");
	if (normalized.length > MAX_IMAGE_PROMPT_LENGTH) {
		throw new Error(`Image prompt cannot exceed ${MAX_IMAGE_PROMPT_LENGTH} characters`);
	}
	return normalized;
}

export async function imageHash(subject: string): Promise<string> {
	const bytes = new TextEncoder().encode(
		JSON.stringify({
			kind: IMAGE_KIND,
			provider: IMAGE_PROVIDER,
			model: IMAGE_MODEL,
			width: IMAGE_WIDTH,
			height: IMAGE_HEIGHT,
			subject,
		}),
	);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
}

function decodeBase64Image(value: string): Uint8Array {
	const payload = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
	try {
		const binary = atob(payload);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		if (bytes.length === 0) throw new Error("empty");
		return bytes;
	} catch {
		throw new Error("Workers AI image response was not valid base64");
	}
}

async function synthesizeFlux(
	prompt: string,
	ai: Ai,
): Promise<Uint8Array> {
	const form = new FormData();
	form.append("prompt", prompt);
	form.append("width", String(IMAGE_WIDTH));
	form.append("height", String(IMAGE_HEIGHT));
	const encoded = new Response(form);
	const contentType = encoded.headers.get("content-type");
	if (!contentType || !encoded.body) throw new Error("Failed to encode Flux request");
	const result = await ai.run(IMAGE_MODEL, {
		multipart: {
			body: encoded.body,
			contentType,
		},
	});
	if (typeof result?.image !== "string" || !result.image) {
		throw new Error("Workers AI image response did not contain image data");
	}
	return decodeBase64Image(result.image);
}

export async function generateImage(
	env: { MEDIA_BUCKET: R2Bucket; MEDIA_DB: D1Database; AI: Ai },
	input: { subject: string; prompt: string; replace?: boolean },
	origin: string,
	synthesize: (prompt: string) => Promise<Uint8Array> = (prompt) =>
		synthesizeFlux(prompt, env.AI),
): Promise<ImageResult> {
	const subject = normalizeImageSubject(input.subject);
	const prompt = normalizeImagePrompt(input.prompt);
	const replace = input.replace === true;
	const hash = await imageHash(subject);
	const existing = await env.MEDIA_DB.prepare(
		`SELECT hash, kind, provider, model, voice, lang, source_text,
				r2_key, content_type, byte_size, created_at
		 FROM media_objects WHERE hash = ?`,
	)
		.bind(hash)
		.first<MediaObjectRow>();
	if (existing && !replace) {
		if (existing.kind !== IMAGE_KIND) throw new Error(`Unexpected media kind ${existing.kind}`);
		return {
			hash: existing.hash,
			url: mediaUrl(origin, existing.hash),
			cached: true,
			provider: IMAGE_PROVIDER,
			model: existing.model,
			subject: existing.source_text,
			width: IMAGE_WIDTH,
			height: IMAGE_HEIGHT,
		};
	}
	if (existing && existing.kind !== IMAGE_KIND) {
		throw new Error(`Unexpected media kind ${existing.kind}`);
	}

	const bytes = await synthesize(prompt);
	const r2Key = `${IMAGE_KIND}/${hash}.png`;
	const object = await env.MEDIA_BUCKET.put(r2Key, bytes, {
		httpMetadata: {
			contentType: IMAGE_CONTENT_TYPE,
			cacheControl: "public, max-age=31536000, immutable",
		},
		customMetadata: { hash, provider: IMAGE_PROVIDER, subject },
	});
	if (!object) throw new Error("R2 did not store generated image");

	const createdAt = Date.now();
	if (existing) {
		await env.MEDIA_DB.prepare(
			`UPDATE media_objects
			 SET model = ?, source_text = ?, content_type = ?, byte_size = ?, created_at = ?
			 WHERE hash = ?`,
		)
			.bind(IMAGE_MODEL, subject, IMAGE_CONTENT_TYPE, object.size, createdAt, hash)
			.run();
	} else {
		await env.MEDIA_DB.prepare(
			`INSERT INTO media_objects
				(hash, kind, provider, model, voice, lang, source_text, r2_key,
				 content_type, byte_size, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(hash) DO NOTHING`,
		)
			.bind(
				hash,
				IMAGE_KIND,
				IMAGE_PROVIDER,
				IMAGE_MODEL,
				"",
				"",
				subject,
				r2Key,
				IMAGE_CONTENT_TYPE,
				object.size,
				createdAt,
			)
			.run();
	}

	return {
		hash,
		url: mediaUrl(origin, hash),
		cached: false,
		provider: IMAGE_PROVIDER,
		model: IMAGE_MODEL,
		subject,
		width: IMAGE_WIDTH,
		height: IMAGE_HEIGHT,
	};
}

/** Require a parseable https URL. */
export function requireHttpsImageUrl(urlString: string): URL {
	if (urlString.length > MAX_IMPORT_URL_LENGTH) {
		throw new Error(`Image URL cannot exceed ${MAX_IMPORT_URL_LENGTH} characters`);
	}
	let url: URL;
	try {
		url = new URL(urlString.trim());
	} catch {
		throw new Error("Invalid image URL");
	}
	if (url.protocol !== "https:") throw new Error("Image URL must use https");
	return url;
}

export function sniffImageContent(
	bytes: Uint8Array,
): { contentType: string; extension: string } | null {
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return { contentType: "image/png", extension: "png" };
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return { contentType: "image/jpeg", extension: "jpg" };
	}
	if (
		bytes.length >= 6 &&
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38 &&
		(bytes[4] === 0x37 || bytes[4] === 0x39) &&
		bytes[5] === 0x61
	) {
		return { contentType: "image/gif", extension: "gif" };
	}
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return { contentType: "image/webp", extension: "webp" };
	}
	return null;
}

async function readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
	if (!response.body) throw new Error("Image response had no body");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error(`Image exceeds maximum size of ${maxBytes} bytes`);
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function fetchImageBytes(
	urlString: string,
	fetcher: typeof fetch,
): Promise<Uint8Array> {
	const url = requireHttpsImageUrl(urlString).href;
	const response = await fetcher(url, {
		method: "GET",
		headers: { Accept: "image/*" },
	});
	if (!response.ok) throw new Error(`Image fetch failed with HTTP ${response.status}`);
	const bytes = await readBodyLimited(response, MAX_IMPORT_BYTES);
	if (bytes.length === 0) throw new Error("Image response was empty");
	return bytes;
}

export async function importedImageHash(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetch an externally generated image (Grok Imagine, Cursor, etc.), store it in
 * R2, and return an attachable hash. Cache identity is the content hash.
 */
export async function importImage(
	env: { MEDIA_BUCKET: R2Bucket; MEDIA_DB: D1Database },
	input: { url: string; subject: string },
	origin: string,
	fetcher: typeof fetch = fetch,
): Promise<ImportedImageResult> {
	const subject = normalizeImageSubject(input.subject);
	const bytes = await fetchImageBytes(input.url, fetcher);
	const sniffed = sniffImageContent(bytes);
	if (!sniffed) {
		throw new Error("URL did not return a PNG, JPEG, GIF, or WebP image");
	}
	const hash = await importedImageHash(bytes);
	const existing = await env.MEDIA_DB.prepare(
		`SELECT hash, kind, provider, model, voice, lang, source_text,
				r2_key, content_type, byte_size, created_at
		 FROM media_objects WHERE hash = ?`,
	)
		.bind(hash)
		.first<MediaObjectRow>();
	if (existing) {
		if (existing.kind !== IMAGE_KIND) throw new Error(`Unexpected media kind ${existing.kind}`);
		return {
			hash: existing.hash,
			url: mediaUrl(origin, existing.hash),
			cached: true,
			provider: IMPORT_PROVIDER,
			model: IMPORT_MODEL,
			subject: existing.source_text,
		};
	}

	const r2Key = `${IMAGE_KIND}/${hash}.${sniffed.extension}`;
	const object = await env.MEDIA_BUCKET.put(r2Key, bytes, {
		httpMetadata: {
			contentType: sniffed.contentType,
			cacheControl: "public, max-age=31536000, immutable",
		},
		customMetadata: { hash, provider: IMPORT_PROVIDER, subject },
	});
	if (!object) throw new Error("R2 did not store imported image");

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
			IMAGE_KIND,
			IMPORT_PROVIDER,
			IMPORT_MODEL,
			"",
			"",
			subject,
			r2Key,
			sniffed.contentType,
			object.size,
			createdAt,
		)
		.run();

	return {
		hash,
		url: mediaUrl(origin, hash),
		cached: false,
		provider: IMPORT_PROVIDER,
		model: IMPORT_MODEL,
		subject,
	};
}

export async function requireAudioHashes(db: D1Database, hashes: string[]): Promise<void> {
	await requireMediaHashes(db, hashes, "audio");
}

export async function requireImageHashes(db: D1Database, hashes: string[]): Promise<void> {
	await requireMediaHashes(db, hashes, "image");
}

export async function requireMediaHashes(
	db: D1Database,
	hashes: string[],
	kind: "audio" | "image",
): Promise<void> {
	const unique = [...new Set(hashes)];
	if (unique.length === 0) return;
	const placeholders = unique.map(() => "?").join(", ");
	const result = await db
		.prepare(
			`SELECT hash FROM media_objects WHERE kind = ? AND hash IN (${placeholders})`,
		)
		.bind(kind, ...unique)
		.all<{ hash: string }>();
	const found = new Set(result.results.map((row) => row.hash));
	const missing = unique.filter((hash) => !found.has(hash));
	if (missing.length) throw new Error(`Unknown ${kind} hash: ${missing.join(", ")}`);
}

export async function serveMedia(
	request: Request,
	bucket: R2Bucket,
	db: D1Database,
	hash: string,
): Promise<Response> {
	if (!/^[0-9a-f]{64}$/u.test(hash)) return new Response("Not found", { status: 404 });
	const row = await db
		.prepare("SELECT r2_key, content_type FROM media_objects WHERE hash = ?")
		.bind(hash)
		.first<{ r2_key: string; content_type: string }>();
	if (!row) return new Response("Not found", { status: 404 });

	if (request.method === "HEAD") {
		const object = await bucket.head(row.r2_key);
		if (!object) return new Response("Not found", { status: 404 });
		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set("Content-Type", row.content_type);
		headers.set("Accept-Ranges", "bytes");
		headers.set("Content-Length", String(object.size));
		headers.set("ETag", object.httpEtag);
		headers.set("X-Content-Type-Options", "nosniff");
		return new Response(null, { headers });
	}

	const object = await bucket.get(row.r2_key, { range: request.headers });
	if (!object) return new Response("Not found", { status: 404 });
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Content-Type", row.content_type);
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
