import { AppServerClient, type AppServerClientHandlers } from "../../app-server/client";
import {
  createStructuredTurnRunLifecycle,
  structuredTurnRunMatches,
  transitionStructuredTurnRunLifecycle,
} from "../../app-server/structured-turn-run-lifecycle";
import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { RequestId } from "../../generated/app-server/RequestId";
import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { JsonValue } from "../../generated/app-server/serde_json/JsonValue";
import type { ReasoningEffort } from "../../domain/catalog/metadata";
import type { ThreadItem } from "../../generated/app-server/v2/ThreadItem";
import type { ThreadStartResponse } from "../../generated/app-server/v2/ThreadStartResponse";
import type { Turn } from "../../generated/app-server/v2/Turn";
import type { TurnStartResponse } from "../../generated/app-server/v2/TurnStartResponse";
import { panelModelOptionsFromAppServerModels } from "../../app-server/catalog-model";
import type { PanelModelOption } from "../../domain/catalog/metadata";
import { runtimeOverride, validatedRuntimeOverrideForModelOptions } from "../../domain/catalog/runtime-overrides";
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
  listPanelModelOptions(): Promise<PanelModelOption[]>;
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

interface SelectionRewriteRunState {
  lifecycle: ReturnType<typeof createStructuredTurnRunLifecycle>;
  preview: string;
  completedItems: readonly ThreadItem[];
}

interface SelectionRewriteNotificationResult {
  state: SelectionRewriteRunState;
  activity?: SelectionRewriteActivity;
  preview?: string;
  completedTurn?: Turn;
}

export async function runSelectionRewrite(options: RunSelectionRewriteOptions): Promise<SelectionRewriteOutput> {
  throwIfAborted(options.signal);
  let runState: SelectionRewriteRunState = {
    lifecycle: createStructuredTurnRunLifecycle(),
    preview: "",
    completedItems: [],
  };
  let timeout: number | undefined;
  let rejectCompletedTurn: ((error: Error) => void) | null = null;
  let handleNotification: (notification: ServerNotification) => void = () => undefined;

  const completedTurn = new Promise<Turn>((resolve, reject) => {
    rejectCompletedTurn = reject;
    timeout = window.setTimeout(() => {
      if (runState.lifecycle.kind === "completed") return;
      runState = completeSelectionRewriteRunState(runState);
      reject(new Error("Timed out while rewriting the selection."));
    }, SELECTION_REWRITE_TIMEOUT_MS);

    handleNotification = (notification): void => {
      const result = transitionSelectionRewriteRunNotification(runState, notification);
      runState = result.state;
      if (result.activity) options.onActivity?.(result.activity);
      if (result.preview !== undefined) options.onPreview?.(result.preview);
      if (result.completedTurn) resolve(result.completedTurn);
    };
  });

  let client!: SelectionRewriteClient;
  const clientFactory =
    options.clientFactory ??
    ((codexPath, cwd, handlers) => selectionRewriteClientFromAppServerClient(new AppServerClient(codexPath, cwd, handlers)));
  client = clientFactory(options.codexPath, options.cwd, {
    onNotification: (notification) => {
      handleNotification(notification);
    },
    onServerRequest: (request) => {
      client.rejectServerRequest(request.id, -32601, "Selection rewrite does not handle server requests.");
    },
    onLog: () => undefined,
    onExit: () => {
      if (runState.lifecycle.kind === "completed") return;
      runState = completeSelectionRewriteRunState(runState);
      rejectCompletedTurn?.(new Error("Selection rewrite app-server exited."));
    },
  });

  try {
    await abortable(client.connect(), options.signal);
    const runtime = options.runtimeSettings
      ? await abortable(selectionRewriteRuntimeOverrideForClient(client, options.runtimeSettings), options.signal)
      : {};
    const threadResponse = await abortable(
      client.startEphemeralThread(options.cwd, SELECTION_REWRITE_SERVICE_NAME, SELECTION_REWRITE_DEVELOPER_INSTRUCTIONS),
      options.signal,
    );
    runState = {
      ...runState,
      lifecycle: transitionStructuredTurnRunLifecycle(runState.lifecycle, { type: "thread-started", threadId: threadResponse.thread.id }),
    };
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
    runState = {
      ...runState,
      lifecycle: transitionStructuredTurnRunLifecycle(runState.lifecycle, {
        type: "turn-started",
        threadId: threadResponse.thread.id,
        turnId: turnResponse.turn.id,
      }),
    };
    const turn =
      turnResponse.turn.status === "completed"
        ? turnWithCollectedItems(turnResponse.turn, runState.completedItems)
        : await abortable(completedTurn, options.signal);
    const { output, rawText } = selectionRewriteOutputParseResultFromTurn(turn);
    if (!output) throw new SelectionRewriteOutputError("Codex did not return a valid selection rewrite response.", rawText);
    return output;
  } finally {
    runState = completeSelectionRewriteRunState(runState);
    if (timeout !== undefined) window.clearTimeout(timeout);
    client.disconnect();
  }
}

