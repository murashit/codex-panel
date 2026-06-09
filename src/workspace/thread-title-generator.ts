import {
  runStructuredEphemeralTurn,
  type StructuredEphemeralTurnClient,
  type StructuredEphemeralTurnClientFactory,
  type StructuredEphemeralTurnRuntimeClient,
  type StructuredTurnOutputSchema,
} from "../app-server/structured-ephemeral-turn";
import { panelModelOptionsFromAppServerModels } from "../app-server/catalog-model";
import type { PanelModelOption, ReasoningEffort } from "../domain/catalog/metadata";
import { runtimeOverride, validatedRuntimeOverrideForModelOptions } from "../domain/catalog/runtime-overrides";
import { namingPrompt, titleFromNamingTurn, type ThreadNamingContext } from "../domain/threads/naming";

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

export type ThreadNamingClient = StructuredEphemeralTurnClient;
export type ThreadNamingClientFactory = StructuredEphemeralTurnClientFactory;

export async function generateThreadTitleWithCodex(
  codexPath: string,
  cwd: string,
  context: ThreadNamingContext,
  runtimeSettings: ThreadNamingRuntimeSettings,
  clientFactory?: ThreadNamingClientFactory,
): Promise<string | null> {
  const turn = await runStructuredEphemeralTurn({
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

export function threadNamingRuntimeOverride(settings: ThreadNamingRuntimeSettings): ThreadNamingRuntimeOverride {
  return runtimeOverride({ model: settings.threadNamingModel, effort: settings.threadNamingEffort });
}

export function validatedThreadNamingRuntimeOverride(
  settings: ThreadNamingRuntimeSettings,
  models: readonly PanelModelOption[],
): ThreadNamingRuntimeOverride {
  return validatedRuntimeOverrideForModelOptions({ model: settings.threadNamingModel, effort: settings.threadNamingEffort }, models);
}

async function threadNamingRuntimeOverrideForClient(
  client: StructuredEphemeralTurnRuntimeClient,
  settings: ThreadNamingRuntimeSettings,
): Promise<ThreadNamingRuntimeOverride> {
  const runtime = threadNamingRuntimeOverride(settings);
  if (!runtime.model || !runtime.effort) return runtime;
  try {
    const response = await client.listModels(false);
    return validatedThreadNamingRuntimeOverride(settings, panelModelOptionsFromAppServerModels(response.data));
  } catch {
    return runtime;
  }
}
