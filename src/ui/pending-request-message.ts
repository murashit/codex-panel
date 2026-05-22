import {
  approvalActionOptions,
  approvalDetails,
  approvalSummary,
  approvalTitle,
  type ApprovalAction,
  type PendingApproval,
} from "../approvals/model";
import type { RequestId } from "../generated/app-server/RequestId";
import type { PendingUserInput } from "../user-input/model";
import { questionDefaultAnswer } from "../user-input/model";
import { createMetaPair, createRememberedDetails } from "./components";
import { createWorkMessage } from "./work-message";

export interface PendingRequestMessageActions {
  resolveApproval: (approval: PendingApproval, action: ApprovalAction) => void;
  resolveUserInput: (input: PendingUserInput) => void;
  cancelUserInput: (input: PendingUserInput) => void;
}

export interface PendingRequestMessageDrafts {
  values: Map<string, string>;
  draftKey: (requestId: RequestId, questionId: string) => string;
  otherDraftKey: (requestId: RequestId, questionId: string) => string;
}

export function renderPendingRequestMessage(
  parent: HTMLElement,
  approvals: PendingApproval[],
  pendingUserInputs: PendingUserInput[],
  drafts: PendingRequestMessageDrafts,
  openDetails: Set<string>,
  actions: PendingRequestMessageActions,
): void {
  parent.empty();
  if (approvals.length === 0 && pendingUserInputs.length === 0) return;

  const message = createWorkMessage(parent, {
    label: "Request",
    className: "codex-panel__pending-request-message",
    tone: "warning",
  });
  for (const approval of approvals) {
    renderApprovalCard(message, approval, openDetails, actions);
  }
  for (const input of pendingUserInputs) {
    renderUserInputCard(message, input, drafts, actions);
  }
}

function renderApprovalCard(
  parent: HTMLElement,
  approval: PendingApproval,
  openDetails: Set<string>,
  actions: PendingRequestMessageActions,
): void {
  const { info, controls } = createPendingRequestCard(parent, "codex-panel__approval");
  info.createDiv({ cls: "setting-item-name codex-panel__pending-request-title", text: approvalTitle(approval) });
  info.createDiv({ cls: "setting-item-description codex-panel__pending-request-body", text: approvalSummary(approval) });
  renderApprovalDetails(info, approval, openDetails);

  for (const option of approvalActionOptions(approval)) {
    createActionButton(controls, option.label, option.className, () => {
      actions.resolveApproval(approval, option.action);
    });
  }
}

function renderApprovalDetails(parent: HTMLElement, approval: PendingApproval, openDetails: Set<string>): void {
  const details = createRememberedDetails(
    parent,
    openDetails,
    `approval:${String(approval.requestId)}:details`,
    "codex-panel__approval-details",
    "Request details",
  );
  const rows = details.createEl("dl", { cls: "codex-panel__meta-grid" });
  for (const row of approvalDetails(approval)) {
    createMetaPair(rows, row.key, row.value);
  }
}

function renderUserInputCard(
  parent: HTMLElement,
  input: PendingUserInput,
  drafts: PendingRequestMessageDrafts,
  actions: PendingRequestMessageActions,
): void {
  const { info, controls } = createPendingRequestCard(parent, "codex-panel__user-input");
  info.createDiv({ cls: "setting-item-name codex-panel__pending-request-title", text: "Codex needs input" });
  info.createDiv({
    cls: "setting-item-description codex-panel__pending-request-body",
    text: `Answer ${String(input.params.questions.length)} Plan mode question${input.params.questions.length === 1 ? "" : "s"} to continue.`,
  });
  renderUserInputQuestions(info, input, drafts);

  createActionButton(controls, "Submit", "mod-cta", () => {
    actions.resolveUserInput(input);
  });
  createActionButton(controls, "Cancel", "", () => {
    actions.cancelUserInput(input);
  });
}

