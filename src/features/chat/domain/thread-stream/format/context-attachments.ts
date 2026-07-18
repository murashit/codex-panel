import type { TurnContextManifest } from "../../../../../domain/chat/context-manifest";
import type { CodexInputItem } from "../../../../../domain/chat/input";
import type { ThreadStreamContextAttachment } from "../items";

export const WEB_CONTEXT_KEY = "codex_panel_web_context";

export function contextAttachmentsFromInput(input: readonly CodexInputItem[]): ThreadStreamContextAttachment[] {
  return input.flatMap((item) => {
    if (item.type !== "additionalContext" || (item.attachment?.kind !== "web" && item.key !== WEB_CONTEXT_KEY)) return [];
    const source = webContextSource(item.value);
    return [{ label: "Web page", ...(source ? { detail: source } : {}) }];
  });
}

export function contextAttachmentsFromManifest(manifest: TurnContextManifest | null, visibleText: string): ThreadStreamContextAttachment[] {
  const attachments: ThreadStreamContextAttachment[] = [];
  const web = manifest?.contexts.find((context) => context.kind === "web");
  if (web) {
    const source = visibleWebSource(visibleText);
    attachments.push({ label: web.truncated ? "Web page (truncated)" : "Web page", ...(source ? { detail: source } : {}) });
  }
  const obsidian = manifest?.contexts.find((context) => context.kind === "obsidian" && context.truncated);
  if (obsidian) {
    attachments.push({ label: obsidian.inlineExcerpts ? "Obsidian excerpt (truncated)" : "Obsidian context (truncated)" });
  }
  return attachments;
}

function webContextSource(value: string): string | null {
  const sourceLine = value.split("\n").find((line) => line.startsWith("Source:"));
  const source = sourceLine?.slice("Source:".length).trim() ?? "";
  return source || null;
}

function visibleWebSource(text: string): string | null {
  const firstToken = text.trim().split(/\s+/, 1)[0] ?? "";
  try {
    const parsed = new URL(firstToken);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
