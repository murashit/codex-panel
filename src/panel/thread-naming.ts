import { AppServerClient } from "../app-server/client";
import type { DisplayItem } from "../display/types";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { JsonValue } from "../generated/app-server/serde_json/JsonValue";
import type { Model } from "../generated/app-server/v2/Model";
import type { SortDirection } from "../generated/app-server/v2/SortDirection";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { Turn } from "../generated/app-server/v2/Turn";
import { inputToText, truncate } from "../utils";
import { findModelByIdOrName, supportedEffortsForModel } from "./model-runtime";

const NAMING_SERVICE_NAME = "codex-panel-naming";
const NAMING_TIMEOUT_MS = 60_000;
const MAX_CONTEXT_CHARS = 4_000;
const MAX_TITLE_CHARS = 40;
const DEFAULT_CONTEXT_PAGE_LIMIT = 20;
const DEFAULT_CONTEXT_MAX_PAGES = 5;

export const THREAD_NAMING_CONTEXT_UNAVAILABLE_MESSAGE =
  "Auto-name needs completed history or visible resumed history with both user and assistant text.";

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
  "You generate short titles for Codex chat history.",
  "Infer the main language of the user's initial request and write the title in that language.",
  "Return only a JSON object matching the requested schema.",
  "Do not include Markdown, quotes around the whole response, explanations, or alternatives.",
].join("\n");

export interface ThreadNamingContext {
  userRequest: string;
  assistantResponse: string;
}

export interface ThreadNamingRuntimeSettings {
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
}

export interface ThreadNamingContextPage {
  data: Turn[];
  nextCursor: string | null;
}

export type ThreadNamingContextPageReader = (
  threadId: string,
  cursor: string | null,
  limit: number,
  sortDirection: SortDirection,
) => Promise<ThreadNamingContextPage>;

export async function generateThreadTitleWithCodex(
  codexPath: string,
  cwd: string,
  context: ThreadNamingContext,
  runtimeSettings: ThreadNamingRuntimeSettings,
): Promise<string | null> {
  let namingThreadId: string | null = null;
  let expectedTurnId: string | null = null;
  let completed = false;
  let timeout: ReturnType<Window["setTimeout"]> | null = null;
  let rejectCompletedTurn: ((error: Error) => void) | null = null;
  let handleNamingNotification: (notification: ServerNotification) => void = () => undefined;
  const completedItems: ThreadItem[] = [];

  const completedTurn = new Promise<Turn>((resolve, reject) => {
    rejectCompletedTurn = reject;
    timeout = window.setTimeout(() => {
      if (completed) return;
      completed = true;
      reject(new Error("Timed out while generating a Codex thread title."));
    }, NAMING_TIMEOUT_MS);

    const resolveIfNamingTurn = (notification: ServerNotification): void => {
      if (completed) return;
      if (notification.method === "item/completed") {
        if (!namingThreadId || notification.params.threadId !== namingThreadId) return;
        if (expectedTurnId && notification.params.turnId !== expectedTurnId) return;
        completedItems.push(notification.params.item);
        return;
      }
      if (notification.method === "turn/completed") {
        if (!namingThreadId || notification.params.threadId !== namingThreadId) return;
        if (expectedTurnId && notification.params.turn.id !== expectedTurnId) return;
        completed = true;
        resolve(turnWithCollectedItems(notification.params.turn, completedItems));
      }
    };

    handleNamingNotification = resolveIfNamingTurn;
  });

  let client!: AppServerClient;
  client = new AppServerClient(codexPath, cwd, {
    onNotification: (notification) => handleNamingNotification(notification),
    onServerRequest: (request) =>
      client.rejectServerRequest(request.id, -32601, "Thread title generation does not handle server requests."),
    onLog: () => undefined,
    onExit: () => {
      if (completed) return;
      completed = true;
      rejectCompletedTurn?.(new Error("Codex title generation app-server exited."));
    },
  });

  try {
    await client.connect();
    const runtime = await namingRuntimeForClient(client, runtimeSettings);
    const threadResponse = await client.startEphemeralThread(cwd, NAMING_SERVICE_NAME, TITLE_DEVELOPER_INSTRUCTIONS);
    namingThreadId = threadResponse.thread.id;
    const turnResponse = await client.startStructuredTurn(
      namingThreadId,
      cwd,
      namingPrompt(context),
      TITLE_OUTPUT_SCHEMA,
      runtime.model,
      runtime.effort,
    );
    expectedTurnId = turnResponse.turn.id;
    const turn = turnResponse.turn.status === "completed" ? turnWithCollectedItems(turnResponse.turn, completedItems) : await completedTurn;
    return titleFromNamingTurn(turn);
  } finally {
    completed = true;
    if (timeout) window.clearTimeout(timeout);
    client.disconnect();
  }
}

export function namingContextFromTurn(turn: Turn): ThreadNamingContext | null {
  if (turn.status !== "completed") return null;

  const userRequest = firstUserMessage(turn.items);
  const assistantResponse = lastAssistantMessage(turn.items);
  if (!userRequest || !assistantResponse) return null;

  return {
    userRequest: truncateForPrompt(userRequest),
    assistantResponse: truncateForPrompt(assistantResponse),
  };
}

