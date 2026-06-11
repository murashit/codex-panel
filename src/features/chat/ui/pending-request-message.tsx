import type { ComponentChild as UiNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import {
  approvalActionOptions,
  approvalDetails,
  approvalSummary,
  approvalTitle,
  type ApprovalAction,
  type PendingApproval,
} from "../protocol/requests/approval";
import type { PendingUserInput } from "../protocol/requests/user-input";
import { questionDefaultAnswer } from "../protocol/requests/user-input";
import { createWorkMessageClassName } from "./work-message";

type PendingUserInputRequestId = PendingUserInput["requestId"];

export interface PendingRequestMessageActions {
  resolveApproval: (approval: PendingApproval, action: ApprovalAction) => void;
  resolveUserInput: (input: PendingUserInput) => void;
  cancelUserInput: (input: PendingUserInput) => void;
  setOpenDetail?: (key: string, open: boolean) => void;
  setUserInputDraft: (key: string, value: string) => void;
}

export interface PendingRequestMessageDrafts {
  values: ReadonlyMap<string, string>;
  draftKey: (requestId: PendingUserInputRequestId, questionId: string) => string;
  otherDraftKey: (requestId: PendingUserInputRequestId, questionId: string) => string;
}

export function pendingRequestMessageNode(
  approvals: readonly PendingApproval[],
  pendingUserInputs: readonly PendingUserInput[],
  drafts: PendingRequestMessageDrafts,
  openDetails: ReadonlySet<string>,
  actions: PendingRequestMessageActions,
  autoFocusRequested = false,
  consumeAutoFocus?: () => boolean,
  autoFocusSignature = "",
): UiNode {
  return (
    <PendingRequestMessage
      approvals={approvals}
      pendingUserInputs={pendingUserInputs}
      drafts={drafts}
      openDetails={openDetails}
      actions={actions}
      autoFocusRequested={autoFocusRequested}
      consumeAutoFocus={consumeAutoFocus}
      autoFocusSignature={autoFocusSignature}
    />
  );
}

function PendingRequestMessage({
  approvals,
  pendingUserInputs,
  drafts,
  openDetails,
  actions,
  autoFocusRequested,
  consumeAutoFocus,
  autoFocusSignature,
}: {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  drafts: PendingRequestMessageDrafts;
  openDetails: ReadonlySet<string>;
  actions: PendingRequestMessageActions;
  autoFocusRequested: boolean;
  consumeAutoFocus: (() => boolean) | undefined;
  autoFocusSignature: string;
}): UiNode {
  const requestRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const autoFocusConsumed = consumeAutoFocus?.() ?? false;
    const shouldFocus = autoFocusRequested || autoFocusConsumed;
    if (!shouldFocus) return;
    focusPendingRequestControl(requestRef.current);
  }, [autoFocusRequested, consumeAutoFocus, autoFocusSignature]);
  if (approvals.length === 0 && pendingUserInputs.length === 0) return null;
  return (
    <div ref={requestRef} className={createWorkMessageClassName("codex-panel__pending-request-message", "warning")}>
      <div className="codex-panel__message-role">Request</div>
      {approvals.map((approval) => (
        <ApprovalCard key={String(approval.requestId)} approval={approval} openDetails={openDetails} actions={actions} />
      ))}
      {pendingUserInputs.map((input) => (
        <UserInputCard key={String(input.requestId)} input={input} drafts={drafts} actions={actions} />
      ))}
    </div>
  );
}

function focusPendingRequestControl(container: HTMLElement | null): void {
  if (!container) return;
  for (const selector of [
    ".codex-panel__user-input-radio:checked",
    ".codex-panel__user-input-text",
    ".codex-panel__user-input-radio",
    ".codex-panel__pending-request-button.mod-cta",
    ".codex-panel__pending-request-button",
  ]) {
    const target = container.querySelector<HTMLElement>(selector);
    if (!target) continue;
    target.focus({ preventScroll: true });
    return;
  }
}

