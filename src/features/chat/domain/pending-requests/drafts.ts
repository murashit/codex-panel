import type {
  McpElicitationContentValue,
  PendingApprovalOption,
  PendingMcpElicitation,
  PendingMcpElicitationField,
  PendingRequestId,
  PendingUserInput,
  PendingUserInputQuestion,
} from "./model";

export function defaultPendingApprovalOptions(): PendingApprovalOption[] {
  return [
    { id: "accept", label: "Allow", action: "accept" },
    { id: "accept-session", label: "Allow session", action: "accept-session" },
    { id: "decline", label: "Deny", action: "decline" },
    { id: "cancel", label: "Cancel", action: "cancel" },
  ];
}

export function questionDefaultAnswer(question: PendingUserInputQuestion): string {
  return question.options?.[0]?.label ?? "";
}

export function userInputDraftKey(requestId: PendingRequestId, questionId: string): string {
  return pendingRequestDerivedKey(requestId, questionId);
}

export function userInputOtherDraftKey(requestId: PendingRequestId, questionId: string): string {
  return pendingRequestDerivedKey(requestId, `${questionId}:other`);
}

export function mcpElicitationDraftKey(requestId: PendingRequestId, fieldId: string): string {
  return pendingRequestDerivedKey(requestId, `mcp:${fieldId}`);
}

export function pendingRequestDerivedKeyPrefix(requestId: PendingRequestId): string {
  return `${String(requestId)}:`;
}

function pendingRequestDerivedKey(requestId: PendingRequestId, suffix: string): string {
  return `${pendingRequestDerivedKeyPrefix(requestId)}${suffix}`;
}

export function answersForPendingUserInput(input: PendingUserInput, drafts: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries(
    input.params.questions.map((question) => [
      question.id,
      drafts.get(userInputDraftKey(input.requestId, question.id)) ?? questionDefaultAnswer(question),
    ]),
  );
}

export function contentForPendingMcpElicitation(
  elicitation: PendingMcpElicitation,
  drafts: ReadonlyMap<string, string>,
): Record<string, McpElicitationContentValue> | null {
  if (elicitation.params.mode !== "form") return null;
  return Object.fromEntries(
    elicitation.params.fields.map((field) => [
      field.id,
      mcpElicitationFieldValue(field, drafts.get(mcpElicitationDraftKey(elicitation.requestId, field.id))),
    ]),
  );
}

export function mcpElicitationFieldDefaultDraft(field: PendingMcpElicitationField): string {
  switch (field.type) {
    case "boolean":
      return field.defaultValue ? "true" : "false";
    case "multi-select":
      return JSON.stringify(field.defaultValue);
    case "number":
    case "integer":
      return field.defaultValue === null ? "" : String(field.defaultValue);
    default:
      return field.defaultValue;
  }
}

function mcpElicitationFieldValue(field: PendingMcpElicitationField, draftValue: string | undefined): McpElicitationContentValue {
  const draft = draftValue ?? mcpElicitationFieldDefaultDraft(field);
  switch (field.type) {
    case "boolean":
      return draft === "true";
    case "number":
    case "integer":
      return numericMcpElicitationFieldValue(field, draft);
    case "multi-select":
      return multiSelectMcpElicitationFieldValue(field, draft);
    default:
      return draft;
  }
}

function numericMcpElicitationFieldValue(
  field: Extract<PendingMcpElicitationField, { type: "number" | "integer" }>,
  draft: string,
): number | null {
  if (draft.trim() === "") return null;
  const parsed = field.type === "integer" ? Number.parseInt(draft, 10) : Number(draft);
  if (Number.isFinite(parsed)) return parsed;
  return field.defaultValue;
}

function multiSelectMcpElicitationFieldValue(
  field: Extract<PendingMcpElicitationField, { type: "multi-select" }>,
  draft: string,
): readonly string[] {
  try {
    const parsed = JSON.parse(draft) as unknown;
    if (Array.isArray(parsed)) {
      const allowed = new Set(field.options.map((option) => option.value));
      return parsed.filter((value): value is string => typeof value === "string" && allowed.has(value));
    }
  } catch {
    // Fall through to the request default when a stale draft cannot be parsed.
  }
  return field.defaultValue;
}
