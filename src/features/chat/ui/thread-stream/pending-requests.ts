import { type McpServerRegistration, mcpServerRegistrationLabel } from "../../../../domain/runtime/tool-inventory";
import { defaultPendingApprovalOptions } from "../../domain/pending-requests/drafts";
import { contentForPendingMcpElicitation, type McpElicitationFieldIssue } from "../../domain/pending-requests/mcp-elicitation";
import {
  type ApprovalAction,
  approvalActionKind,
  type PendingApproval,
  type PendingMcpElicitation,
  type PendingUserInput,
} from "../../domain/pending-requests/model";
import { pendingRequestFocusSignature } from "../../domain/pending-requests/signatures";
import type { PendingApprovalViewModel, PendingMcpElicitationViewModel, PendingRequestBlockSnapshot } from "./model";

type ApprovalActionOption = PendingApprovalViewModel["actions"][number];

interface PendingRequestBlockSnapshotSource {
  registrations?: readonly McpServerRegistration[] | null;
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  pendingMcpElicitations: readonly PendingMcpElicitation[];
  approvalDetails: ReadonlySet<string>;
}

export interface PendingRequestBlockProjection {
  readonly signature: string;
  readonly snapshot: PendingRequestBlockSnapshot;
}

export function projectPendingRequestBlock(source: PendingRequestBlockSnapshotSource): PendingRequestBlockProjection | null {
  const signature = pendingRequestFocusSignature(source.approvals, source.pendingUserInputs, source.pendingMcpElicitations);
  return signature ? { signature, snapshot: pendingRequestBlockSnapshotFromState(source) } : null;
}

export function pendingRequestBlockSnapshotFromState(source: PendingRequestBlockSnapshotSource): PendingRequestBlockSnapshot {
  return {
    approvals: source.approvals.map(pendingApprovalViewModel),
    pendingUserInputs: source.pendingUserInputs,
    pendingMcpElicitations: source.pendingMcpElicitations.map((item) => pendingMcpElicitationViewModel(item, source.registrations)),
    approvalDetails: source.approvalDetails,
  };
}

function pendingApprovalViewModel(approval: PendingApproval): PendingApprovalViewModel {
  return {
    requestId: approval.requestId,
    title: approval.title,
    requiresHumanApproval: approval.kind === "humanCommand",
    summary: approval.summary,
    details: [...approval.details],
    actions: approvalActionOptions(approval),
  };
}

function approvalActionOptions(approval: PendingApproval): ApprovalActionOption[] {
  const options = approval.actionOptions ?? defaultPendingApprovalOptions();
  return options.map(approvalActionOptionViewModel);
}

function approvalActionOptionViewModel(option: { id: string; label: string; action: ApprovalAction }): ApprovalActionOption {
  return {
    id: option.id,
    label: option.label,
    action: option.action,
    className: approvalActionClassName(option.action),
  };
}

function approvalActionClassName(action: ApprovalAction): string {
  const kind = approvalActionKind(action);
  if (kind === "accept") return "mod-cta";
  if (kind === "decline" || kind === "decline-rule") return "mod-warning";
  return "";
}

function pendingMcpElicitationViewModel(
  elicitation: PendingMcpElicitation,
  registrations: PendingRequestBlockSnapshotSource["registrations"],
): PendingMcpElicitationViewModel {
  const { serverName, environmentId } = elicitation.params;
  const scopes = new Set(registrations?.filter((server) => server.name === serverName).map((server) => server.environmentId));
  const label = scopes.size > 1 && scopes.has(environmentId) ? mcpServerRegistrationLabel({ name: serverName, environmentId }) : serverName;
  const title = `MCP request from ${label}`;
  if (elicitation.params.mode === "url") {
    return {
      requestId: elicitation.requestId,
      title,
      body: elicitation.params.message,
      mode: "url",
      fields: [],
      url: elicitation.params.url,
    };
  }
  const result = contentForPendingMcpElicitation(elicitation);
  return {
    requestId: elicitation.requestId,
    title,
    body: elicitation.params.message,
    mode: "form",
    fields: elicitation.params.fields.map((field) => {
      const base = {
        id: field.id,
        title: field.title,
        description: field.description,
        required: field.required,
        validationMessage: mcpElicitationValidationMessage(result.valid ? undefined : result.issues.get(field.id)),
      };
      switch (field.type) {
        case "single-select":
          return { ...base, type: field.type, value: field.value, options: field.options };
        case "multi-select":
          return { ...base, type: field.type, value: field.value, options: field.options };
        case "boolean":
          return { ...base, type: field.type, value: field.value };
        default:
          return { ...base, type: field.type, value: field.value };
      }
    }),
    url: null,
  };
}

function mcpElicitationValidationMessage(issue: McpElicitationFieldIssue | undefined): string {
  if (!issue) return "";
  switch (issue.kind) {
    case "required":
      return "Enter a value.";
    case "number":
      return "Enter a finite number.";
    case "integer":
      return "Enter a whole number.";
    case "selection":
      return "Choose from the available options.";
    case "minLength":
      return `Enter at least ${String(issue.limit)} character${issue.limit === 1 ? "" : "s"}.`;
    case "maxLength":
      return `Enter no more than ${String(issue.limit)} character${issue.limit === 1 ? "" : "s"}.`;
    case "minimum":
      return `Enter a value of at least ${String(issue.limit)}.`;
    case "maximum":
      return `Enter a value no greater than ${String(issue.limit)}.`;
    case "minItems":
      return `Select at least ${String(issue.limit)} option${issue.limit === 1n ? "" : "s"}.`;
    case "maxItems":
      return `Select no more than ${String(issue.limit)} option${issue.limit === 1n ? "" : "s"}.`;
  }
}