function createPendingRequestCard(parent: HTMLElement, className: string): { info: HTMLElement; controls: HTMLElement } {
  const card = parent.createDiv({ cls: `setting-item codex-panel__pending-request-card ${className}` });
  const info = card.createDiv({ cls: "setting-item-info codex-panel__pending-request-info" });
  const controls = card.createDiv({ cls: "setting-item-control codex-panel__pending-request-actions" });
  return { info, controls };
}

function renderUserInputQuestions(parent: HTMLElement, input: PendingUserInput, drafts: PendingRequestMessageDrafts): void {
  for (const question of input.params.questions) {
    const questionEl = parent.createDiv({ cls: "codex-panel__user-input-question" });
    if (question.header) questionEl.createDiv({ cls: "codex-panel__user-input-header", text: question.header });
    questionEl.createDiv({ cls: "codex-panel__user-input-prompt", text: question.question });
    const draftKey = drafts.draftKey(input.requestId, question.id);
    const current = drafts.values.get(draftKey) ?? questionDefaultAnswer(question);
    if (!drafts.values.has(draftKey)) drafts.values.set(draftKey, current);
    const answerEl = questionEl.createDiv({ cls: "codex-panel__user-input-answer" });

    if (question.options && question.options.length > 0) {
      const groupName = `codex-panel-${String(input.requestId)}-${question.id}`;
      for (const option of question.options) {
        const label = answerEl.createEl("label", { cls: "codex-panel__user-input-option" });
        const radio = label.createEl("input", {
          cls: "codex-panel__user-input-radio",
          attr: { type: "radio", name: groupName, value: option.label },
        });
        radio.checked = current === option.label;
        radio.onchange = () => {
          if (radio.checked) drafts.values.set(draftKey, option.label);
        };
        label.createSpan({ cls: "codex-panel__user-input-option-label", text: option.label });
        if (option.description) label.createSpan({ cls: "codex-panel__user-input-option-description", text: option.description });
      }
      if (question.isOther) renderOtherUserInputOption(answerEl, input, question.id, groupName, current, drafts);
    } else {
      renderFreeformUserInput(answerEl, input, question.id, question.isSecret, current, drafts);
    }
  }
}

function renderOtherUserInputOption(
  parent: HTMLElement,
  input: PendingUserInput,
  questionId: string,
  groupName: string,
  current: string,
  drafts: PendingRequestMessageDrafts,
): void {
  const draftKey = drafts.draftKey(input.requestId, questionId);
  const otherKey = drafts.otherDraftKey(input.requestId, questionId);
  const otherValue = drafts.values.get(otherKey) ?? "";
  const label = parent.createEl("label", { cls: "codex-panel__user-input-option" });
  const radio = label.createEl("input", {
    cls: "codex-panel__user-input-radio",
    attr: { type: "radio", name: groupName, value: "__other__" },
  });
  radio.checked = current === otherValue && otherValue.length > 0;
  radio.onchange = () => {
    if (radio.checked) drafts.values.set(draftKey, drafts.values.get(otherKey) ?? "");
  };
  label.createSpan({ cls: "codex-panel__user-input-option-label", text: "Other" });
  const inputEl = label.createEl("input", {
    cls: "codex-panel__user-input-text codex-panel__user-input-other-text",
    attr: { type: "text", value: otherValue, placeholder: "Other answer" },
  });
  inputEl.oninput = () => {
    drafts.values.set(otherKey, inputEl.value);
    radio.checked = true;
    drafts.values.set(draftKey, inputEl.value);
  };
}

function renderFreeformUserInput(
  parent: HTMLElement,
  input: PendingUserInput,
  questionId: string,
  isSecret: boolean,
  current: string,
  drafts: PendingRequestMessageDrafts,
): void {
  const draftKey = drafts.draftKey(input.requestId, questionId);
  const inputEl = parent.createEl("input", {
    cls: "codex-panel__user-input-text",
    attr: { type: isSecret ? "password" : "text", value: current },
  });
  inputEl.oninput = () => drafts.values.set(draftKey, inputEl.value);
}

function createActionButton(parent: HTMLElement, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: `codex-panel__pending-request-button ${className}`.trim(),
    text: label,
    attr: { type: "button" },
  });
  button.onclick = onClick;
  return button;
}
