import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("UserLibrary happy path", () => {
	it("creates, reverses, serves, grades, and empties the due queue", async () => {
		const library = env.USER_LIBRARY.getByName(`test:${crypto.randomUUID()}`);
		const biologyAudio = "a".repeat(64);
		const geographyAudio = "b".repeat(64);
		const batch = await library.createCards([
			{
				front: "What is photosynthesis?",
				back: "The process plants use to turn light energy into chemical energy.",
				deck: "Biology",
				reverse: true,
				media: [{ field: "back", kind: "audio", hash: biologyAudio }],
			},
			{
				front: "What is the capital of France?",
				back: "Paris",
				deck: "Geography",
			},
		]);

		expect(batch.count).toBe(2);
		expect(batch.created[0].cards).toHaveLength(2);
		expect((await library.whoami()).cardCount).toBe(3);

		const geographyCardId = batch.created[1].cards[0].card_id;
		const added = await library.addReverse([geographyCardId]);
		expect(added.count_created).toBe(1);
		expect((await library.addReverse([geographyCardId])).count_skipped).toBe(1);
		expect(
			await library.attachAudio(geographyCardId, "front", geographyAudio),
		).toMatchObject({ attached: true, note_id: batch.created[1].note_id });
		expect(
			await library.attachAudio(geographyCardId, "front", geographyAudio),
		).toMatchObject({ attached: false, already_attached: true });

		const first = await library.getNextCard();
		expect(first.empty).toBe(false);
		if (first.empty) throw new Error("Expected the first due card");
		expect(first.direction).toBe("forward");
		expect(first.front_media).toEqual([]);
		expect(first.answer_for_teacher.media).toEqual([
			{ field: "back", kind: "audio", hash: biologyAudio },
		]);
		await library.updateSequence({ cardId: first.card_id, rating: "good" });

		const second = await library.getNextCard();
		expect(second.empty).toBe(false);
		if (second.empty) throw new Error("Expected the second due card");
		expect(second.direction).toBe("forward");
		expect(second.front_media).toEqual([
			{ field: "front", kind: "audio", hash: geographyAudio },
		]);
		await library.updateSequence({ cardId: second.card_id, rating: "good" });

		const empty = await library.getNextCard();
		expect(empty.empty).toBe(true);
		if (!empty.empty) throw new Error("Expected an empty due queue");
		if (empty.next_due === null) throw new Error("Expected a future due date");
		expect(new Date(empty.next_due).getTime()).toBeGreaterThan(Date.now());
		expect(empty.hint).toContain(empty.next_due);
	});
});
