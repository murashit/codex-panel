import type { CodexInputItem } from "../../domain/chat/input";

type AppServerUserInputImageDetail = "auto" | "low" | "high" | "original";

type AppServerUserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; detail?: AppServerUserInputImageDetail; url: string }
  | { type: "localImage"; detail?: AppServerUserInputImageDetail; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

interface AppServerAdditionalContextEntry {
  value: string;
  kind: "untrusted" | "application";
}

export function toAppServerUserInput(input: readonly CodexInputItem[]): AppServerUserInput[] {
  return input.flatMap((item) => appServerUserInputItemFromCodexInputItem(item));
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

function appServerUserInputItemFromCodexInputItem(item: CodexInputItem): AppServerUserInput[] {
  switch (item.type) {
    case "text":
      return [{ type: "text", text: item.text, text_elements: [] }];
    case "image":
      return [{ type: "image", url: item.url, ...appServerImageDetailProp(item.detail) }];
    case "localImage":
      return [{ type: "localImage", path: item.path, ...appServerImageDetailProp(item.detail) }];
    case "skill":
      return [{ type: "skill", name: item.name, path: item.path }];
    case "mention":
      return [{ type: "mention", name: item.name, path: item.path }];
    case "additionalContext":
      return [];
  }
}

function appServerImageDetailProp(detail: Extract<CodexInputItem, { type: "image" | "localImage" }>["detail"]): {
  detail?: AppServerUserInputImageDetail;
} {
  return detail === undefined ? {} : { detail };
}
