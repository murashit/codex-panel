import { normalizeReasoningEffort, type ReasoningEffort } from "../../../../domain/catalog/metadata";

const DEFAULT_ALIASES = new Set(["default", "reset", "clear", "off"]);

export function parseModelOverride(args: string): string | null | undefined {
  const model = args.trim();
  if (!model) return undefined;
  if (DEFAULT_ALIASES.has(model.toLowerCase())) return null;
  return model;
}

export function parseReasoningEffortOverride(args: string): ReasoningEffort | null | undefined {
  const effort = args.trim();
  if (!effort) return undefined;
  if (DEFAULT_ALIASES.has(effort.toLowerCase())) return null;
  return normalizeReasoningEffort(effort) ?? undefined;
}
