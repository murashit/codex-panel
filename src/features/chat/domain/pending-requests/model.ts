export type PendingRequestId = string | number;

type SimpleApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type CommandApprovalDecision =
  | SimpleApprovalDecision
  | { acceptWithExecpolicyAmendment: unknown }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: { action: "allow" | "deny"; [key: string]: unknown } } };

interface CommandApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  approvalId?: string | null;
  reason?: string | null;
  networkApprovalContext?: unknown;
  command?: string | null;
  cwd?: string | null;
  commandActions?: unknown[] | null;
  additionalPermissions?: unknown;
  proposedExecpolicyAmendment?: unknown;
  proposedNetworkPolicyAmendments?: unknown[] | null;
  availableDecisions?: CommandApprovalDecision[] | null;
}

interface FileChangeApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  reason: string | null;
  grantRoot: string | null;
}

interface PermissionProfile {
  network?: { enabled?: boolean | null } | null;
  fileSystem?: {
    entries?: readonly { path: unknown; access?: unknown }[] | null;
    read?: unknown;
    write?: unknown;
    globScanMaxDepth?: unknown;
  } | null;
}

interface PermissionsApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  reason: string | null;
  cwd: string;
  environmentId: string | null;
  permissions: PermissionProfile;
}

export type ApprovalAction = "accept" | "accept-session" | "decline" | "cancel" | CommandApprovalDecisionAction;

interface CommandApprovalDecisionAction {
  kind: "command-decision";
  decision: CommandApprovalDecision;
}

export type PendingApproval =
  | {
      requestId: PendingRequestId;
      method: "item/commandExecution/requestApproval";
      params: CommandApprovalParams;
    }
  | {
      requestId: PendingRequestId;
      method: "item/fileChange/requestApproval";
      params: FileChangeApprovalParams;
    }
  | {
      requestId: PendingRequestId;
      method: "item/permissions/requestApproval";
      params: PermissionsApprovalParams;
    };

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
  options: PendingUserInputOption[] | null;
}

interface PendingUserInputParams {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: PendingUserInputQuestion[];
  autoResolutionMs: number | null;
}

export interface PendingUserInput {
  requestId: PendingRequestId;
  method: "item/tool/requestUserInput";
  params: PendingUserInputParams;
}

export type McpElicitationAction = "accept" | "decline" | "cancel";

export type McpElicitationContentValue = string | number | boolean | readonly string[] | null;

interface PendingMcpElicitationOption {
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
      format: string | null;
      minLength: number | null;
      maxLength: number | null;
      defaultValue: string;
    })
  | (PendingMcpElicitationFieldBase & {
      type: "number" | "integer";
      minimum: number | null;
      maximum: number | null;
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
      minItems: number | null;
      maxItems: number | null;
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
  method: "mcpServer/elicitation/request";
  params: PendingMcpElicitationFormParams | PendingMcpElicitationUrlParams;
}

export function approvalActionKind(action: ApprovalAction): "accept" | "accept-session" | "decline" | "cancel" {
  if (!isCommandDecisionAction(action)) return action;
  const decision = action.decision;
  if (typeof decision === "string") return simpleApprovalActionKind(decision);
  if ("acceptWithExecpolicyAmendment" in decision) return "accept-session";
  if ("applyNetworkPolicyAmendment" in decision) {
    return decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow" ? "accept-session" : "decline";
  }
  return "decline";
}

function simpleApprovalActionKind(decision: string): "accept" | "accept-session" | "decline" | "cancel" {
  if (decision === "accept") return "accept";
  if (decision === "acceptForSession") return "accept-session";
  if (decision === "cancel") return "cancel";
  return "decline";
}

function isCommandDecisionAction(action: ApprovalAction): action is CommandApprovalDecisionAction {
  return typeof action === "object";
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

export function approvalDetailsDisclosureId(requestId: PendingRequestId): string {
  return pendingRequestDerivedKey(requestId, "details");
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
