import type { AppServerClientHandlers } from "../../app-server/connection/client";
import type { ModelMetadataClient } from "../../app-server/services/catalog";
import {
  type EphemeralStructuredTurnClient,
  runEphemeralStructuredTurnForLastAgentText,
  type StructuredTurnOutputSchema,
} from "../../app-server/services/ephemeral-structured-turn";
import { resolvedRuntimeOverrideForClient } from "../../app-server/services/runtime-overrides";
import { SelectionRewriteOutputError, selectionRewriteOutputParseResultFromText } from "./output";
import { SELECTION_REWRITE_DEVELOPER_INSTRUCTIONS, SELECTION_REWRITE_SERVICE_NAME } from "./prompt";
import type { SelectionRewriteTransport, SelectionRewriteTransportRequest } from "./transport";

const SELECTION_REWRITE_TIMEOUT_MS = 120_000;

const SELECTION_REWRITE_OUTPUT_SCHEMA: StructuredTurnOutputSchema = {
  type: "object",
  properties: { replacementText: { type: "string" } },
  required: ["replacementText"],
  additionalProperties: false,
};

type SelectionRewriteClient = EphemeralStructuredTurnClient & ModelMetadataClient;
type SelectionRewriteClientFactory = (codexPath: string, cwd: string, handlers: AppServerClientHandlers) => SelectionRewriteClient;

export interface AppServerSelectionRewriteTransportOptions {
  codexPath(): string;
  cwd: string;
  clientFactory?: SelectionRewriteClientFactory;
}

export function createAppServerSelectionRewriteTransport(options: AppServerSelectionRewriteTransportOptions): SelectionRewriteTransport {
  return {
    generate: (request) => runAppServerSelectionRewrite(options, request),
  };
}

async function runAppServerSelectionRewrite(options: AppServerSelectionRewriteTransportOptions, request: SelectionRewriteTransportRequest) {
  let preview = "";
  const lastAgentText = await runEphemeralStructuredTurnForLastAgentText({
    codexPath: options.codexPath(),
    cwd: options.cwd,
    serviceName: SELECTION_REWRITE_SERVICE_NAME,
    developerInstructions: SELECTION_REWRITE_DEVELOPER_INSTRUCTIONS,
    prompt: request.prompt,
    outputSchema: SELECTION_REWRITE_OUTPUT_SCHEMA,
    timeoutMs: SELECTION_REWRITE_TIMEOUT_MS,
    serverRequests: { kind: "reject", message: "Selection rewrite does not handle server requests." },
    exitedMessage: "Selection rewrite app-server exited.",
    timedOutMessage: "Timed out while rewriting the selection.",
    abortMessage: "Selection rewrite cancelled.",
    signal: request.signal,
    resolveRuntime: (client) =>
      resolvedRuntimeOverrideForClient(client, {
        model: request.runtimeSettings.rewriteSelectionModel,
        effort: request.runtimeSettings.rewriteSelectionEffort,
      }),
    clientFactory: options.clientFactory,
    onProgress: (event) => {
      if (event.type === "reasoning-activity") {
        request.onActivity("reasoning");
        return;
      }
      preview = `${preview}${event.delta}`;
      request.onActivity("writing");
      request.onPreview(preview);
    },
  });
  const { output, rawText } = selectionRewriteOutputParseResultFromText(lastAgentText);
  if (!output) throw new SelectionRewriteOutputError("Codex did not return a valid selection rewrite response.", rawText);
  return output;
}
