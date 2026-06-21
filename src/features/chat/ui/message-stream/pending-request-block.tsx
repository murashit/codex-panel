import type { ComponentChild as UiNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { approvalDetailsDisclosureId } from "../../../../domain/pending-requests/model";
import {
  type PendingApprovalViewModel,
  type PendingMcpElicitationFieldViewModel,
  type PendingMcpElicitationViewModel,
  type PendingUserInputQuestionViewModel,
  type PendingUserInputViewModel,
} from "../../presentation/pending-requests/view-model";
import type { PendingRequestBlockActions } from "./context";
import { createStatusMessageClassName } from "./status";

export function pendingRequestBlockNode(
  approvals: readonly PendingApprovalViewModel[],
  pendingUserInputs: readonly PendingUserInputViewModel[],
  pendingMcpElicitations: readonly PendingMcpElicitationViewModel[],
  userInputDrafts: ReadonlyMap<string, string>,
  mcpElicitationDrafts: ReadonlyMap<string, string>,
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
      pendingMcpElicitations={pendingMcpElicitations}
      userInputDrafts={userInputDrafts}
      mcpElicitationDrafts={mcpElicitationDrafts}
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
  pendingMcpElicitations,
  userInputDrafts,
  mcpElicitationDrafts,
  approvalDetails,
  actions,
  autoFocusRequested,
  consumeAutoFocus,
  autoFocusSignature,
}: {
  approvals: readonly PendingApprovalViewModel[];
  pendingUserInputs: readonly PendingUserInputViewModel[];
  pendingMcpElicitations: readonly PendingMcpElicitationViewModel[];
  userInputDrafts: ReadonlyMap<string, string>;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
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
  if (approvals.length === 0 && pendingUserInputs.length === 0 && pendingMcpElicitations.length === 0) return null;
  return (
    <div ref={requestRef} className={createStatusMessageClassName("codex-panel__pending-request-block", "warning")}>
      <div className="codex-panel__message-role">Request</div>
      {approvals.map((approval) => (
        <ApprovalCard key={String(approval.requestId)} approval={approval} approvalDetails={approvalDetails} actions={actions} />
      ))}
      {pendingUserInputs.map((input) => (
        <UserInputCard key={String(input.requestId)} input={input} userInputDrafts={userInputDrafts} actions={actions} />
      ))}
      {pendingMcpElicitations.map((elicitation) => (
        <McpElicitationCard
          key={String(elicitation.requestId)}
          elicitation={elicitation}
          mcpElicitationDrafts={mcpElicitationDrafts}
          actions={actions}
        />
      ))}
    </div>
  );
}

function focusPendingRequestControl(container: HTMLElement | null): void {
  if (!container) return;
  for (const selector of [
    ".codex-panel__user-input-radio:checked",
    ".codex-panel__user-input-text",
    ".codex-panel__mcp-elicitation-input",
    ".codex-panel__mcp-elicitation-checkbox",
    ".codex-panel__mcp-elicitation-radio:checked",
    ".codex-panel__mcp-elicitation-radio",
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

function McpElicitationCard({
  elicitation,
  mcpElicitationDrafts,
  actions,
}: {
  elicitation: PendingMcpElicitationViewModel;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
}): UiNode {
  const formRef = useRef<HTMLFormElement | null>(null);
  const accept = () => {
    if (elicitation.mode === "form" && !validateMcpElicitationForm(formRef.current, elicitation, mcpElicitationDrafts)) return;
    actions.resolveMcpElicitation(elicitation.requestId, "accept");
  };
  return (
    <PendingRequestCard className="codex-panel__mcp-elicitation">
      <div className="codex-panel__pending-request-info">
        <div className="codex-panel__pending-request-title">{elicitation.title}</div>
        <div className="codex-panel__pending-request-body">{elicitation.body}</div>
        {elicitation.mode === "url" && elicitation.url ? (
          <a className="codex-panel__mcp-elicitation-url" href={elicitation.url} target="_blank" rel="noreferrer">
            {elicitation.url}
          </a>
        ) : (
          <form
            ref={formRef}
            className="codex-panel__mcp-elicitation-form"
            onSubmit={(event) => {
              event.preventDefault();
              accept();
            }}
          >
            <McpElicitationFields fields={elicitation.fields} drafts={mcpElicitationDrafts} actions={actions} />
          </form>
        )}
      </div>
      <div className="codex-panel__pending-request-actions">
        <ActionButton label="Accept" className="mod-cta" onClick={accept} />
        <ActionButton
          label="Decline"
          className=""
          onClick={() => {
            actions.resolveMcpElicitation(elicitation.requestId, "decline");
          }}
        />
        <ActionButton
          label="Cancel"
          className=""
          onClick={() => {
            actions.resolveMcpElicitation(elicitation.requestId, "cancel");
          }}
        />
      </div>
    </PendingRequestCard>
  );
}

function validateMcpElicitationForm(
  form: HTMLFormElement | null,
  elicitation: PendingMcpElicitationViewModel,
  drafts: ReadonlyMap<string, string>,
): boolean {
  if (!form) return true;
  clearMcpElicitationCustomValidity(form);
  for (const field of elicitation.fields) {
    if (field.type !== "multi-select") continue;
    const selectedCount = selectedMcpElicitationValues(drafts.get(field.draftKey) ?? field.defaultDraft).size;
    const message = mcpElicitationMultiSelectValidationMessage(field, selectedCount);
    if (!message) continue;
    const input = Array.from(form.querySelectorAll<HTMLInputElement>("input[data-mcp-elicitation-field]")).find(
      (candidate) => candidate.dataset["mcpElicitationField"] === field.id,
    );
    input?.setCustomValidity(message);
  }
  return form.reportValidity();
}

function clearMcpElicitationCustomValidity(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLInputElement>(".codex-panel__mcp-elicitation-checkbox").forEach((input) => {
    input.setCustomValidity("");
  });
}

function mcpElicitationMultiSelectValidationMessage(field: PendingMcpElicitationFieldViewModel, selectedCount: number): string | null {
  if (typeof field.minItems === "number" && selectedCount < field.minItems) {
    return `Select at least ${String(field.minItems)} option${field.minItems === 1 ? "" : "s"}.`;
  }
  if (typeof field.maxItems === "number" && selectedCount > field.maxItems) {
    return `Select no more than ${String(field.maxItems)} option${field.maxItems === 1 ? "" : "s"}.`;
  }
  return null;
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
            key={option.id}
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
  const detailId = approvalDetailsDisclosureId(approval.requestId);
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
                    const groupName = userInputRadioGroupName(input.requestId, question.id);
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
                      groupName={userInputRadioGroupName(input.requestId, question.id)}
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

function McpElicitationFields({
  fields,
  drafts,
  actions,
}: {
  fields: readonly PendingMcpElicitationFieldViewModel[];
  drafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
}): UiNode {
  return (
    <div className="codex-panel__mcp-elicitation-fields">
      {fields.map((field) => (
        <McpElicitationField key={field.id} field={field} drafts={drafts} actions={actions} />
      ))}
    </div>
  );
}

function McpElicitationField({
  field,
  drafts,
  actions,
}: {
  field: PendingMcpElicitationFieldViewModel;
  drafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
}): UiNode {
  const current = drafts.get(field.draftKey) ?? field.defaultDraft;
  return (
    <div className="codex-panel__mcp-elicitation-field">
      <label className="codex-panel__mcp-elicitation-label">
        <span>{field.title}</span>
        {field.required ? <span className="codex-panel__mcp-elicitation-required">Required</span> : null}
      </label>
      {field.description ? <div className="codex-panel__mcp-elicitation-description">{field.description}</div> : null}
      <McpElicitationFieldControl field={field} current={current} actions={actions} />
    </div>
  );
}

function McpElicitationFieldControl({
  field,
  current,
  actions,
}: {
  field: PendingMcpElicitationFieldViewModel;
  current: string;
  actions: PendingRequestBlockActions;
}): UiNode {
  switch (field.type) {
    case "boolean":
      return (
        <label className="codex-panel__mcp-elicitation-option">
          <input
            className="codex-panel__mcp-elicitation-checkbox"
            type="checkbox"
            checked={current === "true"}
            onChange={(event) => {
              actions.setMcpElicitationDraft(field.draftKey, event.currentTarget.checked ? "true" : "false");
            }}
          />
          <span>Enabled</span>
        </label>
      );
    case "single-select":
      return (
        <div className="codex-panel__mcp-elicitation-options">
          {field.options?.map((option) => (
            <label key={option.value} className="codex-panel__mcp-elicitation-option">
              <input
                className="codex-panel__mcp-elicitation-radio"
                type="radio"
                name={`codex-panel-mcp-${field.draftKey}`}
                value={option.value}
                required={field.required}
                checked={current === option.value}
                onChange={(event) => {
                  if (event.currentTarget.checked) actions.setMcpElicitationDraft(field.draftKey, option.value);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      );
    case "multi-select":
      return (
        <div className="codex-panel__mcp-elicitation-options">
          {field.options?.map((option) => {
            const selected = selectedMcpElicitationValues(current);
            return (
              <label key={option.value} className="codex-panel__mcp-elicitation-option">
                <input
                  className="codex-panel__mcp-elicitation-checkbox"
                  type="checkbox"
                  value={option.value}
                  data-mcp-elicitation-field={field.id}
                  checked={selected.has(option.value)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.currentTarget.checked) {
                      next.add(option.value);
                    } else {
                      next.delete(option.value);
                    }
                    actions.setMcpElicitationDraft(field.draftKey, JSON.stringify([...next]));
                  }}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      );
    case "number":
    case "integer":
      return (
        <input
          className="codex-panel__mcp-elicitation-input"
          type="number"
          step={field.type === "integer" ? "1" : "any"}
          min={field.minimum ?? undefined}
          max={field.maximum ?? undefined}
          required={field.required}
          value={current}
          onInput={(event) => {
            actions.setMcpElicitationDraft(field.draftKey, event.currentTarget.value);
          }}
        />
      );
    default:
      return (
        <input
          className="codex-panel__mcp-elicitation-input"
          type={field.format === "email" ? "email" : field.format === "uri" ? "url" : field.format === "date" ? "date" : "text"}
          minLength={field.minLength ?? undefined}
          maxLength={field.maxLength ?? undefined}
          required={field.required}
          value={current}
          onInput={(event) => {
            actions.setMcpElicitationDraft(field.draftKey, event.currentTarget.value);
          }}
        />
      );
  }
}

function selectedMcpElicitationValues(draft: string): Set<string> {
  try {
    const values = JSON.parse(draft) as unknown;
    if (Array.isArray(values)) return new Set(values.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
  return new Set();
}

function userInputRadioGroupName(requestId: PendingUserInputViewModel["requestId"], questionId: string): string {
  return `codex-panel-${String(requestId)}-${questionId}`;
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
