import {
  defaultPendingApprovalOptions,
  mcpElicitationDraftKey,
  mcpElicitationFieldDefaultDraft,
  questionDefaultAnswer,
  userInputDraftKey,
  userInputOtherDraftKey,
} from "../../domain/pending-requests/drafts";
import {
  type ApprovalAction,
  approvalActionKind,
  type PendingApproval,
  type PendingMcpElicitation,
  type PendingUserInput,
} from "../../domain/pending-requests/model";
import { pendingRequestFocusSignature } from "../../domain/pending-requests/signatures";
import type {
  PendingApprovalViewModel,
  PendingMcpElicitationViewModel,
  PendingRequestBlockSnapshot,
  PendingUserInputViewModel,
} from "./model";

type ApprovalActionOption = PendingApprovalViewModel["actions"][number];

interface PendingRequestBlockSnapshotSource {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  pendingMcpElicitations: readonly PendingMcpElicitation[];
  userInputDrafts: ReadonlyMap<string, string>;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
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
    pendingUserInputs: source.pendingUserInputs.map(pendingUserInputViewModel),
    pendingMcpElicitations: source.pendingMcpElicitations.map(pendingMcpElicitationViewModel),
    userInputDrafts: source.userInputDrafts,
    mcpElicitationDrafts: source.mcpElicitationDrafts,
    approvalDetails: source.approvalDetails,
  };
}

function pendingApprovalViewModel(approval: PendingApproval): PendingApprovalViewModel {
  return {
    requestId: approval.requestId,
    title: approval.title,
    summary: approval.summary,
    details: [...approval.details],
    actions: approvalActionOptions(approval),
  };
}

function approvalActionOptions(approval: PendingApproval): ApprovalActionOption[] {
  const options = approval.actionOptions;
  return (options && options.length > 0 ? options : defaultPendingApprovalOptions()).map(approvalActionOptionViewModel);
}

function approvalActionOptionViewModel(option: { id: string; label: string; action: ApprovalAction }): ApprovalActionOption {
  return {
    id: option.id,
    label: option.label,
    action: option.action,
    className: approvalActionClassName(option.action),
  };
}

function pendingUserInputViewModel(input: PendingUserInput): PendingUserInputViewModel {
  return {
    requestId: input.requestId,
    title: "Codex needs input",
    body: `Answer ${String(input.params.questions.length)} question${input.params.questions.length === 1 ? "" : "s"} to continue.`,
    autoResolutionAtMs: input.autoResolutionAtMs,
    questions: input.params.questions.map((question) => ({
      id: question.id,
      header: question.header,
      question: question.question,
      isOther: question.isOther,
      isSecret: question.isSecret,
      defaultAnswer: questionDefaultAnswer(question),
      draftKey: userInputDraftKey(input.requestId, question.id),
      otherDraftKey: userInputOtherDraftKey(input.requestId, question.id),
      options: question.options,
    })),
  };
}

function approvalActionClassName(action: ApprovalAction): string {
  const kind = approvalActionKind(action);
  if (kind === "accept") return "mod-cta";
  if (kind === "decline") return "mod-warning";
  return "";
}

function pendingMcpElicitationViewModel(elicitation: PendingMcpElicitation): PendingMcpElicitationViewModel {
  const title = `MCP request from ${elicitation.params.serverName}`;
  if (elicitation.params.mode === "url") {
    return {
      requestId: elicitation.requestId,
      title,
      body: elicitation.params.message,
      mode: "url",
      serverName: elicitation.params.serverName,
      message: elicitation.params.message,
      fields: [],
      url: elicitation.params.url,
    };
  }
  return {
    requestId: elicitation.requestId,
    title,
    body: elicitation.params.message,
    mode: "form",
    serverName: elicitation.params.serverName,
    message: elicitation.params.message,
    fields: elicitation.params.fields.map((field) => ({
      id: field.id,
      title: field.title,
      description: field.description,
      type: field.type,
      required: field.required,
      defaultDraft: mcpElicitationFieldDefaultDraft(field),
      draftKey: mcpElicitationDraftKey(elicitation.requestId, field.id),
      options: "options" in field ? field.options : null,
    })),
    url: null,
  };
}
