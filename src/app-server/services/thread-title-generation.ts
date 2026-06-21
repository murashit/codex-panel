import {
  runEphemeralStructuredTurn,
  type EphemeralStructuredTurnClientFactory,
  type StructuredTurnOutputSchema,
} from "./ephemeral-structured-turn";
import type { ModelMetadataClient } from "../catalog";
import { resolvedRuntimeOverrideForClient } from "./runtime-overrides";
import { conversationAssistantTextFromTurnRecord, type TurnRecord } from "../protocol/turn";
import type { ReasoningEffort } from "../../domain/catalog/metadata";
import {
  THREAD_TITLE_MAX_CHARS,
  threadTitleFromGeneratedText,
  threadTitlePrompt,
  type ThreadTitleContext,
} from "../../domain/threads/title-generation-model";

const THREAD_TITLE_SERVICE_NAME = "codex-panel-naming";
const THREAD_TITLE_TIMEOUT_MS = 60_000;

const TITLE_OUTPUT_SCHEMA: StructuredTurnOutputSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      minLength: 1,
      maxLength: THREAD_TITLE_MAX_CHARS,
    },
  },
  required: ["title"],
  additionalProperties: false,
};

const TITLE_DEVELOPER_INSTRUCTIONS = [
  "You generate short titles for Codex thread history.",
  "Infer the main language of the user's initial request and write the title in that language.",
  "Return only a JSON object matching the requested schema.",
  "Do not include Markdown, quotes around the whole response, explanations, or alternatives.",
].join("\n");

export interface ThreadTitleRuntimeSettings {
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
}

export async function generateThreadTitleWithCodex(
  codexPath: string,
  cwd: string,
  context: ThreadTitleContext,
  runtimeSettings: ThreadTitleRuntimeSettings,
  clientFactory?: EphemeralStructuredTurnClientFactory,
): Promise<string | null> {
  const turn = await runEphemeralStructuredTurn({
    codexPath,
    cwd,
    serviceName: THREAD_TITLE_SERVICE_NAME,
    developerInstructions: TITLE_DEVELOPER_INSTRUCTIONS,
    prompt: threadTitlePrompt(context),
    outputSchema: TITLE_OUTPUT_SCHEMA,
    timeoutMs: THREAD_TITLE_TIMEOUT_MS,
    unhandledServerRequestMessage: "Thread title generation does not handle server requests.",
    exitedMessage: "Codex title generation app-server exited.",
    timedOutMessage: "Timed out while generating a Codex thread title.",
    resolveRuntime: (client) => threadTitleRuntimeOverrideForClient(client, runtimeSettings),
    clientFactory,
  });
  return threadTitleFromGenerationTurn(turn);
}

function threadTitleFromGenerationTurn(turn: TurnRecord): string | null {
  const response = conversationAssistantTextFromTurnRecord(turn);
  return response ? threadTitleFromGeneratedText(response) : null;
}

async function threadTitleRuntimeOverrideForClient(client: ModelMetadataClient, settings: ThreadTitleRuntimeSettings) {
  return resolvedRuntimeOverrideForClient(client, { model: settings.threadNamingModel, effort: settings.threadNamingEffort });
}
