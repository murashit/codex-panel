import { AppServerClient, type AppServerClientHandlers } from "../../app-server/client";
import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { RequestId } from "../../generated/app-server/RequestId";
import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { JsonValue } from "../../generated/app-server/serde_json/JsonValue";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { ModelListResponse } from "../../generated/app-server/v2/ModelListResponse";
import type { Model } from "../../generated/app-server/v2/Model";
import type { ThreadItem } from "../../generated/app-server/v2/ThreadItem";
import type { ThreadStartResponse } from "../../generated/app-server/v2/ThreadStartResponse";
import type { Turn } from "../../generated/app-server/v2/Turn";
import type { TurnStartResponse } from "../../generated/app-server/v2/TurnStartResponse";
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
  clientFactory?: SelectionRewriteClientFactory;
}

export type SelectionRewriteActivity = "reasoning" | "writing";

export interface SelectionRewriteClient {
  connect(): Promise<InitializeResponse>;
  disconnect(): void;
  listModels(includeHidden?: boolean): Promise<ModelListResponse>;
  rejectServerRequest(requestId: RequestId, code: number, message: string): void;
  startEphemeralThread(cwd: string, serviceName: string, developerInstructions: string): Promise<ThreadStartResponse>;
  startStructuredTurn(
    threadId: string,
    cwd: string,
    text: string,
    outputSchema: JsonValue,
    model?: string,
    effort?: ReasoningEffort,
  ): Promise<TurnStartResponse>;
}

export type SelectionRewriteClientFactory = (codexPath: string, cwd: string, handlers: AppServerClientHandlers) => SelectionRewriteClient;

type SelectionRewriteRunLifecycleState =
  | { kind: "starting" }
  | { kind: "thread-started"; threadId: string }
  | { kind: "turn-started"; threadId: string; turnId: string }
  | { kind: "completed" };

export async function runSelectionRewrite(options: RunSelectionRewriteOptions): Promise<SelectionRewriteOutput> {
  throwIfAborted(options.signal);
  let lifecycle: SelectionRewriteRunLifecycleState = { kind: "starting" };
  let preview = "";
  let timeout: number | undefined;
  let rejectCompletedTurn: ((error: Error) => void) | null = null;
  let handleNotification: (notification: ServerNotification) => void = () => undefined;
  const completedItems: ThreadItem[] = [];

  const completedTurn = new Promise<Turn>((resolve, reject) => {
    rejectCompletedTurn = reject;
    timeout = window.setTimeout(() => {
      if (lifecycle.kind === "completed") return;
      lifecycle = { kind: "completed" };
      reject(new Error("Timed out while rewriting the selection."));
    }, SELECTION_REWRITE_TIMEOUT_MS);

    handleNotification = (notification): void => {
      if (lifecycle.kind === "completed") return;
      if (notification.method === "item/agentMessage/delta") {
        if (!notificationMatchesSelectionRewriteTurn(lifecycle, notification.params.threadId, notification.params.turnId)) return;
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
        if (!notificationMatchesSelectionRewriteTurn(lifecycle, notification.params.threadId, notification.params.turnId)) return;
        options.onActivity?.("reasoning");
        return;
      }
      if (notification.method === "item/completed") {
        if (!notificationMatchesSelectionRewriteTurn(lifecycle, notification.params.threadId, notification.params.turnId)) return;
        completedItems.push(notification.params.item);
        return;
      }
      if (notification.method === "turn/completed") {
        if (!notificationMatchesSelectionRewriteTurn(lifecycle, notification.params.threadId, notification.params.turn.id)) return;
        lifecycle = { kind: "completed" };
        resolve(turnWithCollectedItems(notification.params.turn, completedItems));
      }
    };
  });

  let client!: SelectionRewriteClient;
  const clientFactory = options.clientFactory ?? ((codexPath, cwd, handlers) => new AppServerClient(codexPath, cwd, handlers));
  client = clientFactory(options.codexPath, options.cwd, {
    onNotification: (notification) => {
      handleNotification(notification);
    },
    onServerRequest: (request) => {
      client.rejectServerRequest(request.id, -32601, "Selection rewrite does not handle server requests.");
    },
    onLog: () => undefined,
    onExit: () => {
      if (lifecycle.kind === "completed") return;
      lifecycle = { kind: "completed" };
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
    lifecycle = { kind: "thread-started", threadId: threadResponse.thread.id };
    const turnResponse = await abortable(
      client.startStructuredTurn(
        threadResponse.thread.id,
        options.cwd,
        options.prompt,
        SELECTION_REWRITE_OUTPUT_SCHEMA,
        runtime.model,
        runtime.effort,
      ),
      options.signal,
    );
    lifecycle = acknowledgeSelectionRewriteTurn(lifecycle, threadResponse.thread.id, turnResponse.turn.id);
    const turn =
      turnResponse.turn.status === "completed"
        ? turnWithCollectedItems(turnResponse.turn, completedItems)
        : await abortable(completedTurn, options.signal);
    const { output, rawText } = selectionRewriteOutputParseResultFromTurn(turn);
    if (!output) throw new SelectionRewriteOutputError("Codex did not return a valid selection rewrite response.", rawText);
    return output;
  } finally {
    lifecycle = { kind: "completed" };
    if (timeout !== undefined) window.clearTimeout(timeout);
    client.disconnect();
  }
}

function notificationMatchesSelectionRewriteTurn(lifecycle: SelectionRewriteRunLifecycleState, threadId: string, turnId: string): boolean {
  if (lifecycle.kind === "thread-started") return lifecycle.threadId === threadId;
  if (lifecycle.kind === "turn-started") return lifecycle.threadId === threadId && lifecycle.turnId === turnId;
  return false;
}

function acknowledgeSelectionRewriteTurn(
  lifecycle: SelectionRewriteRunLifecycleState,
  threadId: string,
  turnId: string,
): SelectionRewriteRunLifecycleState {
  return lifecycle.kind === "completed" ? lifecycle : { kind: "turn-started", threadId, turnId };
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

export function validatedSelectionRewriteRuntime(
  settings: SelectionRewriteRuntimeSettings,
  models: readonly Model[],
): SelectionRewriteRuntime {
  return validatedRuntimeOverride({ model: settings.rewriteSelectionModel, effort: settings.rewriteSelectionEffort }, models);
}

async function selectionRewriteRuntimeForClient(
  client: SelectionRewriteClient,
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
