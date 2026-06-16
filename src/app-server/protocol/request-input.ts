import type { AdditionalContextEntry } from "../../generated/app-server/v2/AdditionalContextEntry";
import type { UserInput } from "../../generated/app-server/v2/UserInput";
import type { CodexInputItem } from "../../domain/chat/input";

export type { CodexInput, CodexInputItem } from "../../domain/chat/input";

export function toAppServerUserInput(input: readonly CodexInputItem[]): UserInput[] {
  return input.flatMap((item) => {
    if (item.type === "text") return { type: "text", text: item.text, text_elements: [] };
    if (item.type === "additionalContext") return [];
    return { ...item };
  });
}

export function additionalContextFromCodexInput(input: readonly CodexInputItem[]): Record<string, AdditionalContextEntry> | undefined {
  const additionalContext: Record<string, AdditionalContextEntry> = {};
  for (const item of input) {
    if (item.type !== "additionalContext") continue;
    if (!item.key || !item.value) continue;
    additionalContext[item.key] = { value: item.value, kind: item.kind };
  }
  return Object.keys(additionalContext).length > 0 ? additionalContext : undefined;
}
