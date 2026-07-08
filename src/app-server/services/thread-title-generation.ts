import type { ReasoningEffort } from "../../domain/catalog/metadata";
import {
  THREAD_TITLE_MAX_CHARS,
  type ThreadTitleContext,
  threadTitleFromGeneratedText,
  threadTitlePrompt,
} from "../../domain/threads/title-generation-model";
import { turnTranscriptAssistantTextFromTurnRecord } from "../protocol/turn";
import {
  type EphemeralStructuredTurnClientFactory,
  runEphemeralStructuredTurn,
  type StructuredTurnOutputSchema,
} from "./ephemeral-structured-turn";
import { resolvedRuntimeOverrideForClient } from "./runtime-overrides";

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
    serverRequests: { kind: "reject", message: "Thread title generation does not handle server requests." },
    exitedMessage: "Codex title generation app-server exited.",
    timedOutMessage: "Timed out while generating a Codex thread title.",
    resolveRuntime: (client) =>
      resolvedRuntimeOverrideForClient(client, { model: runtimeSettings.threadNamingModel, effort: runtimeSettings.threadNamingEffort }),
    clientFactory,
  });
  const response = turnTranscriptAssistantTextFromTurnRecord(turn);
  return response ? threadTitleFromGeneratedText(response) : null;
}
