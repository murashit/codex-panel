import { AppServerClient } from "../../app-server/client";
import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { JsonValue } from "../../generated/app-server/serde_json/JsonValue";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { Model } from "../../generated/app-server/v2/Model";
import type { ThreadItem } from "../../generated/app-server/v2/ThreadItem";
import type { Turn } from "../../generated/app-server/v2/Turn";
import { runtimeOverride, validatedRuntimeOverride } from "../../runtime/model";
import type { SelectionRewriteRuntimeSettings } from "./model";
import { SELECTION_REWRITE_DEVELOPER_INSTRUCTIONS, SELECTION_REWRITE_SERVICE_NAME } from "./prompt";
import { SelectionRewriteOutputError, selectionRewriteOutputParseResultFromTurn, type SelectionRewriteOutput } from "./output";

const SELECTION_REWRITE_TIMEOUT_MS = 120_000;

const SELECTION_REWRITE_OUTPUT_SCHEMA: JsonValue = {
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
}

export type SelectionRewriteActivity = "reasoning" | "writing";

export async function runSelectionRewrite(options: RunSelectionRewriteOptions): Promise<SelectionRewriteOutput> {
  throwIfAborted(options.signal);
  let threadId: string | null = null;
  let expectedTurnId: string | null = null;
  let preview = "";
  let completed = false;
  let timeout: number | undefined;
  let rejectCompletedTurn: ((error: Error) => void) | null = null;
  let handleNotification: (notification: ServerNotification) => void = () => undefined;
  const completedItems: ThreadItem[] = [];

  const completedTurn = new Promise<Turn>((resolve, reject) => {
    rejectCompletedTurn = reject;
    timeout = window.setTimeout(() => {
      if (completed) return;
      completed = true;
      reject(new Error("Timed out while rewriting the selection."));
    }, SELECTION_REWRITE_TIMEOUT_MS);

    handleNotification = (notification): void => {
      if (completed) return;
      if (notification.method === "item/agentMessage/delta") {
        if (!threadId || notification.params.threadId !== threadId) return;
        if (expectedTurnId && notification.params.turnId !== expectedTurnId) return;
        options.onActivity?.("writing");
        preview += notification.params.delta;
        options.onPreview?.(preview);
        return;
      }
      if (
        notification.method === "item/reasoning/summaryTextDelta" ||
        notification.method === "item/reasoning/textDelta" ||
        notification.method === "item/reasoning/summaryPartAdded"
      ) {
        if (!threadId || notification.params.threadId !== threadId) return;
        if (expectedTurnId && notification.params.turnId !== expectedTurnId) return;
        options.onActivity?.("reasoning");
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
    onNotification: (notification) => {
      handleNotification(notification);
    },
    onServerRequest: (request) => {
      client.rejectServerRequest(request.id, -32601, "Selection rewrite does not handle server requests.");
    },
    onLog: () => undefined,
    onExit: () => {
      if (completed) return;
      completed = true;
      rejectCompletedTurn?.(new Error("Selection rewrite app-server exited."));
    },
  });

  try {
    await abortable(client.connect(), options.signal);
    const runtime = options.runtimeSettings
      ? await abortable(selectionRewriteRuntimeForClient(client, options.runtimeSettings), options.signal)
      : {};
    const threadResponse = await abortable(
      client.startEphemeralThread(options.cwd, SELECTION_REWRITE_SERVICE_NAME, SELECTION_REWRITE_DEVELOPER_INSTRUCTIONS),
      options.signal,
    );
    threadId = threadResponse.thread.id;
    const turnResponse = await abortable(
      client.startStructuredTurn(threadId, options.cwd, options.prompt, SELECTION_REWRITE_OUTPUT_SCHEMA, runtime.model, runtime.effort),
      options.signal,
    );
    expectedTurnId = turnResponse.turn.id;
    const turn =
      turnResponse.turn.status === "completed"
        ? turnWithCollectedItems(turnResponse.turn, completedItems)
        : await abortable(completedTurn, options.signal);
    const { output, rawText } = selectionRewriteOutputParseResultFromTurn(turn);
    if (!output) throw new SelectionRewriteOutputError("Codex did not return a valid selection rewrite response.", rawText);
    return output;
  } finally {
    completed = true;
    if (timeout !== undefined) window.clearTimeout(timeout);
    client.disconnect();
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw selectionRewriteAbortError();
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(selectionRewriteAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function selectionRewriteAbortError(): Error {
  return new Error("Selection rewrite cancelled.");
}

function turnWithCollectedItems(turn: Turn, completedItems: ThreadItem[]): Turn {
  if (turn.items.length > 0 || completedItems.length === 0) return turn;
  return { ...turn, items: completedItems };
}

export interface SelectionRewriteRuntime {
  model?: string;
  effort?: ReasoningEffort;
}

export function selectionRewriteRuntime(settings: SelectionRewriteRuntimeSettings): SelectionRewriteRuntime {
  return runtimeOverride({ model: settings.rewriteSelectionModel, effort: settings.rewriteSelectionEffort });
}

export function validatedSelectionRewriteRuntime(settings: SelectionRewriteRuntimeSettings, models: Model[]): SelectionRewriteRuntime {
  return validatedRuntimeOverride({ model: settings.rewriteSelectionModel, effort: settings.rewriteSelectionEffort }, models);
}

async function selectionRewriteRuntimeForClient(
  client: AppServerClient,
  settings: SelectionRewriteRuntimeSettings,
): Promise<SelectionRewriteRuntime> {
  const runtime = selectionRewriteRuntime(settings);
  if (!runtime.model || !runtime.effort) return runtime;
  try {
    const response = await client.listModels(false);
    return validatedSelectionRewriteRuntime(settings, response.data);
  } catch {
    return runtime;
  }
}
