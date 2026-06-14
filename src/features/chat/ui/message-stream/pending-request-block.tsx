import type { ComponentChild as UiNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import {
  type PendingApprovalViewModel,
  type PendingUserInputQuestionViewModel,
  type PendingUserInputViewModel,
} from "../../presentation/pending-requests/view-model";
import type { PendingRequestBlockActions } from "./context";
import { createWorkMessageClassName } from "./work-message";

export function pendingRequestBlockNode(
  approvals: readonly PendingApprovalViewModel[],
  pendingUserInputs: readonly PendingUserInputViewModel[],
  userInputDrafts: ReadonlyMap<string, string>,
  approvalDetails: ReadonlySet<string>,
  actions: PendingRequestBlockActions,
  autoFocusRequested = false,
  consumeAutoFocus?: () => boolean,
  autoFocusSignature = "",
): UiNode {
  return (
    <PendingRequestBlock
      approvals={approvals}
      pendingUserInputs={pendingUserInputs}
      userInputDrafts={userInputDrafts}
      approvalDetails={approvalDetails}
      actions={actions}
      autoFocusRequested={autoFocusRequested}
      consumeAutoFocus={consumeAutoFocus}
      autoFocusSignature={autoFocusSignature}
    />
  );
}

function PendingRequestBlock({
  approvals,
  pendingUserInputs,
  userInputDrafts,
  approvalDetails,
  actions,
  autoFocusRequested,
  consumeAutoFocus,
  autoFocusSignature,
}: {
  approvals: readonly PendingApprovalViewModel[];
  pendingUserInputs: readonly PendingUserInputViewModel[];
  userInputDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
  actions: PendingRequestBlockActions;
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
    <div ref={requestRef} className={createWorkMessageClassName("codex-panel__pending-request-block", "warning")}>
      <div className="codex-panel__message-role">Request</div>
      {approvals.map((approval) => (
        <ApprovalCard key={String(approval.requestId)} approval={approval} approvalDetails={approvalDetails} actions={actions} />
      ))}
      {pendingUserInputs.map((input) => (
        <UserInputCard key={String(input.requestId)} input={input} userInputDrafts={userInputDrafts} actions={actions} />
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
  approvalDetails,
  actions,
}: {
  approval: PendingApprovalViewModel;
  approvalDetails: ReadonlySet<string>;
  actions: PendingRequestBlockActions;
}): UiNode {
  return (
    <PendingRequestCard className="codex-panel__approval">
      <div className="codex-panel__pending-request-info">
        <div className="codex-panel__pending-request-title">{approval.title}</div>
        <div className="codex-panel__pending-request-body">{approval.summary}</div>
        <ApprovalDetails approval={approval} approvalDetails={approvalDetails} actions={actions} />
      </div>
      <div className="codex-panel__pending-request-actions">
        {approval.actions.map((option) => (
          <ActionButton
            key={option.label}
            label={option.label}
            className={option.className}
            onClick={() => {
              actions.resolveApproval(approval.requestId, option.action);
            }}
          />
        ))}
      </div>
    </PendingRequestCard>
  );
}

function ApprovalDetails({
  approval,
  approvalDetails,
  actions,
}: {
  approval: PendingApprovalViewModel;
  approvalDetails: ReadonlySet<string>;
  actions: PendingRequestBlockActions;
}): UiNode {
  const detailId = `${String(approval.requestId)}:details`;
  return (
    <details
      className="codex-panel__approval-details"
      open={approvalDetails.has(detailId)}
      onToggle={(event) => {
        actions.setApprovalDetailsExpanded?.(approval.requestId, event.currentTarget.open);
      }}
    >
      <summary tabIndex={-1}>Request details</summary>
      <dl className="codex-panel__meta-grid">
        {approval.details.map((row) => (
          <MetaPair key={`${row.key}:${row.value}`} name={row.key} value={row.value} />
        ))}
      </dl>
    </details>
  );
}

function UserInputCard({
  input,
  userInputDrafts,
  actions,
}: {
  input: PendingUserInputViewModel;
  userInputDrafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
}): UiNode {
  return (
    <PendingRequestCard className="codex-panel__user-input">
      <div className="codex-panel__pending-request-info">
        <div className="codex-panel__pending-request-title">{input.title}</div>
        <div className="codex-panel__pending-request-body">{input.body}</div>
        <UserInputQuestions input={input} userInputDrafts={userInputDrafts} actions={actions} />
      </div>
      <div className="codex-panel__pending-request-actions">
        <ActionButton
          label="Submit"
          className="mod-cta"
          onClick={() => {
            actions.resolveUserInput(input.requestId);
          }}
        />
        <ActionButton
          label="Cancel"
          className=""
          onClick={() => {
            actions.cancelUserInput(input.requestId);
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
  userInputDrafts,
  actions,
}: {
  input: PendingUserInputViewModel;
  userInputDrafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
}): UiNode {
  return (
    <>
      {input.questions.map((question) => {
        const current = userInputDrafts.get(question.draftKey) ?? question.defaultAnswer;
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
                            if (event.currentTarget.checked) actions.setUserInputDraft(question.draftKey, option.label);
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
                      groupName={`codex-panel-${String(input.requestId)}-${question.id}`}
                      current={current}
                      optionLabels={new Set(question.options.map((option) => option.label))}
                      question={question}
                      userInputDrafts={userInputDrafts}
                      actions={actions}
                    />
                  ) : null}
                </>
              ) : (
                <FreeformUserInput isSecret={question.isSecret} current={current} question={question} actions={actions} />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function OtherUserInputOption({
  groupName,
  current,
  optionLabels,
  question,
  userInputDrafts,
  actions,
}: {
  groupName: string;
  current: string;
  optionLabels: ReadonlySet<string>;
  question: PendingUserInputQuestionViewModel;
  userInputDrafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
}): UiNode {
  const draftKey = question.draftKey;
  const otherKey = question.otherDraftKey;
  const otherValue = userInputDrafts.get(otherKey) ?? "";
  const [inputValue, setInputValue] = useState(otherValue);
  const composingRef = useRef(false);
  const otherSelected = userInputDrafts.has(draftKey) && current === otherValue && !optionLabels.has(current);
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
  isSecret,
  current,
  question,
  actions,
}: {
  isSecret: boolean;
  current: string;
  question: PendingUserInputQuestionViewModel;
  actions: PendingRequestBlockActions;
}): UiNode {
  return (
    <input
      className="codex-panel__user-input-text"
      type={isSecret ? "password" : "text"}
      value={current}
      onInput={(event) => {
        actions.setUserInputDraft(question.draftKey, event.currentTarget.value);
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
