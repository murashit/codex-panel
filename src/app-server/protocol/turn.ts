import {
  conversationSummaryFromTranscriptEntries,
  nonEmptyConversationSummaries,
  type ThreadConversationSummary,
  type ThreadTranscriptEntry,
} from "../../domain/threads/transcript";

type AppServerUserInput =
  | { type: "text"; text: string; text_elements: AppServerTextElement[] }
  | { type: "image"; url: string; detail?: "auto" | "low" | "high" | "original" }
  | { type: "localImage"; path: string; detail?: "auto" | "low" | "high" | "original" }
  | { type: "mention"; name: string; path: string }
  | { type: "skill"; name: string; path: string };
interface AppServerTextElement {
  byteRange: { start: number; end: number };
  placeholder: string | null;
}
type TurnItemsView = "notLoaded" | "summary" | "full";
type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";
type CommandAction =
  | { type: "read"; command: string; name: string; path: string | null }
  | { type: "search"; command: string; query: string | null; path: string | null }
  | { type: "listFiles"; command: string; path: string | null }
  | { type: "unknown"; command: string };
type WebSearchAction =
  | { type: "search"; query: string | null; queries: string[] | null }
  | { type: "openPage"; url: string | null }
  | { type: "findInPage"; url: string | null; pattern: string | null }
  | { type: "other" };
type HttpCodexErrorInfo =
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } };
type AppServerCodexErrorInfo =
  | "contextWindowExceeded"
  | "usageLimitExceeded"
  | "serverOverloaded"
  | "cyberPolicy"
  | "internalServerError"
  | "unauthorized"
  | "badRequest"
  | "threadRollbackFailed"
  | "sandboxError"
  | "other"
  | HttpCodexErrorInfo
  | { activeTurnNotSteerable: { turnKind: "review" | "compact" } };

interface TurnError {
  message: string;
  codexErrorInfo: AppServerCodexErrorInfo | null;
  additionalDetails: string | null;
}

interface BaseTurnItem<Type extends string> {
  type: Type;
  id: string;
}

export type TurnItem =
  | (BaseTurnItem<"userMessage"> & { clientId: string | null; content: AppServerUserInput[] })
  | (BaseTurnItem<"hookPrompt"> & { fragments: { text: string; [key: string]: unknown }[] })
  | (BaseTurnItem<"agentMessage"> & { text: string; phase: string | null; memoryCitation: unknown })
  | (BaseTurnItem<"plan"> & { text: string })
  | (BaseTurnItem<"reasoning"> & { summary: string[]; content: string[] })
  | (BaseTurnItem<"commandExecution"> & {
      command: string;
      cwd: string;
      processId: string | null;
      source: string;
      status: string;
      commandActions: CommandAction[];
      aggregatedOutput: string | null;
      exitCode: number | null;
      durationMs: number | null;
    })
  | (BaseTurnItem<"fileChange"> & { changes: { path: string; kind: { type: string }; diff: string }[]; status: string })
  | (BaseTurnItem<"mcpToolCall"> & {
      server: string;
      tool: string;
      status: string;
      arguments: unknown;
      appContext: unknown;
      pluginId: string | null;
      result: unknown;
      error: { message?: string; [key: string]: unknown } | null;
      durationMs: number | null;
    })
  | (BaseTurnItem<"dynamicToolCall"> & {
      namespace: string | null;
      tool: string;
      arguments: unknown;
      status: string;
      contentItems: unknown[] | null;
      success: boolean | null;
      durationMs: number | null;
    })
  | (BaseTurnItem<"collabAgentToolCall"> & {
      tool: string;
      status: string;
      senderThreadId: string;
      receiverThreadIds: string[];
      prompt: string | null;
      model: string | null;
      reasoningEffort: string | null;
      agentsStates: Record<string, { status?: string | null; message?: string | null } | undefined>;
    })
  | (BaseTurnItem<"subAgentActivity"> & { kind: string; agentThreadId: string; agentPath: string })
  | (BaseTurnItem<"webSearch"> & { query: string; action: WebSearchAction | null })
  | (BaseTurnItem<"imageView"> & { path: string })
  | (BaseTurnItem<"sleep"> & { durationMs: number })
  | (BaseTurnItem<"imageGeneration"> & { status: string; revisedPrompt: string | null; result: string; savedPath?: string })
  | (BaseTurnItem<"enteredReviewMode"> & { review: string })
  | (BaseTurnItem<"exitedReviewMode"> & { review: string })
  | BaseTurnItem<"contextCompaction">;