function transitionSelectionRewriteRunNotification(
  state: SelectionRewriteRunState,
  notification: ServerNotification,
): SelectionRewriteNotificationResult {
  if (state.lifecycle.kind === "completed") return { state };
  if (notification.method === "item/agentMessage/delta") {
    if (!structuredTurnRunMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return { state };
    const preview = `${state.preview}${notification.params.delta}`;
    return { state: { ...state, preview }, activity: "writing", preview };
  }
  if (
    notification.method === "item/reasoning/summaryTextDelta" ||
    notification.method === "item/reasoning/textDelta" ||
    notification.method === "item/reasoning/summaryPartAdded"
  ) {
    if (!structuredTurnRunMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return { state };
    return { state, activity: "reasoning" };
  }
  if (notification.method === "item/completed") {
    if (!structuredTurnRunMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return { state };
    return { state: { ...state, completedItems: [...state.completedItems, notification.params.item] } };
  }
  if (notification.method === "turn/completed") {
    if (!structuredTurnRunMatches(state.lifecycle, notification.params.threadId, notification.params.turn.id)) return { state };
    const nextState = completeSelectionRewriteRunState(state);
    return {
      state: nextState,
      completedTurn: turnWithCollectedItems(notification.params.turn, state.completedItems),
    };
  }
  return { state };
}

function completeSelectionRewriteRunState(state: SelectionRewriteRunState): SelectionRewriteRunState {
  return {
    ...state,
    lifecycle: transitionStructuredTurnRunLifecycle(state.lifecycle, { type: "completed" }),
  };
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

function turnWithCollectedItems(turn: Turn, completedItems: readonly ThreadItem[]): Turn {
  if (turn.items.length > 0 || completedItems.length === 0) return turn;
  return { ...turn, items: [...completedItems] };
}

export interface SelectionRewriteRuntimeOverride {
  model?: string;
  effort?: ReasoningEffort;
}

export function selectionRewriteRuntimeOverride(settings: SelectionRewriteRuntimeSettings): SelectionRewriteRuntimeOverride {
  return runtimeOverride({ model: settings.rewriteSelectionModel, effort: settings.rewriteSelectionEffort });
}

export function validatedSelectionRewriteRuntimeOverride(
  settings: SelectionRewriteRuntimeSettings,
  models: readonly PanelModelOption[],
): SelectionRewriteRuntimeOverride {
  return validatedRuntimeOverrideForModelOptions(
    { model: settings.rewriteSelectionModel, effort: settings.rewriteSelectionEffort },
    models,
  );
}

async function selectionRewriteRuntimeOverrideForClient(
  client: SelectionRewriteClient,
  settings: SelectionRewriteRuntimeSettings,
): Promise<SelectionRewriteRuntimeOverride> {
  const runtime = selectionRewriteRuntimeOverride(settings);
  if (!runtime.model || !runtime.effort) return runtime;
  try {
    return validatedSelectionRewriteRuntimeOverride(settings, await client.listPanelModelOptions());
  } catch {
    return runtime;
  }
}

function selectionRewriteClientFromAppServerClient(client: AppServerClient): SelectionRewriteClient {
  return {
    connect: () => client.connect(),
    disconnect: () => {
      client.disconnect();
    },
    listPanelModelOptions: async () => panelModelOptionsFromAppServerModels((await client.listModels(false)).data),
    rejectServerRequest: (requestId, code, message) => {
      client.rejectServerRequest(requestId, code, message);
    },
    startEphemeralThread: (cwd, serviceName, developerInstructions) => client.startEphemeralThread(cwd, serviceName, developerInstructions),
    startStructuredTurn: (threadId, cwd, text, outputSchema, model, effort) =>
      client.startStructuredTurn(threadId, cwd, text, outputSchema, model, effort),
  };
}
