import type { UserInput } from "../../generated/app-server/v2/UserInput";
import type { CodexInputItem } from "../../domain/chat/input";

export type { CodexInput, CodexInputItem } from "../../domain/chat/input";

export function toAppServerUserInput(input: readonly CodexInputItem[]): UserInput[] {
  return input.map((item) => {
    if (item.type === "text") return { type: "text", text: item.text, text_elements: [] };
    return { ...item };
  });
}
