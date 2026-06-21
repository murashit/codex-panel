import {
  type EphemeralStructuredTurnClient,
  runEphemeralStructuredTurnForLastAgentText,
  type StructuredTurnOutputSchema,
} from "../../app-server/services/ephemeral-structured-turn";
import type { ModelMetadataClient } from "../../app-server/catalog";
import type { AppServerClientHandlers } from "../../app-server/connection/client";
import { resolvedRuntimeOverrideForClient } from "../../app-server/services/runtime-overrides";
import type { SelectionRewriteRuntimeSettings } from "./model";
import { SELECTION_REWRITE_DEVELOPER_INSTRUCTIONS, SELECTION_REWRITE_SERVICE_NAME } from "./prompt";
import { SelectionRewriteOutputError, selectionRewriteOutputParseResultFromText, type SelectionRewriteOutput } from "./output";

const SELECTION_REWRITE_TIMEOUT_MS = 120_000;

const SELECTION_REWRITE_OUTPUT_SCHEMA: StructuredTurnOutputSchema = {
  type: "object",
  properties: {
    replacementText: {
      type: "string",
    },
  },
  required: ["replacementText"],
  additionalProperties: false,
};

export interface RunSelectionRewriteOptions {
  codexPath: string;
  cwd: string;
  prompt: string;
  runtimeSettings?: SelectionRewriteRuntimeSettings;
  onActivity?: (activity: SelectionRewriteActivity) => void;
  onPreview?: (text: string) => void;
  signal?: AbortSignal;
  clientFactory?: SelectionRewriteClientFactory;
}

export type SelectionRewriteActivity = "reasoning" | "writing";

type SelectionRewriteClient = EphemeralStructuredTurnClient & ModelMetadataClient;
type SelectionRewriteClientFactory = (codexPath: string, cwd: string, handlers: AppServerClientHandlers) => SelectionRewriteClient;

export async function runSelectionRewrite(options: RunSelectionRewriteOptions): Promise<SelectionRewriteOutput> {
  let preview = "";
  const runtimeSettings = options.runtimeSettings;
  const lastAgentText = await runEphemeralStructuredTurnForLastAgentText({
    codexPath: options.codexPath,
    cwd: options.cwd,
    serviceName: SELECTION_REWRITE_SERVICE_NAME,
    developerInstructions: SELECTION_REWRITE_DEVELOPER_INSTRUCTIONS,
    prompt: options.prompt,
    outputSchema: SELECTION_REWRITE_OUTPUT_SCHEMA,
    timeoutMs: SELECTION_REWRITE_TIMEOUT_MS,
    serverRequests: { kind: "reject", message: "Selection rewrite does not handle server requests." },
    exitedMessage: "Selection rewrite app-server exited.",
    timedOutMessage: "Timed out while rewriting the selection.",
    abortMessage: "Selection rewrite cancelled.",
    signal: options.signal,
    resolveRuntime: runtimeSettings ? (client) => selectionRewriteRuntimeOverrideForClient(client, runtimeSettings) : undefined,
    clientFactory: options.clientFactory,
    onProgress: (event) => {
      if (event.type === "reasoning-activity") {
        options.onActivity?.("reasoning");
        return;
      }
      preview = `${preview}${event.delta}`;
      options.onActivity?.("writing");
      options.onPreview?.(preview);
    },
  });
  const { output, rawText } = selectionRewriteOutputParseResultFromText(lastAgentText);
  if (!output) throw new SelectionRewriteOutputError("Codex did not return a valid selection rewrite response.", rawText);
  return output;
}

async function selectionRewriteRuntimeOverrideForClient(client: ModelMetadataClient, settings: SelectionRewriteRuntimeSettings) {
  return resolvedRuntimeOverrideForClient(client, { model: settings.rewriteSelectionModel, effort: settings.rewriteSelectionEffort });
}
