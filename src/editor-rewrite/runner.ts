import { AppServerClient } from "../app-server/client";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { JsonValue } from "../generated/app-server/serde_json/JsonValue";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { Model } from "../generated/app-server/v2/Model";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { Turn } from "../generated/app-server/v2/Turn";
import { runtimeOverride, validatedRuntimeOverride } from "../runtime/model";
import type { RewriteRuntimeSettings } from "./model";
import { REWRITE_DEVELOPER_INSTRUCTIONS, REWRITE_SERVICE_NAME } from "./prompt";
import { RewriteOutputError, rewriteOutputParseResultFromTurn, type RewriteOutput } from "./output";

const REWRITE_TIMEOUT_MS = 120_000;

const REWRITE_OUTPUT_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    replacementText: {
      type: "string",
    },
  },
  required: ["replacementText"],
  additionalProperties: false,
};

export interface RunRewriteSelectionOptions {
  codexPath: string;
  cwd: string;
  prompt: string;
  runtimeSettings?: RewriteRuntimeSettings;
  onPreview?: (text: string) => void;
}

export async function runRewriteSelection(options: RunRewriteSelectionOptions): Promise<RewriteOutput> {
  let threadId: string | null = null;
  let expectedTurnId: string | null = null;
  let preview = "";
  let completed = false;
  let timeout: ReturnType<Window["setTimeout"]> | null = null;
  let rejectCompletedTurn: ((error: Error) => void) | null = null;
  let handleNotification: (notification: ServerNotification) => void = () => undefined;
  const completedItems: ThreadItem[] = [];

  const completedTurn = new Promise<Turn>((resolve, reject) => {
    rejectCompletedTurn = reject;
    timeout = window.setTimeout(() => {
      if (completed) return;
      completed = true;
      reject(new Error("Timed out while rewriting the selection."));
    }, REWRITE_TIMEOUT_MS);

    handleNotification = (notification): void => {
      if (completed) return;
      if (notification.method === "item/agentMessage/delta") {
        if (!threadId || notification.params.threadId !== threadId) return;
        if (expectedTurnId && notification.params.turnId !== expectedTurnId) return;
        preview += notification.params.delta;
        options.onPreview?.(preview);
        return;
      }
      if (notification.method === "item/completed") {
        if (!threadId || notification.params.threadId !== threadId) return;
        if (expectedTurnId && notification.params.turnId !== expectedTurnId) return;
        completedItems.push(notification.params.item);
        return;
      }
      if (notification.method === "turn/completed") {
        if (!threadId || notification.params.threadId !== threadId) return;
        if (expectedTurnId && notification.params.turn.id !== expectedTurnId) return;
        completed = true;
        resolve(turnWithCollectedItems(notification.params.turn, completedItems));
      }
    };
  });

  let client!: AppServerClient;
  client = new AppServerClient(options.codexPath, options.cwd, {
    onNotification: (notification) => handleNotification(notification),
    onServerRequest: (request) => client.rejectServerRequest(request.id, -32601, "Selection rewrite does not handle server requests."),
    onLog: () => undefined,
    onExit: () => {
      if (completed) return;
      completed = true;
      rejectCompletedTurn?.(new Error("Codex rewrite app-server exited."));
    },
  });

  try {
    await client.connect();
    const runtime = options.runtimeSettings ? await rewriteRuntimeForClient(client, options.runtimeSettings) : {};
    const threadResponse = await client.startEphemeralThread(options.cwd, REWRITE_SERVICE_NAME, REWRITE_DEVELOPER_INSTRUCTIONS);
    threadId = threadResponse.thread.id;
    const turnResponse = await client.startStructuredTurn(
      threadId,
      options.cwd,
      options.prompt,
      REWRITE_OUTPUT_SCHEMA,
      runtime.model,
      runtime.effort,
    );
    expectedTurnId = turnResponse.turn.id;
    const turn = turnResponse.turn.status === "completed" ? turnWithCollectedItems(turnResponse.turn, completedItems) : await completedTurn;
    const { output, rawText } = rewriteOutputParseResultFromTurn(turn);
    if (!output) throw new RewriteOutputError("Codex did not return a valid rewrite patch.", rawText);
    return output;
  } finally {
    completed = true;
    if (timeout) window.clearTimeout(timeout);
    client.disconnect();
  }
}

function turnWithCollectedItems(turn: Turn, completedItems: ThreadItem[]): Turn {
  if (turn.items.length > 0 || completedItems.length === 0) return turn;
  return { ...turn, items: completedItems };
}

export interface RewriteRuntime {
  model?: string;
  effort?: ReasoningEffort;
}

export function rewriteRuntime(settings: RewriteRuntimeSettings): RewriteRuntime {
  return runtimeOverride({ model: settings.rewriteSelectionModel, effort: settings.rewriteSelectionEffort });
}

export function validatedRewriteRuntime(settings: RewriteRuntimeSettings, models: Model[]): RewriteRuntime {
  return validatedRuntimeOverride({ model: settings.rewriteSelectionModel, effort: settings.rewriteSelectionEffort }, models);
}

async function rewriteRuntimeForClient(client: AppServerClient, settings: RewriteRuntimeSettings): Promise<RewriteRuntime> {
  const runtime = rewriteRuntime(settings);
  if (!runtime.model || !runtime.effort) return runtime;
  try {
    const response = await client.listModels(false);
    return validatedRewriteRuntime(settings, response.data);
  } catch {
    return runtime;
  }
}
