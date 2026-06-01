import type { SortDirection } from "../../generated/app-server/v2/SortDirection";
import type { Turn } from "../../generated/app-server/v2/Turn";
import { truncate } from "../../utils";
import { completedTurnConversationSummary, turnConversationSummary } from "./transcript";

const MAX_CONTEXT_CHARS = 4_000;
const MAX_TITLE_CHARS = 40;
const DEFAULT_CONTEXT_PAGE_LIMIT = 20;
const DEFAULT_CONTEXT_MAX_PAGES = 5;

export const THREAD_NAMING_CONTEXT_UNAVAILABLE_MESSAGE =
  "Auto-name needs completed history or visible resumed history with both user and assistant text.";

export interface ThreadNamingContext {
  userRequest: string;
  assistantResponse: string;
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

export function namingContextFromTurn(turn: Turn): ThreadNamingContext | null {
  const summary = completedTurnConversationSummary(turn);
  if (!summary?.userText || !summary.assistantText) return null;

  return {
    userRequest: truncateForPrompt(summary.userText),
    assistantResponse: truncateForPrompt(summary.assistantText),
  };
}

export async function findThreadNamingContext(options: {
  threadId: string;
  readTurns: ThreadNamingContextPageReader;
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

  return null;
}

export function titleFromNamingTurn(turn: Turn): string | null {
  const response = turnConversationSummary(turn).assistantText;
  if (!response) return null;
  return normalizeGeneratedTitle(extractTitleFromModelText(response));
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

export function namingPrompt(context: ThreadNamingContext): string {
  return [
    "Create a thread title for the following Codex thread.",
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
