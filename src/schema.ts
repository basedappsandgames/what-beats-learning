export const SCHEMA_VERSION = "1";

export const SCHEMA_STATEMENTS = [
	"PRAGMA foreign_keys = ON",
	`CREATE TABLE IF NOT EXISTS study_decks (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL UNIQUE
	)`,
	`CREATE TABLE IF NOT EXISTS study_notes (
		id INTEGER PRIMARY KEY,
		front TEXT NOT NULL,
		back TEXT NOT NULL,
		extra TEXT,
		tags TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS study_cards (
		id INTEGER PRIMARY KEY,
		note_id INTEGER NOT NULL REFERENCES study_notes(id) ON DELETE CASCADE,
		deck_id INTEGER NOT NULL REFERENCES study_decks(id),
		direction TEXT NOT NULL CHECK (direction IN ('forward', 'reverse')),
		UNIQUE (note_id, direction)
	)`,
	`CREATE TABLE IF NOT EXISTS study_schedules (
		card_id INTEGER PRIMARY KEY REFERENCES study_cards(id) ON DELETE CASCADE,
		due INTEGER NOT NULL,
		stability REAL NOT NULL,
		difficulty REAL NOT NULL,
		elapsed_days REAL NOT NULL,
		scheduled_days REAL NOT NULL,
		learning_steps INTEGER NOT NULL,
		reps INTEGER NOT NULL,
		lapses INTEGER NOT NULL,
		state INTEGER NOT NULL,
		last_review INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS study_schedules_due ON study_schedules (due, state)`,
	`CREATE INDEX IF NOT EXISTS study_cards_deck ON study_cards (deck_id)`,
	`CREATE TABLE IF NOT EXISTS study_meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`,
] as const;
