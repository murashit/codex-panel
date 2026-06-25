import {
  type ApprovalAction,
  approvalActionKind,
  type PendingRequestId as DomainPendingRequestId,
  defaultPendingApprovalOptions,
  mcpElicitationDraftKey,
  mcpElicitationFieldDefaultDraft,
  type PendingApproval,
  type PendingMcpElicitation,
  type PendingMcpElicitationField,
  type PendingUserInput,
  questionDefaultAnswer,
  userInputDraftKey,
  userInputOtherDraftKey,
} from "../../../../domain/pending-requests/model";

type PendingRequestId = DomainPendingRequestId;

interface ApprovalActionOption {
  id: string;
  label: string;
  action: ApprovalAction;
  className: string;
}

type PendingRequestApprovalOption = ApprovalActionOption;

interface PendingRequestDetailRow {
  key: string;
  value: string;
}

export interface PendingApprovalViewModel {
  requestId: PendingRequestId;
  title: string;
  summary: string;
  details: PendingRequestDetailRow[];
  actions: PendingRequestApprovalOption[];
}

interface PendingUserInputOptionViewModel {
  label: string;
  description?: string | null;
}

export interface PendingUserInputQuestionViewModel {
  id: string;
  header?: string | null;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  defaultAnswer: string;
  draftKey: string;
  otherDraftKey: string;
  options: readonly PendingUserInputOptionViewModel[] | null;
}

export interface PendingUserInputViewModel {
  requestId: PendingRequestId;
  title: string;
  body: string;
  questions: readonly PendingUserInputQuestionViewModel[];
}

interface PendingMcpElicitationOptionViewModel {
  value: string;
  label: string;
}

export interface PendingMcpElicitationFieldViewModel {
  id: string;
  title: string;
  description: string | null;
  type: PendingMcpElicitationField["type"];
  required: boolean;
  defaultDraft: string;
  draftKey: string;
  options: readonly PendingMcpElicitationOptionViewModel[] | null;
  format?: string | null;
  minimum?: number | null;
  maximum?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
  minItems?: number | null;
  maxItems?: number | null;
}

export interface PendingMcpElicitationViewModel {
  requestId: PendingRequestId;
  title: string;
  body: string;
  mode: "form" | "url";
  serverName: string;
  message: string;
  fields: readonly PendingMcpElicitationFieldViewModel[];
  url: string | null;
}

export interface PendingRequestBlockSnapshot {
  approvals: readonly PendingApprovalViewModel[];
  pendingUserInputs: readonly PendingUserInputViewModel[];
  pendingMcpElicitations: readonly PendingMcpElicitationViewModel[];
  userInputDrafts: ReadonlyMap<string, string>;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
}

interface PendingRequestBlockSnapshotSource {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  pendingMcpElicitations: readonly PendingMcpElicitation[];
  userInputDrafts: ReadonlyMap<string, string>;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
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
    body: `Answer ${String(input.params.questions.length)} Plan mode question${input.params.questions.length === 1 ? "" : "s"} to continue.`,
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
      ...mcpElicitationFieldConstraints(field),
    })),
    url: null,
  };
}

function mcpElicitationFieldConstraints(field: PendingMcpElicitationField): Partial<PendingMcpElicitationFieldViewModel> {
  switch (field.type) {
    case "string":
      return { format: field.format, minLength: field.minLength, maxLength: field.maxLength };
    case "number":
    case "integer":
      return { minimum: field.minimum, maximum: field.maximum };
    case "multi-select":
      return { minItems: field.minItems, maxItems: field.maxItems };
    default:
      return {};
  }
}
