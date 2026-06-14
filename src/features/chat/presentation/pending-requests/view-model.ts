import { approvalDetails, approvalSummary, approvalTitle } from "../../domain/pending-requests/approval";
import { approvalActionOptions, type ApprovalActionOption } from "./approval-view";
import {
  type PendingApproval,
  type PendingRequestId as DomainPendingRequestId,
  type PendingUserInput,
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
