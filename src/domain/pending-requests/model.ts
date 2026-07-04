export type PendingRequestId = string | number;

export type ApprovalActionIntent = "accept" | "accept-session" | "decline" | "cancel";

type ApprovalKind = "command" | "fileChange" | "permission";

export interface ApprovalDetailRow {
  key: string;
  value: string;
}

interface ApprovalResponseOptions {
  accept: unknown;
  acceptSession: unknown;
  decline: unknown;
  cancel: unknown;
}

interface ApprovalOptionAction {
  kind: "approval-option";
  intent: ApprovalActionIntent;
  response: unknown;
}

export type ApprovalAction = ApprovalActionIntent | ApprovalOptionAction;

export interface PendingApprovalOption {
  id: string;
  label: string;
  action: ApprovalAction;
  intent: ApprovalActionIntent;
}

export interface PendingApproval {
  requestId: PendingRequestId;
  kind: ApprovalKind;
  turnId: string | null;
  title: string;
  summary: string;
  resultSummary: string;
  details: readonly ApprovalDetailRow[];
  responses: ApprovalResponseOptions;
  actionOptions: readonly PendingApprovalOption[] | null;
}

interface PendingUserInputOption {
  label: string;
  description: string;
}

export interface PendingUserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: readonly PendingUserInputOption[] | null;
}

interface PendingUserInputParams {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: readonly PendingUserInputQuestion[];
  autoResolutionMs: number | null;
}

export interface PendingUserInput {
  requestId: PendingRequestId;
  params: PendingUserInputParams;
}

export type McpElicitationAction = "accept" | "decline" | "cancel";

export type McpElicitationContentValue = string | number | boolean | readonly string[] | null;

export interface PendingMcpElicitationOption {
  value: string;
  label: string;
}

interface PendingMcpElicitationFieldBase {
  id: string;
  title: string;
  description: string | null;
  required: boolean;
}

export type PendingMcpElicitationField =
  | (PendingMcpElicitationFieldBase & {
      type: "string";
      defaultValue: string;
    })
  | (PendingMcpElicitationFieldBase & {
      type: "number" | "integer";
      defaultValue: number | null;
    })
  | (PendingMcpElicitationFieldBase & {
      type: "boolean";
      defaultValue: boolean;
    })
  | (PendingMcpElicitationFieldBase & {
      type: "single-select";
      options: readonly PendingMcpElicitationOption[];
      defaultValue: string;
    })
  | (PendingMcpElicitationFieldBase & {
      type: "multi-select";
      options: readonly PendingMcpElicitationOption[];
      defaultValue: readonly string[];
    });

interface PendingMcpElicitationFormParams {
  threadId: string;
  turnId: string | null;
  serverName: string;
  mode: "form";
  message: string;
  meta: unknown;
  fields: readonly PendingMcpElicitationField[];
}

interface PendingMcpElicitationUrlParams {
  threadId: string;
  turnId: string | null;
  serverName: string;
  mode: "url";
  message: string;
  meta: unknown;
  url: string;
  elicitationId: string;
}

export interface PendingMcpElicitation {
  requestId: PendingRequestId;
  params: PendingMcpElicitationFormParams | PendingMcpElicitationUrlParams;
}

export function approvalActionKind(action: ApprovalAction): "accept" | "accept-session" | "decline" | "cancel" {
  return typeof action === "object" ? action.intent : action;
}

export function defaultPendingApprovalOptions(): PendingApprovalOption[] {
  return [
    { id: "accept", label: "Allow", action: "accept", intent: "accept" },
    { id: "accept-session", label: "Allow session", action: "accept-session", intent: "accept-session" },
    { id: "decline", label: "Deny", action: "decline", intent: "decline" },
    { id: "cancel", label: "Cancel", action: "cancel", intent: "cancel" },
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
    // Fall through to schema default when a stale draft cannot be parsed.
  }
  return field.defaultValue;
}
