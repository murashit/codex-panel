import {
  runEphemeralStructuredTurn,
  type EphemeralStructuredTurnClient,
  type EphemeralStructuredTurnClientFactory,
  type EphemeralStructuredTurnRuntimeClient,
  type StructuredTurnOutputSchema,
} from "./ephemeral-structured-turn";
import { modelMetadataFromAppServerModels } from "./catalog-model";
import type { Turn } from "../generated/app-server/v2/Turn";
import type { ModelMetadata, ReasoningEffort } from "../domain/catalog/metadata";
import { runtimeOverride, validatedRuntimeOverrideForModelMetadata } from "../domain/catalog/runtime-overrides";
import { namingPrompt, titleFromGeneratedText, type ThreadNamingContext } from "../domain/threads/naming";
import { turnConversationSummary } from "../domain/threads/transcript";

const NAMING_SERVICE_NAME = "codex-panel-naming";
const NAMING_TIMEOUT_MS = 60_000;
const MAX_TITLE_CHARS = 40;

const TITLE_OUTPUT_SCHEMA: StructuredTurnOutputSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      minLength: 1,
      maxLength: MAX_TITLE_CHARS,
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

export interface ThreadNamingRuntimeSettings {
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
}

export type ThreadNamingClient = EphemeralStructuredTurnClient;
export type ThreadNamingClientFactory = EphemeralStructuredTurnClientFactory;

export async function generateThreadTitleWithCodex(
  codexPath: string,
  cwd: string,
  context: ThreadNamingContext,
  runtimeSettings: ThreadNamingRuntimeSettings,
  clientFactory?: ThreadNamingClientFactory,
): Promise<string | null> {
  const turn = await runEphemeralStructuredTurn({
    codexPath,
    cwd,
    serviceName: NAMING_SERVICE_NAME,
    developerInstructions: TITLE_DEVELOPER_INSTRUCTIONS,
    prompt: namingPrompt(context),
    outputSchema: TITLE_OUTPUT_SCHEMA,
    timeoutMs: NAMING_TIMEOUT_MS,
    unhandledServerRequestMessage: "Thread title generation does not handle server requests.",
    exitedMessage: "Codex title generation app-server exited.",
    timedOutMessage: "Timed out while generating a Codex thread title.",
    resolveRuntime: (client) => threadNamingRuntimeOverrideForClient(client, runtimeSettings),
    clientFactory,
  });
  return titleFromNamingTurn(turn);
}

export interface ThreadNamingRuntimeOverride {
  model?: string;
  effort?: ReasoningEffort;
}

export function titleFromNamingTurn(turn: Turn): string | null {
  const response = turnConversationSummary(turn).assistantText;
  return response ? titleFromGeneratedText(response) : null;
}

export function threadNamingRuntimeOverride(settings: ThreadNamingRuntimeSettings): ThreadNamingRuntimeOverride {
  return runtimeOverride({ model: settings.threadNamingModel, effort: settings.threadNamingEffort });
}

export function validatedThreadNamingRuntimeOverride(
  settings: ThreadNamingRuntimeSettings,
  models: readonly ModelMetadata[],
): ThreadNamingRuntimeOverride {
  return validatedRuntimeOverrideForModelMetadata({ model: settings.threadNamingModel, effort: settings.threadNamingEffort }, models);
}

async function threadNamingRuntimeOverrideForClient(
  client: EphemeralStructuredTurnRuntimeClient,
  settings: ThreadNamingRuntimeSettings,
): Promise<ThreadNamingRuntimeOverride> {
  const runtime = threadNamingRuntimeOverride(settings);
  if (!runtime.model || !runtime.effort) return runtime;
  try {
    const response = await client.listModels(false);
    return validatedThreadNamingRuntimeOverride(settings, modelMetadataFromAppServerModels(response.data));
  } catch {
    return runtime;
  }
}
