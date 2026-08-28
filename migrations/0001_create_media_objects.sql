CREATE TABLE media_objects (
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
);