export function namingContextFromDisplayItems(turnId: string, items: DisplayItem[]): ThreadNamingContext | null {
  const turnItems = items.filter((item) => item.turnId === turnId);
  const userRequest = turnItems.find((item) => item.kind === "message" && item.role === "user")?.text.trim() ?? "";
  const assistantResponse =
    [...turnItems]
      .reverse()
      .find((item) => item.kind === "message" && item.role === "assistant")
      ?.text.trim() ?? "";
  if (!userRequest || !assistantResponse) return null;
  return {
    userRequest: truncateForPrompt(userRequest),
    assistantResponse: truncateForPrompt(assistantResponse),
  };
}

export function firstNamingContextFromDisplayItems(items: DisplayItem[]): ThreadNamingContext | null {
  const turnIds = new Set<string>();
  for (const item of items) {
    if (!item.turnId || turnIds.has(item.turnId)) continue;
    turnIds.add(item.turnId);
    const context = namingContextFromDisplayItems(item.turnId, items);
    if (context) return context;
  }
  return null;
}

export async function findThreadNamingContext(options: {
  threadId: string;
  readTurns: ThreadNamingContextPageReader;
  fallbackDisplayItems?: DisplayItem[] | null;
  pageLimit?: number;
  maxPages?: number;
}): Promise<ThreadNamingContext | null> {
  const pageLimit = options.pageLimit ?? DEFAULT_CONTEXT_PAGE_LIMIT;
  const maxPages = options.maxPages ?? DEFAULT_CONTEXT_MAX_PAGES;
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await options.readTurns(options.threadId, cursor, pageLimit, "asc");
    for (const turn of response.data) {
      const context = namingContextFromTurn(turn);
      if (context) return context;
    }
    if (!response.nextCursor) break;
    cursor = response.nextCursor;
  }

  return options.fallbackDisplayItems ? firstNamingContextFromDisplayItems(options.fallbackDisplayItems) : null;
}

export function titleFromNamingTurn(turn: Turn): string | null {
  const response = lastAssistantMessage(turn.items);
  if (!response) return null;
  return normalizeGeneratedTitle(extractTitleFromModelText(response));
}

export interface NamingRuntime {
  model?: string;
  effort?: ReasoningEffort;
}

export function namingRuntime(settings: ThreadNamingRuntimeSettings): NamingRuntime {
  return {
    ...(settings.threadNamingModel ? { model: settings.threadNamingModel } : {}),
    ...(settings.threadNamingEffort ? { effort: settings.threadNamingEffort } : {}),
  };
}

export function validatedNamingRuntime(settings: ThreadNamingRuntimeSettings, models: Model[]): NamingRuntime {
  const runtime = namingRuntime(settings);
  if (!runtime.model || !runtime.effort) return runtime;

  const model = findModelByIdOrName(models, runtime.model);
  if (!model) return runtime;

  const supportedEfforts = new Set(supportedEffortsForModel(model));
  return supportedEfforts.has(runtime.effort) ? runtime : { model: runtime.model };
}

function turnWithCollectedItems(turn: Turn, items: ThreadItem[]): Turn {
  if (turn.items.length > 0 || items.length === 0) return turn;
  return { ...turn, items: [...items], itemsView: "full" };
}

async function namingRuntimeForClient(client: AppServerClient, settings: ThreadNamingRuntimeSettings): Promise<NamingRuntime> {
  const runtime = namingRuntime(settings);
  if (!runtime.model || !runtime.effort) return runtime;
  try {
    const response = await client.listModels(false);
    return validatedNamingRuntime(settings, response.data);
  } catch {
    return runtime;
  }
}

export function normalizeGeneratedTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^["'`「『]+/, "")
    .replace(/["'`」』]+$/, "")
    .trim();
  if (!title) return null;
  return title.length > MAX_TITLE_CHARS ? title.slice(0, MAX_TITLE_CHARS).trimEnd() : title;
}

function firstUserMessage(items: ThreadItem[]): string | null {
  for (const item of items) {
    if (item.type !== "userMessage") continue;
    const text = inputToText(item.content).trim();
    if (text) return text;
  }
  return null;
}

function lastAssistantMessage(items: ThreadItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type !== "agentMessage" && item.type !== "plan") continue;
    const text = item.text.trim();
    if (text) return text;
  }
  return null;
}

export function namingPrompt(context: ThreadNamingContext): string {
  return [
    "Create a history title for the following Codex conversation.",
    "",
    "Requirements:",
    "- First infer the main language of the user's initial request. This does not need to be strict; use the dominant language if mixed.",
    "- Write the title in the inferred language. If the language is unclear, use the language used most in the user's initial request.",
    "- Use a short noun phrase or short sentence.",
    "- Keep it compact: roughly 3-7 words for languages that use spaces, or 12-28 characters for languages that usually do not. Never exceed 40 characters.",
    "- Make the request target and purpose clear.",
    "- Avoid vague titles such as only 'about this', 'general question', or 'please implement'.",
    "- Do not use Markdown, quotation marks, trailing punctuation, explanations, or alternatives.",
    "",
    "User's initial request:",
    context.userRequest,
    "",
    "Codex's first response:",
    context.assistantResponse,
  ].join("\n");
}

function extractTitleFromModelText(text: string): unknown {
  const trimmed = stripCodeFence(text.trim());
  const objectText = extractJsonObject(trimmed) ?? trimmed;
  try {
    const parsed = JSON.parse(objectText) as unknown;
    if (parsed && typeof parsed === "object" && "title" in parsed) {
      return (parsed as { title?: unknown }).title;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function truncateForPrompt(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim(), MAX_CONTEXT_CHARS);
}
