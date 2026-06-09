import { AppServerClient, type AppServerClientHandlers } from "../app-server/client";
import { panelModelOptionsFromAppServerModels } from "../app-server/catalog-model";
import {
  createStructuredTurnRunLifecycle,
  structuredTurnRunMatches,
  transitionStructuredTurnRunLifecycle,
} from "../app-server/structured-turn-run-lifecycle";
import type { PanelModelOption, ReasoningEffort } from "../domain/catalog/metadata";
import { runtimeOverride, validatedRuntimeOverrideForModelOptions } from "../domain/catalog/runtime-overrides";
import { namingPrompt, titleFromNamingTurn, type ThreadNamingContext } from "../domain/threads/naming";
import type { InitializeResponse } from "../generated/app-server/InitializeResponse";
import type { RequestId } from "../generated/app-server/RequestId";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { JsonValue } from "../generated/app-server/serde_json/JsonValue";
import type { ModelListResponse } from "../generated/app-server/v2/ModelListResponse";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { ThreadStartResponse } from "../generated/app-server/v2/ThreadStartResponse";
import type { Turn } from "../generated/app-server/v2/Turn";
import type { TurnStartResponse } from "../generated/app-server/v2/TurnStartResponse";

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

export async function generateThreadTitleWithCodex(
  codexPath: string,
  cwd: string,
  context: ThreadNamingContext,
  runtimeSettings: ThreadNamingRuntimeSettings,
  clientFactory: ThreadNamingClientFactory = (codexPath, cwd, handlers) => new AppServerClient(codexPath, cwd, handlers),
): Promise<string | null> {
  let lifecycle = createStructuredTurnRunLifecycle();
  let timeout: number | undefined;
  let rejectCompletedTurn: ((error: Error) => void) | null = null;
  let handleNamingNotification: (notification: ServerNotification) => void = () => undefined;
  const completedItems: ThreadItem[] = [];

  const completedTurn = new Promise<Turn>((resolve, reject) => {
    rejectCompletedTurn = reject;
    timeout = window.setTimeout(() => {
      if (lifecycle.kind === "completed") return;
      lifecycle = transitionStructuredTurnRunLifecycle(lifecycle, { type: "completed" });
      reject(new Error("Timed out while generating a Codex thread title."));
    }, NAMING_TIMEOUT_MS);

    handleNamingNotification = (notification: ServerNotification): void => {
      if (lifecycle.kind === "completed") return;
      if (notification.method === "item/completed") {
        if (!structuredTurnRunMatches(lifecycle, notification.params.threadId, notification.params.turnId)) return;
        completedItems.push(notification.params.item);
        return;
      }
      if (notification.method === "turn/completed") {
        if (!structuredTurnRunMatches(lifecycle, notification.params.threadId, notification.params.turn.id)) return;
        lifecycle = transitionStructuredTurnRunLifecycle(lifecycle, { type: "completed" });
        resolve(turnWithCollectedItems(notification.params.turn, completedItems));
      }
    };
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
      lifecycle = transitionStructuredTurnRunLifecycle(lifecycle, { type: "completed" });
      rejectCompletedTurn?.(new Error("Codex title generation app-server exited."));
    },
  });

  try {
    await client.connect();
    const runtime = await threadNamingRuntimeOverrideForClient(client, runtimeSettings);
    const threadResponse = await client.startEphemeralThread(cwd, NAMING_SERVICE_NAME, TITLE_DEVELOPER_INSTRUCTIONS);
    lifecycle = transitionStructuredTurnRunLifecycle(lifecycle, { type: "thread-started", threadId: threadResponse.thread.id });
    const turnResponse = await client.startStructuredTurn(
      threadResponse.thread.id,
      cwd,
      namingPrompt(context),
      TITLE_OUTPUT_SCHEMA,
      runtime.model,
      runtime.effort,
    );
    lifecycle = transitionStructuredTurnRunLifecycle(lifecycle, {
      type: "turn-started",
      threadId: threadResponse.thread.id,
      turnId: turnResponse.turn.id,
    });
    const turn = turnResponse.turn.status === "completed" ? turnWithCollectedItems(turnResponse.turn, completedItems) : await completedTurn;
    return titleFromNamingTurn(turn);
  } finally {
    lifecycle = transitionStructuredTurnRunLifecycle(lifecycle, { type: "completed" });
    if (timeout !== undefined) window.clearTimeout(timeout);
    client.disconnect();
  }
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

function turnWithCollectedItems(turn: Turn, items: ThreadItem[]): Turn {
  if (turn.items.length > 0 || items.length === 0) return turn;
  return { ...turn, items: [...items], itemsView: "full" };
}

async function threadNamingRuntimeOverrideForClient(
  client: ThreadNamingClient,
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
