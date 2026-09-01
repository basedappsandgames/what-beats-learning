import { DurableObject } from "cloudflare:workers";
import {
	type Card as FsrsCard,
	type Grade,
	createEmptyCard,
	fsrs,
	Rating,
	State,
} from "ts-fsrs";
import { renderPedagogyPrompt, type PedagogyAdaptation } from "./pedagogy";
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "./schema";

const scheduler = fsrs();
const DEFAULT_DECK_ID = 1;
const REVERSE_DELAY_MS = 24 * 60 * 60 * 1000;

export type RatingName = "again" | "hard" | "good" | "easy";
type Direction = "forward" | "reverse";
export type NoteField = "front" | "back" | "extra";
export type MediaAttachment = {
	field: NoteField;
	kind: "audio" | "image";
	hash: string;
};
type Sql = DurableObjectStorage["sql"];

const RATING_TO_ENUM: Record<RatingName, Grade> = {
	again: Rating.Again,
	hard: Rating.Hard,
	good: Rating.Good,
	easy: Rating.Easy,
};

type ScheduleRow = {
	card_id: number;
	due: number;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	learning_steps: number;
	reps: number;
	lapses: number;
	state: number;
	last_review: number | null;
};

type CardPayloadRow = ScheduleRow & {
	note_id: number;
	deck: string;
	direction: string;
	front: string;
	back: string;
	extra: string | null;
	tags: string;
};

type ServedCard = {
	empty: false;
	card_id: number;
	note_id: number;
	deck: string;
	direction: Direction;
	front: string;
	due: string;
	state: string;
	reps: number;
	lapses: number;
	queue_reason: "review_due" | "new_card";
	tags: string;
	front_media: MediaAttachment[];
	answer_for_teacher: {
		back: string;
		extra: string | null;
		media: MediaAttachment[];
		note: string;
	};
};

type EmptyQueue = {
	empty: true;
	message: string;
	next_due: string | null;
	due_in_seconds: number | null;
	hint?: string;
};

export type NextCardResult = ServedCard | EmptyQueue;

export type CreateCardInput = {
	front: string;
	back: string;
	deck?: string;
	tags?: string;
	extra?: string;
	reverse?: boolean;
	media?: MediaAttachment[];
};

export type UpdateSequenceInput = {
	cardId: number;
	rating: RatingName;
};

function stateName(value: number): string {
	switch (value) {
		case State.New:
			return "new";
		case State.Learning:
			return "learning";
		case State.Review:
			return "review";
		case State.Relearning:
			return "relearning";
		default:
			throw new Error(`Unknown FSRS state ${value}`);
	}
}

function directionName(value: string): Direction {
	if (value === "forward" || value === "reverse") return value;
	throw new Error(`Unknown card direction ${value}`);
}

function rowToFsrsCard(row: ScheduleRow): FsrsCard {
	return {
		due: new Date(row.due),
		stability: row.stability,
		difficulty: row.difficulty,
		elapsed_days: row.elapsed_days,
		scheduled_days: row.scheduled_days,
		learning_steps: row.learning_steps,
		reps: row.reps,
		lapses: row.lapses,
		state: row.state as State,
		last_review: row.last_review === null ? undefined : new Date(row.last_review),
	};
}

/**
 * One SQLite library per Google user. The Worker chooses the object from the
 * authenticated Google subject; tool arguments never select a user.
 */