function ApprovalCard({
  approval,
  openDetails,
  actions,
}: {
  approval: PendingApproval;
  openDetails: ReadonlySet<string>;
  actions: PendingRequestMessageActions;
}): UiNode {
  return (
    <PendingRequestCard className="codex-panel__approval">
      <div className="codex-panel__pending-request-info">
        <div className="codex-panel__pending-request-title">{approvalTitle(approval)}</div>
        <div className="codex-panel__pending-request-body">{approvalSummary(approval)}</div>
        <ApprovalDetails approval={approval} openDetails={openDetails} actions={actions} />
      </div>
      <div className="codex-panel__pending-request-actions">
        {approvalActionOptions(approval).map((option) => (
          <ActionButton
            key={option.label}
            label={option.label}
            className={option.className}
            onClick={() => {
              actions.resolveApproval(approval, option.action);
            }}
          />
        ))}
      </div>
    </PendingRequestCard>
  );
}

function ApprovalDetails({
  approval,
  openDetails,
  actions,
}: {
  approval: PendingApproval;
  openDetails: ReadonlySet<string>;
  actions: PendingRequestMessageActions;
}): UiNode {
  const key = `approval:${String(approval.requestId)}:details`;
  return (
    <details
      className="codex-panel__approval-details"
      open={openDetails.has(key)}
      onToggle={(event) => {
        actions.setOpenDetail?.(key, event.currentTarget.open);
      }}
    >
      <summary tabIndex={-1}>Request details</summary>
      <dl className="codex-panel__meta-grid">
        {approvalDetails(approval).map((row) => (
          <MetaPair key={`${row.key}:${row.value}`} name={row.key} value={row.value} />
        ))}
      </dl>
    </details>
  );
}

function UserInputCard({
  input,
  drafts,
  actions,
}: {
  input: PendingUserInput;
  drafts: PendingRequestMessageDrafts;
  actions: PendingRequestMessageActions;
}): UiNode {
  return (
    <PendingRequestCard className="codex-panel__user-input">
      <div className="codex-panel__pending-request-info">
        <div className="codex-panel__pending-request-title">Codex needs input</div>
        <div className="codex-panel__pending-request-body">
          Answer {String(input.params.questions.length)} Plan mode question{input.params.questions.length === 1 ? "" : "s"} to continue.
        </div>
        <UserInputQuestions input={input} drafts={drafts} actions={actions} />
      </div>
      <div className="codex-panel__pending-request-actions">
        <ActionButton
          label="Submit"
          className="mod-cta"
          onClick={() => {
            actions.resolveUserInput(input);
          }}
        />
        <ActionButton
          label="Cancel"
          className=""
          onClick={() => {
            actions.cancelUserInput(input);
          }}
        />
      </div>
    </PendingRequestCard>
  );
}

function PendingRequestCard({ className, children }: { className: string; children: UiNode }): UiNode {
  return <div className={`codex-panel__pending-request-card ${className}`}>{children}</div>;
}

