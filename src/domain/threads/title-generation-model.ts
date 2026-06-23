import type { ThreadConversationSummary } from "./transcript";
import { truncate } from "../../shared/text/preview";

const THREAD_TITLE_CONTEXT_MAX_CHARS = 4_000;
const DEFAULT_CONTEXT_PAGE_LIMIT = 20;
const DEFAULT_CONTEXT_MAX_PAGES = 5;

export const THREAD_TITLE_MAX_CHARS = 40;
export const THREAD_TITLE_CONTEXT_UNAVAILABLE_MESSAGE =
  "Auto-name needs completed history or visible resumed history with both user and assistant text.";

export interface ThreadTitleContext {
  userRequest: string;
  assistantResponse: string;
}

interface ThreadTitleContextPage {
  data: ThreadConversationSummary[];
  nextCursor: string | null;
}

export type ThreadTitleContextPageReader = (
  threadId: string,
  cursor: string | null,
  limit: number,
  sortDirection: "asc" | "desc",
) => Promise<ThreadTitleContextPage>;

export function threadTitleContextFromConversationSummary(summary: ThreadConversationSummary): ThreadTitleContext | null {
  if (!summary.userText || !summary.assistantText) return null;

  return {
    userRequest: threadTitleContextPromptText(summary.userText),
    assistantResponse: threadTitleContextPromptText(summary.assistantText),
  };
}

export async function findThreadTitleContext(options: {
  threadId: string;
  readTurns: ThreadTitleContextPageReader;
  pageLimit?: number;
  maxPages?: number;
}): Promise<ThreadTitleContext | null> {
  const pageLimit = options.pageLimit ?? DEFAULT_CONTEXT_PAGE_LIMIT;
  const maxPages = options.maxPages ?? DEFAULT_CONTEXT_MAX_PAGES;
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await options.readTurns(options.threadId, cursor, pageLimit, "asc");
    for (const summary of response.data) {
      const context = threadTitleContextFromConversationSummary(summary);
      if (context) return context;
    }
    if (!response.nextCursor) break;
    cursor = response.nextCursor;
  }

  return null;
}

function normalizeGeneratedThreadTitle(value: unknown): string | null {
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
  return title.length > THREAD_TITLE_MAX_CHARS ? title.slice(0, THREAD_TITLE_MAX_CHARS).trimEnd() : title;
}

export function threadTitleFromGeneratedText(text: string): string | null {
  return normalizeGeneratedThreadTitle(extractTitleFromModelText(text));
}

export function threadTitlePrompt(context: ThreadTitleContext): string {
  return [
    "Create a thread title for the following Codex thread.",
    "",
    "Requirements:",
    "- First infer the main language of the user's initial request. This does not need to be strict; use the dominant language if mixed.",
    "- Write the title in the inferred language. If the language is unclear, use the language used most in the user's initial request.",
    "- Use a short noun phrase or short sentence.",
    `- Keep it compact: roughly 3-7 words for languages that use spaces, or 12-28 characters for languages that usually do not. Never exceed ${String(THREAD_TITLE_MAX_CHARS)} characters.`,
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

export function threadTitleContextPromptText(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim(), THREAD_TITLE_CONTEXT_MAX_CHARS);
}
