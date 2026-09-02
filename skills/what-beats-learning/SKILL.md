---
name: what-beats-learning
description: Teach and review spaced-repetition flashcards (FSRS) through the What Beats Learning MCP. Use when the user wants to study, review, quiz, add flashcards, or do spaced repetition.
---

# What Beats Learning

Call the live MCP tools. Never invent cards, due times, ratings, or hashes — use tool schemas and responses.

## Card

A **note** is one cue→answer. A **card** is one retrieval direction with its own FSRS schedule:

`card_id`, `front`, `back`, optional `extra`, `deck`, optional `tags`, `reverse`, `media[]`, `schedule`

`reverse: true` creates a delayed opposite-direction card. The library is the signed-in Google account; tools never select another user.

## Session

1. Call `whoami`. If the library is empty, onboard: ask what to learn, then `create_card` / `create_cards` for a handful of atomic notes. Do not quiz.
2. Call `get_learning_style_prompt` and follow it.
3. If cards exist, teach from `get_next_card`. Show only `front` as the learner cue. `answer_for_teacher` is private — do not present it as the cue.
4. If `empty` is true, stop quizzing. If `next_due` is set, say when the next card is due. Do not invent a quiz.
5. After the learner answers, grade that `card_id` with `update_sequence` and `again` | `hard` | `good` | `easy` (`again` = no recall; `hard` = struggled or hinted; `good` = solid; `easy` = instant).

## Other tools

`add_reverse`, `list_decks`, `list_due_cards`, `list_cards`, `update_learning_style_prompt`, `generate_audio`, `generate_image`, `import_image`, `attach_audio`, `attach_image` — use when the MCP exposes them.
