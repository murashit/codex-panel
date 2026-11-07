import type { McpElicitationContentValue, PendingMcpElicitation, PendingMcpElicitationField } from "./model";

export type McpElicitationFieldIssue =
  | { kind: "required" | "number" | "integer" | "selection" }
  | { kind: "minLength" | "maxLength" | "minimum" | "maximum"; limit: number }
  | { kind: "minItems" | "maxItems"; limit: bigint };

export type McpElicitationContentResult =
  | { valid: true; content: Record<string, McpElicitationContentValue> | null }
  | { valid: false; issues: ReadonlyMap<string, McpElicitationFieldIssue> };

type McpElicitationFieldResult =
  | { valid: true; value: McpElicitationContentValue | undefined }
  | { valid: false; issue: McpElicitationFieldIssue };

export function contentForPendingMcpElicitation(elicitation: PendingMcpElicitation): McpElicitationContentResult {
  if (elicitation.params.mode !== "form") return { valid: true, content: null };
  const entries: [string, McpElicitationContentValue][] = [];
  const issues = new Map<string, McpElicitationFieldIssue>();
  for (const field of elicitation.params.fields) {
    const result = mcpElicitationFieldValue(field);
    if (!result.valid) issues.set(field.id, result.issue);
    else if (result.value !== undefined) entries.push([field.id, result.value]);
  }
  return issues.size > 0 ? { valid: false, issues } : { valid: true, content: Object.fromEntries(entries) };
}

function mcpElicitationFieldValue(field: PendingMcpElicitationField): McpElicitationFieldResult {
  // Empty optional controls mean unanswered. Required strings and arrays still
  // supply values: required is presence, not minLength or minItems.
  switch (field.type) {
    case "boolean":
      return { valid: true, value: field.value };
    case "number":
    case "integer":
      return numericMcpElicitationFieldValue(field);
    case "multi-select":
      return multiSelectMcpElicitationFieldValue(field);
    case "single-select":
      if (field.value === null && !field.required) return { valid: true, value: undefined };
      if (field.value === null || !field.options.some((option) => option.value === field.value)) {
        return { valid: false, issue: { kind: "selection" } };
      }
      return stringMcpElicitationFieldValue(field, field.value);
    case "string":
      if (!field.required && field.value === "") return { valid: true, value: undefined };
      return stringMcpElicitationFieldValue(field, field.value);
  }
}

function stringMcpElicitationFieldValue(
  field: Extract<PendingMcpElicitationField, { type: "string" | "single-select" }>,
  value: string,
): McpElicitationFieldResult {
  const length = Array.from(value).length;
  if (field.minLength !== undefined && length < field.minLength) {
    return { valid: false, issue: { kind: "minLength", limit: field.minLength } };
  }
  if (field.maxLength !== undefined && length > field.maxLength) {
    return { valid: false, issue: { kind: "maxLength", limit: field.maxLength } };
  }
  return { valid: true, value };
}

function numericMcpElicitationFieldValue(
  field: Extract<PendingMcpElicitationField, { type: "number" | "integer" }>,
): McpElicitationFieldResult {
  if (field.value.trim() === "") {
    return field.required ? { valid: false, issue: { kind: "required" } } : { valid: true, value: undefined };
  }
  const value = Number(field.value);
  if (!Number.isFinite(value)) return { valid: false, issue: { kind: "number" } };
  if (field.type === "integer" && !Number.isInteger(value)) return { valid: false, issue: { kind: "integer" } };
  if (field.minimum !== undefined && value < field.minimum) {
    return { valid: false, issue: { kind: "minimum", limit: field.minimum } };
  }
  if (field.maximum !== undefined && value > field.maximum) {
    return { valid: false, issue: { kind: "maximum", limit: field.maximum } };
  }
  return { valid: true, value };
}

function multiSelectMcpElicitationFieldValue(
  field: Extract<PendingMcpElicitationField, { type: "multi-select" }>,
): McpElicitationFieldResult {
  const value = field.value;
  if (!value.every((item) => field.options.some((option) => option.value === item))) {
    return { valid: false, issue: { kind: "selection" } };
  }
  if (!field.required && value.length === 0) return { valid: true, value: undefined };
  const count = BigInt(value.length);
  if (field.minItems !== undefined && count < field.minItems) {
    return { valid: false, issue: { kind: "minItems", limit: field.minItems } };
  }
  if (field.maxItems !== undefined && count > field.maxItems) {
    return { valid: false, issue: { kind: "maxItems", limit: field.maxItems } };
  }
  return { valid: true, value };
}
