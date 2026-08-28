import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp";
import { z } from "zod";
import { GoogleHandler } from "./google-handler";
import { UserLibrary, type UpdateSequenceInput } from "./user-library";
import { jsonToolResult, type Props } from "./utils";

const cardInput = {
	front: z.string().trim().min(1).describe("Cue the learner will see at recall time"),
	back: z.string().trim().min(1).describe("Answer they must produce"),
	deck: z.string().trim().min(1).optional().describe("Deck name. Defaults to Default"),
	tags: z.string().trim().optional().describe("Space-separated tags"),
	extra: z
		.string()
		.trim()
		.min(1)
		.optional()
		.describe("Mnemonic or example; never part of either recall cue"),
	reverse: z
		.boolean()
		.optional()
		.describe("Also create the reverse direction with its own FSRS schedule"),
};

function requireProps(): Props {
	const props = getMcpAuthContext()?.props;
	if (
		!props ||
		typeof props.googleId !== "string" ||
		typeof props.name !== "string" ||
		typeof props.email !== "string"
	) {
		throw new Error("Missing authenticated Google identity");
	}
	return {
		googleId: props.googleId,
		name: props.name,
		email: props.email,
	};
}

function libraryFor(env: Env): DurableObjectStub<UserLibrary> {
	return env.USER_LIBRARY.getByName(`user:${requireProps().googleId}`);
}

async function observed<T>(tool: string, action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		console.error({
			event: "mcp_tool_error",
			tool,
			error:
				error instanceof Error
					? { name: error.name, message: error.message, stack: error.stack }
					: String(error),
		});
		throw error;
	}
}

function createServer(env: Env): McpServer {
	const server = new McpServer({
		name: "what-beats-learning",
		version: "0.4.0",
	});

	server.tool(
		"whoami",
		"Return the signed-in Google account and counts from this user's isolated library.",
		{},
		() =>
			observed("whoami", async () => {
				const props = requireProps();
				return jsonToolResult({
					name: props.name,
					email: props.email,
					google_id: props.googleId,
					library: await libraryFor(env).whoami(),
				});
			}),
	);

	server.tool(
		"create_card",
		"Create one atomic cue→answer note. Pass reverse: true only when both retrieval directions matter; the reverse is delayed and scheduled independently.",
		cardInput,
		(input) =>
			observed("create_card", async () =>
				jsonToolResult(await libraryFor(env).createCard(input)),
			),
	);

	server.tool(
		"create_cards",
		"Atomically create up to 50 notes. Same fields as create_card, including reverse per note.",
		{
			cards: z.array(z.object(cardInput)).min(1).max(50),
		},
		({ cards }) =>
			observed("create_cards", async () =>
				jsonToolResult(await libraryFor(env).createCards(cards)),
			),
	);

	server.tool(
		"add_reverse",
		"Add a delayed reverse direction to existing cards. Already-reversed notes are skipped idempotently; an unknown card_id fails the whole call.",
		{
			card_ids: z.array(z.number().int().positive()).min(1).max(50),
		},
		({ card_ids }) =>
			observed("add_reverse", async () =>
				jsonToolResult(await libraryFor(env).addReverse(card_ids)),
			),
	);

	server.tool(
		"get_next_card",
		"Return the next due FSRS card. If empty is true, do not quiz. front is the learner cue; answer_for_teacher is private.",
		{},
		() =>
			observed("get_next_card", async () =>
				jsonToolResult(await libraryFor(env).getNextCard()),
			),
	);

	server.tool(
		"update_sequence",
		"Grade the specified card and reschedule it with FSRS. Both card_id and the LLM-chosen rating are required.",
		{
			card_id: z.number().int().positive(),
			rating: z
				.enum(["again", "hard", "good", "easy"])
				.describe(
					"again = no recall; hard = struggled or hinted; good = solid; easy = instant",
				),
		},
		({ card_id, rating }) =>
			observed("update_sequence", async () =>
				jsonToolResult(
					await libraryFor(env).updateSequence({
						cardId: card_id,
						rating,
					} satisfies UpdateSequenceInput),
				),
			),
	);

	server.tool(
		"get_learning_style_prompt",
		"Fetch and follow this user's teaching prompt at session start and after pedagogy changes.",
		{},
		() =>
			observed("get_learning_style_prompt", async () =>
				jsonToolResult(await libraryFor(env).getLearningStylePrompt(true)),
			),
	);

	server.tool(
		"update_learning_style_prompt",
		"Adjust teaching style. Provide exactly one action: instruction, full_prompt, or reset=true. The response is short unless include_full_prompt is true.",
		{
			instruction: z.string().trim().min(1).optional(),
			full_prompt: z.string().trim().min(1).optional(),
			reset: z.boolean().optional(),
			include_full_prompt: z.boolean().optional(),
		},
		(input) =>
			observed("update_learning_style_prompt", async () =>
				jsonToolResult(await libraryFor(env).updateLearningStylePrompt(input)),
			),
	);

	server.tool(
		"list_decks",
		"List this user's decks with total, due-review, and new-card counts.",
		{},
		() =>
			observed("list_decks", async () =>
				jsonToolResult(await libraryFor(env).listDecks()),
			),
	);

	server.tool(
		"list_due_cards",
		"Peek at cards currently eligible to be served. Future reviews and delayed reverse cards are excluded.",
		{
			limit: z.number().int().min(1).max(100).default(20),
		},
		({ limit }) =>
			observed("list_due_cards", async () =>
				jsonToolResult(await libraryFor(env).listDueCards(limit)),
			),
	);

	return server;
}

const mcpHandler = {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return createMcpHandler(createServer(env), { route: "/mcp" })(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;

const authHandler = {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
		return GoogleHandler.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;

export { UserLibrary };

export default new OAuthProvider({
	apiRoute: "/mcp",
	apiHandler: mcpHandler,
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: authHandler,
	tokenEndpoint: "/token",
	onError(error) {
		console.error({ event: "oauth_provider_error", ...error });
	},
});
