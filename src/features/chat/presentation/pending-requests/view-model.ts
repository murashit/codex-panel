import { approvalDetails, approvalSummary, approvalTitle } from "../../domain/pending-requests/approval";
import { approvalActionOptions, type ApprovalActionOption } from "./approval-view";
import {
  type PendingApproval,
  type PendingMcpElicitation,
  type PendingMcpElicitationField,
  type PendingRequestId as DomainPendingRequestId,
  type PendingUserInput,
  mcpElicitationDraftKey,
  mcpElicitationFieldDefaultDraft,
  questionDefaultAnswer,
  userInputDraftKey,
  userInputOtherDraftKey,
} from "../../domain/pending-requests/model";

type PendingRequestId = DomainPendingRequestId;

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
  options: PendingUserInputOptionViewModel[] | null;
}

export interface PendingUserInputViewModel {
  requestId: PendingRequestId;
  title: string;
  body: string;
  questions: PendingUserInputQuestionViewModel[];
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

export function pendingApprovalViewModel(approval: PendingApproval): PendingApprovalViewModel {
  return {
    requestId: approval.requestId,
    title: approvalTitle(approval),
    summary: approvalSummary(approval),
    details: approvalDetails(approval),
    actions: approvalActionOptions(approval),
  };
}

export function pendingUserInputViewModel(input: PendingUserInput): PendingUserInputViewModel {
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

export function pendingMcpElicitationViewModel(elicitation: PendingMcpElicitation): PendingMcpElicitationViewModel {
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