export interface TurnRecord {
  id: string;
  items: TurnItem[];
  itemsView: TurnItemsView;
  status: TurnStatus;
  error: TurnError | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

function transcriptEntriesFromTurnRecord(turn: TurnRecord): ThreadTranscriptEntry[] {
  return turn.items.flatMap((item) => transcriptEntriesFromTurnItem(item, turn));
}

export function transcriptEntriesFromTurnRecords(turns: readonly TurnRecord[]): ThreadTranscriptEntry[] {
  return turns.flatMap(transcriptEntriesFromTurnRecord);
}

function conversationSummaryFromTurnRecord(turn: TurnRecord): ThreadConversationSummary {
  return conversationSummaryFromTranscriptEntries(transcriptEntriesFromTurnRecord(turn));
}

export function conversationAssistantTextFromTurnRecord(turn: TurnRecord): string | null {
  return conversationSummaryFromTurnRecord(turn).assistantText;
}

export function completedConversationSummaryFromTurnRecord(turn: TurnRecord): ThreadConversationSummary | null {
  if (turn.status !== "completed") return null;
  const summary = conversationSummaryFromTurnRecord(turn);
  return summary.userText && summary.assistantText ? summary : null;
}

export function completedConversationSummariesFromTurnRecords(turns: readonly TurnRecord[]): ThreadConversationSummary[] {
  return turns.flatMap((turn) => {
    const summary = completedConversationSummaryFromTurnRecord(turn);
    return summary ? [summary] : [];
  });
}

function conversationSummariesFromTurnRecords(turns: readonly TurnRecord[]): ThreadConversationSummary[] {
  return nonEmptyConversationSummaries(turns.map(conversationSummaryFromTurnRecord));
}

export function chronologicalConversationSummariesFromTurnRecords(turns: readonly TurnRecord[]): ThreadConversationSummary[] {
  return conversationSummariesFromTurnRecords(chronologicalTurnRecords(turns));
}

export function turnUserItemText(item: Extract<TurnItem, { type: "userMessage" }>): string {
  return userInputText(item.content);
}

export function lastAgentMessageTextFromTurnRecord(turn: TurnRecord): string | null {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item === undefined) continue;
    if (item.type !== "agentMessage") continue;
    const text = item.text.trim();
    if (text) return text;
  }
  return null;
}

function transcriptEntriesFromTurnItem(item: TurnItem, turn: TurnRecord): ThreadTranscriptEntry[] {
  if (item.type === "userMessage") {
    const text = turnUserItemText(item).trim();
    return text ? [{ kind: "user", text, timestamp: turn.startedAt }] : [];
  }
  if (item.type === "agentMessage") {
    const text = item.text.trim();
    return text ? [{ kind: "assistant", text, timestamp: turn.completedAt ?? turn.startedAt }] : [];
  }
  if (item.type === "plan") {
    const text = item.text.trim();
    return text ? [{ kind: "plan", text, timestamp: turn.completedAt ?? turn.startedAt }] : [];
  }
  return [];
}

function userInputText(content: readonly AppServerUserInput[]): string {
  const hasText = content.some((item) => item.type === "text" && item.text.length > 0);
  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      if (item.type === "localImage") return `[local image] ${item.path}`;
      if (item.type === "image") return `[image] ${item.url}`;
      if (item.type === "mention") return hasText ? "" : `[@${item.name}] ${item.path}`;
      return hasText ? "" : `[$${item.name}] ${item.path}`;
    })
    .filter(Boolean)
    .join("\n");
}

function chronologicalTurnRecords(turns: readonly TurnRecord[]): TurnRecord[] {
  return [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}