export class UserLibrary extends DurableObject<Env> {
	private get sql(): Sql {
		return this.ctx.storage.sql;
	}

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.blockConcurrencyWhile(async () => {
			this.initialize();
		});
	}

	private initialize(): void {
		for (const statement of SCHEMA_STATEMENTS) {
			this.sql.exec(statement);
		}

		let version = this.sql
			.exec<{ value: string }>("SELECT value FROM study_meta WHERE key = 'schema_version'")
			.toArray()[0]?.value;

		if (version) {
			if (version === SCHEMA_VERSION) return;
			if (version === "1") {
				this.setMeta("schema_version", "2");
				version = "2";
			}
			if (version === "2") {
				this.migrateStudyMediaKinds();
				this.setMeta("schema_version", SCHEMA_VERSION);
				return;
			}
			throw new Error(`Unsupported study schema version ${version}`);
		}

		const rowCount = this.sql
			.exec<{ count: number }>(
				`SELECT
					(SELECT COUNT(*) FROM study_decks) +
					(SELECT COUNT(*) FROM study_notes) +
					(SELECT COUNT(*) FROM study_cards) +
					(SELECT COUNT(*) FROM study_schedules) AS count`,
			)
			.one().count;
		if (Number(rowCount) !== 0) {
			throw new Error("Study schema contains data but has no schema version");
		}

		this.ctx.storage.transactionSync(() => {
			if (this.tableExists("notes")) {
				this.migrateLegacyLibrary();
			} else {
				this.sql.exec(
					"INSERT INTO study_decks (id, name) VALUES (?, ?)",
					DEFAULT_DECK_ID,
					"Default",
				);
				this.setMeta("pedagogy_adaptations", "[]");
			}
			this.setMeta("schema_version", SCHEMA_VERSION);
		});
	}

	private migrateStudyMediaKinds(): void {
		this.sql.exec(`CREATE TABLE study_media_v3 (
			note_id INTEGER NOT NULL REFERENCES study_notes(id) ON DELETE CASCADE,
			field TEXT NOT NULL CHECK (field IN ('front', 'back', 'extra')),
			kind TEXT NOT NULL CHECK (kind IN ('audio', 'image')),
			hash TEXT NOT NULL,
			PRIMARY KEY (note_id, field, kind)
		)`);
		this.sql.exec("INSERT INTO study_media_v3 SELECT * FROM study_media");
		this.sql.exec("DROP TABLE study_media");
		this.sql.exec("ALTER TABLE study_media_v3 RENAME TO study_media");
	}

	private tableExists(name: string): boolean {
		return Boolean(
			this.sql
				.exec<{ name: string }>(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
					name,
				)
				.toArray()[0],
		);
	}

	private migrateLegacyLibrary(): void {
		if (
			!this.tableExists("wbl_decks") ||
			!this.tableExists("wbl_fsrs") ||
			!this.tableExists("wbl_meta") ||
			!this.tableExists("cards")
		) {
			throw new Error("Legacy library is incomplete");
		}

		const decks = this.sql
			.exec<{ id: number; name: string }>("SELECT id, name FROM wbl_decks")
			.toArray();
		if (decks.length === 0) throw new Error("Legacy library has no decks");
		for (const deck of decks) {
			this.sql.exec(
				"INSERT INTO study_decks (id, name) VALUES (?, ?)",
				Number(deck.id),
				deck.name,
			);
		}

		const notes = this.sql
			.exec<{ id: number; flds: string; tags: string }>("SELECT id, flds, tags FROM notes")
			.toArray();
		for (const note of notes) {
			const fields = note.flds.split("\x1f");
			if (fields.length !== 2 && fields.length !== 3) {
				throw new Error(`Legacy note ${note.id} has ${fields.length} fields`);
			}
			this.sql.exec(
				`INSERT INTO study_notes (id, front, back, extra, tags)
				 VALUES (?, ?, ?, ?, ?)`,
				Number(note.id),
				fields[0],
				fields[1],
				fields[2] || null,
				note.tags.trim(),
			);
		}

		const cards = this.sql
			.exec<{ id: number; nid: number; did: number; ord: number }>(
				"SELECT id, nid, did, ord FROM cards",
			)
			.toArray();
		for (const card of cards) {
			if (Number(card.ord) !== 0 && Number(card.ord) !== 1) {
				throw new Error(`Legacy card ${card.id} has unsupported ord ${card.ord}`);
			}
			this.sql.exec(
				`INSERT INTO study_cards (id, note_id, deck_id, direction)
				 VALUES (?, ?, ?, ?)`,
				Number(card.id),
				Number(card.nid),
				Number(card.did),
				Number(card.ord) === 0 ? "forward" : "reverse",
			);
		}

		const schedules = this.sql.exec<ScheduleRow>("SELECT * FROM wbl_fsrs").toArray();
		for (const schedule of schedules) {
			this.sql.exec(
				`INSERT INTO study_schedules
					(card_id, due, stability, difficulty, elapsed_days, scheduled_days,
					 learning_steps, reps, lapses, state, last_review)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				Number(schedule.card_id),
				Number(schedule.due),
				Number(schedule.stability),
				Number(schedule.difficulty),
				Number(schedule.elapsed_days),
				Number(schedule.scheduled_days),
				Number(schedule.learning_steps),
				Number(schedule.reps),
				Number(schedule.lapses),
				Number(schedule.state),
				schedule.last_review === null ? null : Number(schedule.last_review),
			);
		}
		if (schedules.length !== cards.length) {
			throw new Error(
				`Legacy library has ${cards.length} cards but ${schedules.length} schedules`,
			);
		}

		const adaptations = this.sql
			.exec<{ value: string }>(
				"SELECT value FROM wbl_meta WHERE key = 'pedagogy_adaptations'",
			)
			.one().value;
		this.setMeta("pedagogy_adaptations", adaptations);

		const override = this.sql
			.exec<{ value: string }>("SELECT value FROM wbl_meta WHERE key = 'pedagogy_override'")
			.toArray()[0]?.value;
		if (override) this.setMeta("pedagogy_override", override);
	}

	private requiredMeta(key: string): string {
		return this.sql
			.exec<{ value: string }>("SELECT value FROM study_meta WHERE key = ?", key)
			.one().value;
	}

	private optionalMeta(key: string): string | null {
		const row = this.sql
			.exec<{ value: string }>("SELECT value FROM study_meta WHERE key = ?", key)
			.toArray()[0];
		return row ? row.value : null;
	}

	private setMeta(key: string, value: string): void {
		this.sql.exec(
			`INSERT INTO study_meta (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			key,
			value,
		);
	}

	private getOrCreateDeck(name: string): { id: number; name: string } {
		const existing = this.sql
			.exec<{ id: number; name: string }>(
				"SELECT id, name FROM study_decks WHERE name = ?",
				name,
			)
			.toArray()[0];
		if (existing) return { id: Number(existing.id), name: existing.name };

		const created = this.sql
			.exec<{ id: number; name: string }>(
				"INSERT INTO study_decks (name) VALUES (?) RETURNING id, name",
				name,
			)
			.one();
		return { id: Number(created.id), name: created.name };
	}

	private insertSchedule(cardId: number, due: Date): void {
		const card = createEmptyCard(due);
		this.sql.exec(
			`INSERT INTO study_schedules
				(card_id, due, stability, difficulty, elapsed_days, scheduled_days,
				 learning_steps, reps, lapses, state, last_review)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			cardId,
			card.due.getTime(),
			card.stability,
			card.difficulty,
			card.elapsed_days,
			card.scheduled_days,
			card.learning_steps,
			card.reps,
			card.lapses,
			card.state as number,
			null,
		);
	}

	private updateSchedule(cardId: number, card: FsrsCard): void {
		this.sql
			.exec<{ card_id: number }>(
			`UPDATE study_schedules SET
				due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
				scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
				state = ?, last_review = ?
			 WHERE card_id = ?
			 RETURNING card_id`,
			card.due.getTime(),
			card.stability,
			card.difficulty,
			card.elapsed_days,
			card.scheduled_days,
			card.learning_steps,
			card.reps,
			card.lapses,
			card.state as number,
			card.last_review?.getTime() ?? null,
			cardId,
			)
			.one();
	}

	private insertCard(
		noteId: number,
		deckId: number,
		direction: Direction,
		due: Date,
	): number {
		const cardId = Number(
			this.sql
				.exec<{ id: number }>(
					`INSERT INTO study_cards (note_id, deck_id, direction)
					 VALUES (?, ?, ?) RETURNING id`,
					noteId,
					deckId,
					direction,
				)
				.one().id,
		);
		this.insertSchedule(cardId, due);
		return cardId;
	}

	private createNote(input: CreateCardInput, now: Date) {
		const deck = this.getOrCreateDeck(input.deck ?? "Default");
		const extra = input.extra ?? null;
		const noteId = Number(
			this.sql
				.exec<{ id: number }>(
					`INSERT INTO study_notes (front, back, extra, tags)
					 VALUES (?, ?, ?, ?) RETURNING id`,
					input.front,
					input.back,
					extra,
					input.tags ?? "",
				)
				.one().id,
		);
		for (const media of input.media ?? []) {
			this.sql.exec(
				`INSERT INTO study_media (note_id, field, kind, hash)
				 VALUES (?, ?, ?, ?)`,
				noteId,
				media.field,
				media.kind,
				media.hash,
			);
		}

		const forwardId = this.insertCard(noteId, deck.id, "forward", now);
		const cards: {
			card_id: number;
			direction: Direction;
			front: string;
			back: string;
			due: string;
		}[] = [
			{
				card_id: forwardId,
				direction: "forward",
				front: input.front,
				back: input.back,
				due: now.toISOString(),
			},
		];

		if (input.reverse === true) {
			const reverseDue = new Date(now.getTime() + REVERSE_DELAY_MS);
			const reverseId = this.insertCard(noteId, deck.id, "reverse", reverseDue);
			cards.push({
				card_id: reverseId,
				direction: "reverse",
				front: input.back,
				back: input.front,
				due: reverseDue.toISOString(),
			});
		}

		return {
			note_id: noteId,
			deck: deck.name,
			extra,
			media: input.media ?? [],
			cards,
		};
	}

	async whoami(): Promise<{ isolated: true; cardCount: number; deckCount: number }> {
		const cardCount = this.sql
			.exec<{ count: number }>("SELECT COUNT(*) AS count FROM study_cards")
			.one().count;
		const deckCount = this.sql
			.exec<{ count: number }>("SELECT COUNT(*) AS count FROM study_decks")
			.one().count;
		return {
			isolated: true,
			cardCount: Number(cardCount),
			deckCount: Number(deckCount),
		};
	}

	async createCard(input: CreateCardInput) {
		return this.ctx.storage.transactionSync(() => this.createNote(input, new Date()));
	}

	async createCards(inputs: CreateCardInput[]) {
		return this.ctx.storage.transactionSync(() => {
			const now = new Date();
			const created = inputs.map((input) => this.createNote(input, now));
			return { created, count: created.length };
		});
	}

	async addReverse(cardIds: number[]) {
		return this.ctx.storage.transactionSync(() => {
			const now = new Date();
			const created: {
				card_id: number;
				source_card_id: number;
				note_id: number;
				direction: "reverse";
				front: string;
				back: string;
				due: string;
			}[] = [];
			const skipped: { card_id: number; reverse_card_id: number }[] = [];

			for (const cardId of cardIds) {
				const source = this.sql
					.exec<{
						id: number;
						note_id: number;
						deck_id: number;
						front: string;
						back: string;
					}>(
						`SELECT c.id, c.note_id, c.deck_id, n.front, n.back
						 FROM study_cards c
						 JOIN study_notes n ON n.id = c.note_id
						 WHERE c.id = ?`,
						cardId,
					)
					.toArray()[0];
				if (!source) throw new Error(`Unknown card_id ${cardId}`);

				const existing = this.sql
					.exec<{ id: number }>(
						`SELECT id FROM study_cards
						 WHERE note_id = ? AND direction = 'reverse'`,
						source.note_id,
					)
					.toArray()[0];
				if (existing) {
					skipped.push({
						card_id: cardId,
						reverse_card_id: Number(existing.id),
					});
					continue;
				}

				const due = new Date(now.getTime() + REVERSE_DELAY_MS);
				const reverseId = this.insertCard(
					Number(source.note_id),
					Number(source.deck_id),
					"reverse",
					due,
				);
				created.push({
					card_id: reverseId,
					source_card_id: cardId,
					note_id: Number(source.note_id),
					direction: "reverse",
					front: source.back,
					back: source.front,
					due: due.toISOString(),
				});
			}

			return {
				created,
				skipped,
				count_created: created.length,
				count_skipped: skipped.length,
			};
		});
	}

	async attachAudio(cardId: number, field: NoteField, hash: string) {
		return this.attachMedia(cardId, field, "audio", hash, false);
	}

	async attachImage(cardId: number, field: NoteField, hash: string, replace = false) {
		return this.attachMedia(cardId, field, "image", hash, replace);
	}

	private attachMedia(
		cardId: number,
		field: NoteField,
		kind: "audio" | "image",
		hash: string,
		replace: boolean,
	) {
		const card = this.sql
			.exec<{ note_id: number }>("SELECT note_id FROM study_cards WHERE id = ?", cardId)
			.toArray()[0];
		if (!card) throw new Error(`Unknown card_id ${cardId}`);

		const noteId = Number(card.note_id);
		const existing = this.sql
			.exec<{ hash: string }>(
				`SELECT hash FROM study_media
				 WHERE note_id = ? AND field = ? AND kind = ?`,
				noteId,
				field,
				kind,
			)
			.toArray()[0];
		if (existing) {
			if (existing.hash === hash) {
				return {
					attached: false,
					already_attached: true,
					replaced: false,
					note_id: noteId,
					field,
					kind,
					hash,
				};
			}
			if (!replace) {
				throw new Error(`Note ${noteId} already has ${kind} attached to ${field}`);
			}
			this.sql.exec(
				`UPDATE study_media SET hash = ?
				 WHERE note_id = ? AND field = ? AND kind = ?`,
				hash,
				noteId,
				field,
				kind,
			);
			return {
				attached: true,
				already_attached: false,
				replaced: true,
				note_id: noteId,
				field,
				kind,
				hash,
			};
		}

		this.sql.exec(
			`INSERT INTO study_media (note_id, field, kind, hash)
			 VALUES (?, ?, ?, ?)`,
			noteId,
			field,
			kind,
			hash,
		);
		return {
			attached: true,
			already_attached: false,
			replaced: false,
			note_id: noteId,
			field,
			kind,
			hash,
		};
	}

	async getNextCard(): Promise<NextCardResult> {
		const now = Date.now();
		const next = this.sql
			.exec<{ card_id: number; state: number }>(
				`SELECT s.card_id, s.state
				 FROM study_schedules s
				 JOIN study_cards c ON c.id = s.card_id
				 WHERE s.due <= ?
				 ORDER BY CASE WHEN s.state = ? THEN 1 ELSE 0 END, s.due, s.card_id
				 LIMIT 1`,
				now,
				State.New as number,
			)
			.toArray()[0];

		if (next) {
			return this.loadCardPayload(
				Number(next.card_id),
				Number(next.state) === State.New ? "new_card" : "review_due",
			);
		}

		const upcoming = this.sql
			.exec<{ due: number | null }>("SELECT MIN(due) AS due FROM study_schedules")
			.one();
		if (upcoming.due === null) {
			return {
				empty: true,
				message: "No cards yet. Call create_card or create_cards first.",
				next_due: null,
				due_in_seconds: null,
			};
		}

		const nextDue = Number(upcoming.due);
		const dueAt = new Date(nextDue).toISOString();
		const dueIn = Math.max(0, Math.ceil((nextDue - now) / 1000));
		return {
			empty: true,
			message: `Nothing is due. Next card at ${dueAt}.`,
			next_due: dueAt,
			due_in_seconds: dueIn,
			hint: `If you can schedule a one-shot message to the learner, schedule it for ${dueAt} (next_due), then call get_next_card. Do not quiz now and do not poll.`,
		};
	}

	async listDecks() {
		const now = Date.now();
		return this.sql
			.exec<{
				id: number;
				name: string;
				total: number;
				due: number;
				new_count: number;
			}>(
				`SELECT d.id, d.name,
					COUNT(c.id) AS total,
					COUNT(CASE WHEN s.due <= ? AND s.state != ? THEN 1 END) AS due,
					COUNT(CASE WHEN s.state = ? THEN 1 END) AS new_count
				 FROM study_decks d
				 LEFT JOIN study_cards c ON c.deck_id = d.id
				 LEFT JOIN study_schedules s ON s.card_id = c.id
				 GROUP BY d.id, d.name
				 ORDER BY d.name`,
				now,
				State.New as number,
				State.New as number,
			)
			.toArray()
			.map((row) => ({
				id: Number(row.id),
				name: row.name,
				total: Number(row.total),
				due: Number(row.due),
				new: Number(row.new_count),
			}));
	}

	async listDueCards(limit: number) {
		return this.sql
			.exec<{
				card_id: number;
				deck: string;
				direction: string;
				front: string;
				back: string;
				due: number;
				state: number;
			}>(
				`SELECT s.card_id, d.name AS deck, c.direction, n.front, n.back,
						s.due, s.state
				 FROM study_schedules s
				 JOIN study_cards c ON c.id = s.card_id
				 JOIN study_notes n ON n.id = c.note_id
				 JOIN study_decks d ON d.id = c.deck_id
				 WHERE s.due <= ?
				 ORDER BY CASE WHEN s.state = ? THEN 1 ELSE 0 END, s.due, s.card_id
				 LIMIT ?`,
				Date.now(),
				State.New as number,
				limit,
			)
			.toArray()
			.map((row) => {
				const direction = directionName(row.direction);
				return {
					card_id: Number(row.card_id),
					deck: row.deck,
					front: direction === "forward" ? row.front : row.back,
					direction,
					due: new Date(Number(row.due)).toISOString(),
					state: stateName(Number(row.state)),
				};
			});
	}

	async listCards(input: { limit?: number; offset?: number; deck?: string } = {}) {
		const limit = input.limit ?? 50;
		const offset = input.offset ?? 0;
		if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
			throw new Error("limit must be an integer from 1 to 200");
		}
		if (!Number.isInteger(offset) || offset < 0) {
			throw new Error("offset must be a non-negative integer");
		}
		const deck = input.deck?.trim();

		const rows = deck
			? this.sql
					.exec<{
						card_id: number;
						note_id: number;
						deck: string;
						direction: string;
						front: string;
						back: string;
						due: number;
						state: number;
					}>(
						`SELECT c.id AS card_id, c.note_id, d.name AS deck, c.direction,
								n.front, n.back, s.due, s.state
						 FROM study_cards c
						 JOIN study_notes n ON n.id = c.note_id
						 JOIN study_decks d ON d.id = c.deck_id
						 JOIN study_schedules s ON s.card_id = c.id
						 WHERE d.name = ?
						 ORDER BY d.name, c.id
						 LIMIT ? OFFSET ?`,
						deck,
						limit,
						offset,
					)
					.toArray()
			: this.sql
					.exec<{
						card_id: number;
						note_id: number;
						deck: string;
						direction: string;
						front: string;
						back: string;
						due: number;
						state: number;
					}>(
						`SELECT c.id AS card_id, c.note_id, d.name AS deck, c.direction,
								n.front, n.back, s.due, s.state
						 FROM study_cards c
						 JOIN study_notes n ON n.id = c.note_id
						 JOIN study_decks d ON d.id = c.deck_id
						 JOIN study_schedules s ON s.card_id = c.id
						 ORDER BY d.name, c.id
						 LIMIT ? OFFSET ?`,
						limit,
						offset,
					)
					.toArray();

		const noteIds = [...new Set(rows.map((row) => Number(row.note_id)))];
		const mediaByNote = new Map<
			number,
			Array<{ field: string; kind: string; hash: string }>
		>();
		if (noteIds.length) {
			const placeholders = noteIds.map(() => "?").join(", ");
			const mediaRows = this.sql
				.exec<{ note_id: number; field: string; kind: string; hash: string }>(
					`SELECT note_id, field, kind, hash FROM study_media
					 WHERE note_id IN (${placeholders})
					 ORDER BY note_id, field, kind`,
					...noteIds,
				)
				.toArray();
			for (const item of mediaRows) {
				const noteId = Number(item.note_id);
				const list = mediaByNote.get(noteId) ?? [];
				list.push({ field: item.field, kind: item.kind, hash: item.hash });
				mediaByNote.set(noteId, list);
			}
		}

		const cards = rows.map((row) => {
			const direction = directionName(row.direction);
			const noteId = Number(row.note_id);
			return {
				card_id: Number(row.card_id),
				note_id: noteId,
				deck: row.deck,
				front: direction === "forward" ? row.front : row.back,
				direction,
				due: new Date(Number(row.due)).toISOString(),
				state: stateName(Number(row.state)),
				media: mediaByNote.get(noteId) ?? [],
			};
		});

		return {
			count: cards.length,
			offset,
			limit,
			...(deck ? { deck } : {}),
			cards,
		};
	}

	async updateSequence(input: UpdateSequenceInput) {
		const beforeRow = this.sql
			.exec<ScheduleRow>(
				`SELECT s.*
				 FROM study_schedules s
				 JOIN study_cards c ON c.id = s.card_id
				 WHERE s.card_id = ?`,
				input.cardId,
			)
			.toArray()[0];
		if (!beforeRow) throw new Error(`Unknown card_id ${input.cardId}`);

		const now = new Date();
		if (Number(beforeRow.due) > now.getTime()) {
			throw new Error(`card_id ${input.cardId} is not due`);
		}
		const before = rowToFsrsCard(beforeRow);
		const scheduling = scheduler.next(before, now, RATING_TO_ENUM[input.rating]);

		this.ctx.storage.transactionSync(() => {
			this.updateSchedule(input.cardId, scheduling.card);
		});

		return {
			card_id: input.cardId,
			rating: input.rating,
			previous_due: new Date(beforeRow.due).toISOString(),
			next_due: scheduling.card.due.toISOString(),
			interval_days: scheduling.card.scheduled_days,
			stability: scheduling.card.stability,
			difficulty: scheduling.card.difficulty,
			state: stateName(scheduling.card.state as number),
			reps: scheduling.card.reps,
			lapses: scheduling.card.lapses,
			fsrs_log: {
				rating: scheduling.log.rating,
				elapsed_days: scheduling.log.elapsed_days,
				scheduled_days: scheduling.log.scheduled_days,
			},
		};
	}

	async getLearningStylePrompt(includeFullPrompt = true) {
		const override = this.optionalMeta("pedagogy_override");
		const adaptations = JSON.parse(
			this.requiredMeta("pedagogy_adaptations"),
		) as PedagogyAdaptation[];
		const summary = {
			using_override: Boolean(override),
			adaptations,
			adaptation_count: adaptations.length,
		};
		if (!includeFullPrompt) return summary;
		return { prompt: renderPedagogyPrompt(adaptations, override), ...summary };
	}

	async updateLearningStylePrompt(input: {
		instruction?: string;
		full_prompt?: string;
		reset?: boolean;
		include_full_prompt?: boolean;
	}) {
		const instruction = input.instruction?.trim();
		const fullPrompt = input.full_prompt?.trim();
		const actionCount =
			Number(input.reset === true) + Number(Boolean(instruction)) + Number(Boolean(fullPrompt));
		if (actionCount !== 1) {
			throw new Error("Provide exactly one of instruction, full_prompt, or reset=true");
		}

		const includeFull = input.include_full_prompt === true;
		if (input.reset === true) {
			this.sql.exec("DELETE FROM study_meta WHERE key = 'pedagogy_override'");
			this.setMeta("pedagogy_adaptations", "[]");
			return {
				ok: true,
				action: "reset",
				...(await this.getLearningStylePrompt(includeFull)),
			};
		}

		if (fullPrompt) {
			this.setMeta("pedagogy_override", fullPrompt);
			return {
				ok: true,
				action: "replaced",
				...(await this.getLearningStylePrompt(includeFull)),
			};
		}

		const adaptations = JSON.parse(
			this.requiredMeta("pedagogy_adaptations"),
		) as PedagogyAdaptation[];
		const added = {
			at: new Date().toISOString(),
			instruction: instruction as string,
		};
		adaptations.push(added);
		this.setMeta("pedagogy_adaptations", JSON.stringify(adaptations));
		return {
			ok: true,
			action: "adaptation_added",
			added,
			adaptation_count: adaptations.length,
			using_override: Boolean(this.optionalMeta("pedagogy_override")),
			...(includeFull ? await this.getLearningStylePrompt(true) : {}),
		};
	}

	private loadCardPayload(
		cardId: number,
		queueReason: "review_due" | "new_card",
	): ServedCard {
		const row = this.sql
			.exec<CardPayloadRow>(
				`SELECT s.*, c.note_id, c.direction, d.name AS deck,
						n.front, n.back, n.extra, n.tags
				 FROM study_schedules s
				 JOIN study_cards c ON c.id = s.card_id
				 JOIN study_notes n ON n.id = c.note_id
				 JOIN study_decks d ON d.id = c.deck_id
				 WHERE s.card_id = ?`,
				cardId,
			)
			.one();
		const direction = directionName(row.direction);
		const media = this.sql
			.exec<MediaAttachment>(
				`SELECT field, kind, hash FROM study_media
				 WHERE note_id = ? ORDER BY field, kind`,
				row.note_id,
			)
			.toArray();
		const frontField = direction === "forward" ? "front" : "back";
		const backField = direction === "forward" ? "back" : "front";

		return {
			empty: false,
			card_id: Number(row.card_id),
			note_id: Number(row.note_id),
			deck: row.deck,
			direction,
			front: direction === "forward" ? row.front : row.back,
			due: new Date(Number(row.due)).toISOString(),
			state: stateName(Number(row.state)),
			reps: Number(row.reps),
			lapses: Number(row.lapses),
			queue_reason: queueReason,
			tags: row.tags,
			front_media: media.filter((item) => item.field === frontField),
			answer_for_teacher: {
				back: direction === "forward" ? row.back : row.front,
				extra: row.extra,
				media: media.filter((item) => item.field === backField || item.field === "extra"),
				note: "Private. Never put this answer in the learner-facing prompt.",
			},
		};
	}
}
