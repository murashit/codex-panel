import { truncate } from "../display/text-preview";
import type { TurnTranscriptSummary } from "./transcript";

const THREAD_TITLE_CONTEXT_MAX_CHARS = 4_000;

export interface ThreadTitleContext {
  userRequest: string;
  assistantResponse: string;
}

export function threadTitleContextFromTurnTranscriptSummary(summary: TurnTranscriptSummary): ThreadTitleContext | null {
  if (!summary.userText || !summary.assistantText) return null;

  return {
    userRequest: threadTitleContextPromptText(summary.userText),
    assistantResponse: threadTitleContextPromptText(summary.assistantText),
  };
}

export function threadTitleContextPromptText(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim(), THREAD_TITLE_CONTEXT_MAX_CHARS);
}
