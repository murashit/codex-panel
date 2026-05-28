import { AppServerClient, type AppServerClientHandlers } from "./client";
import type { InitializeResponse } from "../generated/app-server/InitializeResponse";
import type { RequestId } from "../generated/app-server/RequestId";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { JsonValue } from "../generated/app-server/serde_json/JsonValue";
import type { Model } from "../generated/app-server/v2/Model";
import type { ModelListResponse } from "../generated/app-server/v2/ModelListResponse";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { ThreadStartResponse } from "../generated/app-server/v2/ThreadStartResponse";
import type { Turn } from "../generated/app-server/v2/Turn";
import type { TurnStartResponse } from "../generated/app-server/v2/TurnStartResponse";
import { namingPrompt, titleFromNamingTurn, type ThreadNamingContext } from "../domain/threads/naming";
import { runtimeOverride, validatedRuntimeOverride } from "../runtime/model";

const NAMING_SERVICE_NAME = "codex-panel-naming";
const NAMING_TIMEOUT_MS = 60_000;
const MAX_TITLE_CHARS = 40;

const TITLE_OUTPUT_SCHEMA: JsonValue = {
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

export interface ThreadNamingClient {
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

export type ThreadNamingClientFactory = (codexPath: string, cwd: string, handlers: AppServerClientHandlers) => ThreadNamingClient;

type ThreadNamingRunLifecycleState =
  | { kind: "starting" }
  | { kind: "thread-started"; threadId: string }
  | { kind: "turn-started"; threadId: string; turnId: string }
  | { kind: "completed" };

export async function generateThreadTitleWithCodex(
  codexPath: string,
  cwd: string,
  context: ThreadNamingContext,
  runtimeSettings: ThreadNamingRuntimeSettings,
  clientFactory: ThreadNamingClientFactory = (codexPath, cwd, handlers) => new AppServerClient(codexPath, cwd, handlers),
): Promise<string | null> {
  let lifecycle: ThreadNamingRunLifecycleState = { kind: "starting" };
  let timeout: number | undefined;
  let rejectCompletedTurn: ((error: Error) => void) | null = null;
  let handleNamingNotification: (notification: ServerNotification) => void = () => undefined;
  const completedItems: ThreadItem[] = [];

  const completedTurn = new Promise<Turn>((resolve, reject) => {
    rejectCompletedTurn = reject;
    timeout = window.setTimeout(() => {
      if (lifecycle.kind === "completed") return;
      lifecycle = { kind: "completed" };
      reject(new Error("Timed out while generating a Codex thread title."));
    }, NAMING_TIMEOUT_MS);

    const resolveIfNamingTurn = (notification: ServerNotification): void => {
      if (lifecycle.kind === "completed") return;
      if (notification.method === "item/completed") {
        if (!notificationMatchesThreadNamingTurn(lifecycle, notification.params.threadId, notification.params.turnId)) return;
        completedItems.push(notification.params.item);
        return;
      }
      if (notification.method === "turn/completed") {
        if (!notificationMatchesThreadNamingTurn(lifecycle, notification.params.threadId, notification.params.turn.id)) return;
        lifecycle = { kind: "completed" };
        resolve(turnWithCollectedItems(notification.params.turn, completedItems));
      }
    };

    handleNamingNotification = resolveIfNamingTurn;
  });

  let client!: ThreadNamingClient;
  client = clientFactory(codexPath, cwd, {
    onNotification: (notification) => {
      handleNamingNotification(notification);
    },
    onServerRequest: (request) => {
      client.rejectServerRequest(request.id, -32601, "Thread title generation does not handle server requests.");
    },
    onLog: () => undefined,
    onExit: () => {
      if (lifecycle.kind === "completed") return;
      lifecycle = { kind: "completed" };
      rejectCompletedTurn?.(new Error("Codex title generation app-server exited."));
    },
  });

  try {
    await client.connect();
    const runtime = await namingRuntimeForClient(client, runtimeSettings);
    const threadResponse = await client.startEphemeralThread(cwd, NAMING_SERVICE_NAME, TITLE_DEVELOPER_INSTRUCTIONS);
    lifecycle = { kind: "thread-started", threadId: threadResponse.thread.id };
    const turnResponse = await client.startStructuredTurn(
      threadResponse.thread.id,
      cwd,
      namingPrompt(context),
      TITLE_OUTPUT_SCHEMA,
      runtime.model,
      runtime.effort,
    );
    lifecycle = acknowledgeThreadNamingTurn(lifecycle, threadResponse.thread.id, turnResponse.turn.id);
    const turn = turnResponse.turn.status === "completed" ? turnWithCollectedItems(turnResponse.turn, completedItems) : await completedTurn;
    return titleFromNamingTurn(turn);
  } finally {
    lifecycle = { kind: "completed" };
    if (timeout !== undefined) window.clearTimeout(timeout);
    client.disconnect();
  }
}

export interface NamingRuntime {
  model?: string;
  effort?: ReasoningEffort;
}

export function namingRuntime(settings: ThreadNamingRuntimeSettings): NamingRuntime {
  return runtimeOverride({ model: settings.threadNamingModel, effort: settings.threadNamingEffort });
}

export function validatedNamingRuntime(settings: ThreadNamingRuntimeSettings, models: Model[]): NamingRuntime {
  return validatedRuntimeOverride({ model: settings.threadNamingModel, effort: settings.threadNamingEffort }, models);
}

function turnWithCollectedItems(turn: Turn, items: ThreadItem[]): Turn {
  if (turn.items.length > 0 || items.length === 0) return turn;
  return { ...turn, items: [...items], itemsView: "full" };
}

function notificationMatchesThreadNamingTurn(lifecycle: ThreadNamingRunLifecycleState, threadId: string, turnId: string): boolean {
  if (lifecycle.kind === "thread-started") return lifecycle.threadId === threadId;
  if (lifecycle.kind === "turn-started") return lifecycle.threadId === threadId && lifecycle.turnId === turnId;
  return false;
}

function acknowledgeThreadNamingTurn(
  lifecycle: ThreadNamingRunLifecycleState,
  threadId: string,
  turnId: string,
): ThreadNamingRunLifecycleState {
  return lifecycle.kind === "completed" ? lifecycle : { kind: "turn-started", threadId, turnId };
}

async function namingRuntimeForClient(client: ThreadNamingClient, settings: ThreadNamingRuntimeSettings): Promise<NamingRuntime> {
  const runtime = namingRuntime(settings);
  if (!runtime.model || !runtime.effort) return runtime;
  try {
    const response = await client.listModels(false);
    return validatedNamingRuntime(settings, response.data);
  } catch {
    return runtime;
  }
}
