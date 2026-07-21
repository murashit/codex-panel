import { splitUtf8Context } from "../../domain/chat/context-budget";
import type { CodexInputItem } from "../../domain/chat/input";
import { turnContextSubmissionId } from "../../domain/chat/submission-id";

type AppServerUserInputImageDetail = "auto" | "low" | "high" | "original";

type AppServerUserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; detail?: AppServerUserInputImageDetail; url: string }
  | { type: "localImage"; detail?: AppServerUserInputImageDetail; path: string }
  | { type: "skill"; name: string; path: string };

interface AppServerAdditionalContextEntry {
  value: string;
  kind: "untrusted" | "application";
}

export interface AppServerTurnInput {
  input: AppServerUserInput[];
  additionalContext?: Record<string, AppServerAdditionalContextEntry>;
}

const ADDITIONAL_CONTEXT_PART_BODY_MAX_BYTES = 2_800;
const ADDITIONAL_CONTEXT_MAX_PARTS = 8;

export function toAppServerUserInput(input: readonly CodexInputItem[]): AppServerUserInput[] {
  return input.flatMap((item) => appServerUserInputItemFromCodexInputItem(item));
}

export function appServerTurnInputFromCodexInput(input: readonly CodexInputItem[], submissionId: string): AppServerTurnInput {
  const additionalContext: Record<string, AppServerAdditionalContextEntry> = {};
  const contexts = input.filter(
    (item): item is Extract<CodexInputItem, { type: "additionalContext" }> =>
      item.type === "additionalContext" && Boolean(item.key) && Boolean(item.value),
  );
  if (contexts.length > ADDITIONAL_CONTEXT_MAX_PARTS) {
    throw new Error(`Too many additional context sources (${String(contexts.length)}).`);
  }
  const partAllocations = allocatedPartCounts(contexts);
  for (const [contextIndex, item] of contexts.entries()) {
    const id = `${turnContextSubmissionId(submissionId)}.${String(contextIndex).padStart(2, "0")}`;
    const split = splitUtf8Context(item.value, ADDITIONAL_CONTEXT_PART_BODY_MAX_BYTES, partAllocations[contextIndex] ?? 1);
    const partCount = split.parts.length;
    split.parts.forEach((part, partIndex) => {
      const key = [
        "codex_panel",
        id,
        safeKeyPart(item.key),
        `part_${String(partIndex + 1).padStart(2, "0")}_of_${String(partCount).padStart(2, "0")}`,
      ].join(".");
      additionalContext[key] = {
        kind: item.kind,
        value: [
          `Codex Panel context part ${String(partIndex + 1)}/${String(partCount)}.`,
          `Source: ${safeKeyPart(item.key)}`,
          "",
          part,
        ].join("\n"),
      };
    });
  }
  return {
    input: toAppServerUserInput(input),
    ...(Object.keys(additionalContext).length > 0 ? { additionalContext } : {}),
  };
}

function allocatedPartCounts(contexts: readonly Extract<CodexInputItem, { type: "additionalContext" }>[]): number[] {
  const allocations = contexts.map(() => 1);
  const desired = contexts.map(
    (context) => splitUtf8Context(context.value, ADDITIONAL_CONTEXT_PART_BODY_MAX_BYTES, ADDITIONAL_CONTEXT_MAX_PARTS).parts.length,
  );
  let remaining = ADDITIONAL_CONTEXT_MAX_PARTS - contexts.length;
  for (let index = 0; index < contexts.length && remaining > 0; index += 1) {
    const extra = Math.min(Math.max((desired[index] ?? 1) - 1, 0), remaining);
    allocations[index] = (allocations[index] ?? 1) + extra;
    remaining -= extra;
  }
  return allocations;
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
    case "fileReference":
      return [];
    case "additionalContext":
      return [];
  }
}

function safeKeyPart(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
  return safe || "context";
}

function appServerImageDetailProp(detail: Extract<CodexInputItem, { type: "image" | "localImage" }>["detail"]): {
  detail?: AppServerUserInputImageDetail;
} {
  return detail === undefined ? {} : { detail };
}
