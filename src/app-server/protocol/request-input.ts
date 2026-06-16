import type { CodexInputItem } from "../../domain/chat/input";

type AppServerUserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; detail?: "auto" | "low" | "high" | "original"; url: string }
  | { type: "localImage"; detail?: "auto" | "low" | "high" | "original"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

interface AppServerAdditionalContextEntry {
  value: string;
  kind: "untrusted" | "application";
}

export function toAppServerUserInput(input: readonly CodexInputItem[]): AppServerUserInput[] {
  return input.flatMap((item) => {
    if (item.type === "text") return { type: "text", text: item.text, text_elements: [] };
    if (item.type === "additionalContext") return [];
    return { ...item };
  });
}

export function additionalContextFromCodexInput(
  input: readonly CodexInputItem[],
): Record<string, AppServerAdditionalContextEntry> | undefined {
  const additionalContext: Record<string, AppServerAdditionalContextEntry> = {};
  for (const item of input) {
    if (item.type !== "additionalContext") continue;
    if (!item.key || !item.value) continue;
    additionalContext[item.key] = { value: item.value, kind: item.kind };
  }
  return Object.keys(additionalContext).length > 0 ? additionalContext : undefined;
}
