import type { CodexInputItem } from "../../../../../domain/chat/input";
import type { ThreadStreamContextAttachment } from "../items";

export const WEB_CONTEXT_KEY = "codex_panel_web_context";

export function contextAttachmentsFromInput(input: readonly CodexInputItem[]): ThreadStreamContextAttachment[] {
  return input.flatMap((item) => {
    if (item.type !== "additionalContext" || item.key !== WEB_CONTEXT_KEY) return [];
    const source = webContextSource(item.value);
    return [{ label: "Web page", ...(source ? { detail: source } : {}) }];
  });
}

function webContextSource(value: string): string | null {
  const sourceLine = value.split("\n").find((line) => line.startsWith("Source:"));
  const source = sourceLine?.slice("Source:".length).trim() ?? "";
  return source || null;
}