function UserInputQuestions({
  input,
  drafts,
  actions,
}: {
  input: PendingUserInput;
  drafts: PendingRequestMessageDrafts;
  actions: PendingRequestMessageActions;
}): UiNode {
  return (
    <>
      {input.params.questions.map((question) => {
        const draftKey = drafts.draftKey(input.requestId, question.id);
        const current = drafts.values.get(draftKey) ?? questionDefaultAnswer(question);
        return (
          <div key={question.id} className="codex-panel__user-input-question">
            {question.header ? <div className="codex-panel__user-input-header">{question.header}</div> : null}
            <div className="codex-panel__user-input-prompt">{question.question}</div>
            <div className="codex-panel__user-input-answer">
              {question.options && question.options.length > 0 ? (
                <>
                  {question.options.map((option) => {
                    const groupName = `codex-panel-${String(input.requestId)}-${question.id}`;
                    return (
                      <label key={option.label} className="codex-panel__user-input-option">
                        <input
                          className="codex-panel__user-input-radio"
                          type="radio"
                          name={groupName}
                          value={option.label}
                          checked={current === option.label}
                          onChange={(event) => {
                            if (event.currentTarget.checked) actions.setUserInputDraft(draftKey, option.label);
                          }}
                        />
                        <span className="codex-panel__user-input-option-label">{option.label}</span>
                        {option.description ? (
                          <span className="codex-panel__user-input-option-description">{option.description}</span>
                        ) : null}
                      </label>
                    );
                  })}
                  {question.isOther ? (
                    <OtherUserInputOption
                      input={input}
                      questionId={question.id}
                      questionText={question.question}
                      groupName={`codex-panel-${String(input.requestId)}-${question.id}`}
                      current={current}
                      optionLabels={new Set(question.options.map((option) => option.label))}
                      drafts={drafts}
                      actions={actions}
                    />
                  ) : null}
                </>
              ) : (
                <FreeformUserInput
                  input={input}
                  questionId={question.id}
                  questionText={question.question}
                  isSecret={question.isSecret}
                  current={current}
                  drafts={drafts}
                  actions={actions}
                />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function OtherUserInputOption({
  input,
  questionId,
  questionText,
  groupName,
  current,
  optionLabels,
  drafts,
  actions,
}: {
  input: PendingUserInput;
  questionId: string;
  questionText: string;
  groupName: string;
  current: string;
  optionLabels: ReadonlySet<string>;
  drafts: PendingRequestMessageDrafts;
  actions: PendingRequestMessageActions;
}): UiNode {
  const draftKey = drafts.draftKey(input.requestId, questionId);
  const otherKey = drafts.otherDraftKey(input.requestId, questionId);
  const otherValue = drafts.values.get(otherKey) ?? "";
  const [inputValue, setInputValue] = useState(otherValue);
  const composingRef = useRef(false);
  const otherSelected = drafts.values.has(draftKey) && current === otherValue && !optionLabels.has(current);
  useEffect(() => {
    if (!composingRef.current) setInputValue(otherValue);
  }, [otherValue]);
  const selectOther = () => {
    actions.setUserInputDraft(draftKey, otherValue);
  };
  const commitOtherValue = (value: string) => {
    actions.setUserInputDraft(otherKey, value);
    actions.setUserInputDraft(draftKey, value);
  };
  const compositionProps = {
    oncompositionstart: () => {
      composingRef.current = true;
      selectOther();
    },
    oncompositionend: (event: Event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLInputElement)) return;
      composingRef.current = false;
      setInputValue(target.value);
      commitOtherValue(target.value);
    },
  };
  return (
    <label className="codex-panel__user-input-option">
      <input
        className="codex-panel__user-input-radio"
        type="radio"
        name={groupName}
        value="__other__"
        checked={otherSelected}
        onClick={(event) => {
          if (event.currentTarget.checked) selectOther();
        }}
        onChange={(event) => {
          if (event.currentTarget.checked) selectOther();
        }}
      />
      <span className="codex-panel__user-input-option-label">Other</span>
      <input
        className="codex-panel__user-input-text codex-panel__user-input-other-text"
        type="text"
        aria-label={`Other answer: ${questionText}`}
        value={inputValue}
        tabIndex={otherSelected ? 0 : -1}
        placeholder="Other answer"
        onFocus={selectOther}
        onInput={(event) => {
          setInputValue(event.currentTarget.value);
          const nativeEvent = event as Event & { isComposing?: boolean };
          if (nativeEvent.isComposing !== true && !composingRef.current) commitOtherValue(event.currentTarget.value);
        }}
        {...compositionProps}
      />
    </label>
  );
}

function FreeformUserInput({
  input,
  questionId,
  questionText,
  isSecret,
  current,
  drafts,
  actions,
}: {
  input: PendingUserInput;
  questionId: string;
  questionText: string;
  isSecret: boolean;
  current: string;
  drafts: PendingRequestMessageDrafts;
  actions: PendingRequestMessageActions;
}): UiNode {
  const draftKey = drafts.draftKey(input.requestId, questionId);
  return (
    <input
      className="codex-panel__user-input-text"
      type={isSecret ? "password" : "text"}
      aria-label={questionText}
      value={current}
      onInput={(event) => {
        actions.setUserInputDraft(draftKey, event.currentTarget.value);
      }}
    />
  );
}

function MetaPair({ name, value }: { name: string; value: string }): UiNode {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  );
}

function ActionButton({ label, className, onClick }: { label: string; className: string; onClick: () => void }): UiNode {
  return (
    <button className={`codex-panel__pending-request-button ${className}`.trim()} type="button" onClick={onClick}>
      {label}
    </button>
  );
}
