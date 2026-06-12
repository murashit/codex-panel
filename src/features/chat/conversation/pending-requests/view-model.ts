import type { RequestId } from "../../../../app-server/connection/rpc-messages";
import {
  approvalActionOptions,
  approvalDetails,
  approvalSummary,
  approvalTitle,
  type ApprovalAction,
  type PendingApproval,
} from "../../protocol/server-requests/approval";
import {
  questionDefaultAnswer,
  userInputDraftKey,
  userInputOtherDraftKey,
  type PendingUserInput,
} from "../../protocol/server-requests/user-input";

export type PendingRequestId = RequestId;
type PendingRequestApprovalAction = ApprovalAction;

interface PendingRequestApprovalOption {
  label: string;
  className: string;
  action: PendingRequestApprovalAction;
}

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

export interface PendingRequestBlockActions {
  resolveApproval: (requestId: PendingRequestId, action: PendingRequestApprovalAction) => void;
  resolveUserInput: (requestId: PendingRequestId) => void;
  cancelUserInput: (requestId: PendingRequestId) => void;
  setOpenDetail?: (key: string, open: boolean) => void;
  setUserInputDraft: (key: string, value: string) => void;
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
