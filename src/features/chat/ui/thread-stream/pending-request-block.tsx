import type { ComponentChild as UiNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { hasPendingRequests, pendingRequestCountsFromQueues } from "../../../../domain/pending-requests/aggregate";
import { approvalDetailsDisclosureId } from "../../domain/pending-requests/disclosure-ids";
import type { PendingRequestBlockActions } from "./context";
import type {
  PendingApprovalViewModel,
  PendingMcpElicitationFieldViewModel,
  PendingMcpElicitationViewModel,
  PendingRequestBlockSnapshot,
  PendingUserInputQuestionViewModel,
  PendingUserInputViewModel,
} from "./model";
import { focusPendingRequestControl } from "./pending-request-block.dom";
import { createStatusStreamItemClassName } from "./status";

export function pendingRequestBlockNode(input: {
  snapshot: PendingRequestBlockSnapshot;
  actions: PendingRequestBlockActions;
  consumeAutoFocus: () => boolean;
  autoFocusSignature: string;
  controlNamespace: string;
}): UiNode {
  const { snapshot, ...context } = input;
  return <PendingRequestBlock {...snapshot} {...context} />;
}

function PendingRequestBlock({
  approvals,
  pendingUserInputs,
  pendingMcpElicitations,
  userInputDrafts,
  mcpElicitationDrafts,
  approvalDetails,
  actions,
  consumeAutoFocus,
  autoFocusSignature,
  controlNamespace,
}: {
  approvals: readonly PendingApprovalViewModel[];
  pendingUserInputs: readonly PendingUserInputViewModel[];
  pendingMcpElicitations: readonly PendingMcpElicitationViewModel[];
  userInputDrafts: ReadonlyMap<string, string>;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
  actions: PendingRequestBlockActions;
  consumeAutoFocus: () => boolean;
  autoFocusSignature: string;
  controlNamespace: string;
}): UiNode {
  const requestRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!consumeAutoFocus()) return;
    focusPendingRequestControl(requestRef.current);
  }, [consumeAutoFocus, autoFocusSignature]);
  if (!hasPendingRequests(pendingRequestCountsFromQueues({ approvals, pendingUserInputs, pendingMcpElicitations }))) return null;
  return (
    <div ref={requestRef} className={createStatusStreamItemClassName("codex-panel__pending-request-block", "warning")}>
      <div className="codex-panel__stream-item-role">Codex request</div>
      {approvals.map((approval) => (
        <ApprovalCard key={String(approval.requestId)} approval={approval} approvalDetails={approvalDetails} actions={actions} />
      ))}
      {pendingUserInputs.map((input) => (
        <UserInputCard
          key={String(input.requestId)}
          input={input}
          userInputDrafts={userInputDrafts}
          actions={actions}
          controlNamespace={controlNamespace}
        />
      ))}
      {pendingMcpElicitations.map((elicitation) => (
        <McpElicitationCard
          key={String(elicitation.requestId)}
          elicitation={elicitation}
          mcpElicitationDrafts={mcpElicitationDrafts}
          actions={actions}
          controlNamespace={controlNamespace}
        />
      ))}
    </div>
  );
}

function McpElicitationCard({
  elicitation,
  mcpElicitationDrafts,
  actions,
  controlNamespace,
}: {
  elicitation: PendingMcpElicitationViewModel;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
  controlNamespace: string;
}): UiNode {
  const formRef = useRef<HTMLFormElement | null>(null);
  const accept = () => {
    if (elicitation.mode === "form" && formRef.current && !formRef.current.reportValidity()) return;
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
            <McpElicitationFields
              fields={elicitation.fields}
              drafts={mcpElicitationDrafts}
              actions={actions}
              controlNamespace={controlNamespace}
            />
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
        actions.setApprovalDetailsExpanded(approval.requestId, event.currentTarget.open);
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
  controlNamespace,
}: {
  input: PendingUserInputViewModel;
  userInputDrafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
  controlNamespace: string;
}): UiNode {
  return (
    <PendingRequestCard className="codex-panel__user-input">
      <div className="codex-panel__pending-request-info">
        <div className="codex-panel__pending-request-title">{input.title}</div>
        <div className="codex-panel__pending-request-body">{input.body}</div>
        <UserInputQuestions input={input} userInputDrafts={userInputDrafts} actions={actions} controlNamespace={controlNamespace} />
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
  controlNamespace,
}: {
  input: PendingUserInputViewModel;
  userInputDrafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
  controlNamespace: string;
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
                    const groupName = userInputRadioGroupName(controlNamespace, input.requestId, question.id);
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
                      groupName={userInputRadioGroupName(controlNamespace, input.requestId, question.id)}
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
  controlNamespace,
}: {
  fields: readonly PendingMcpElicitationFieldViewModel[];
  drafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
  controlNamespace: string;
}): UiNode {
  return (
    <div className="codex-panel__mcp-elicitation-fields">
      {fields.map((field) => (
        <McpElicitationField key={field.id} field={field} drafts={drafts} actions={actions} controlNamespace={controlNamespace} />
      ))}
    </div>
  );
}

function McpElicitationField({
  field,
  drafts,
  actions,
  controlNamespace,
}: {
  field: PendingMcpElicitationFieldViewModel;
  drafts: ReadonlyMap<string, string>;
  actions: PendingRequestBlockActions;
  controlNamespace: string;
}): UiNode {
  const current = drafts.get(field.draftKey) ?? field.defaultDraft;
  const labelId = mcpElicitationFieldElementId(controlNamespace, "label", field.draftKey);
  const controlId = mcpElicitationFieldElementId(controlNamespace, "control", field.draftKey);
  const labelContent = (
    <>
      <span>{field.title}</span>
      {field.required ? <span className="codex-panel__mcp-elicitation-required">Required</span> : null}
    </>
  );
  return (
    <div className="codex-panel__mcp-elicitation-field">
      {mcpElicitationFieldHasSingleControl(field) ? (
        <label id={labelId} className="codex-panel__mcp-elicitation-label" htmlFor={controlId}>
          {labelContent}
        </label>
      ) : (
        <div id={labelId} className="codex-panel__mcp-elicitation-label">
          {labelContent}
        </div>
      )}
      {field.description ? <div className="codex-panel__mcp-elicitation-description">{field.description}</div> : null}
      <McpElicitationFieldControl
        field={field}
        current={current}
        actions={actions}
        controlId={controlId}
        labelId={labelId}
        controlNamespace={controlNamespace}
      />
    </div>
  );
}

function McpElicitationFieldControl({
  field,
  current,
  actions,
  controlId,
  labelId,
  controlNamespace,
}: {
  field: PendingMcpElicitationFieldViewModel;
  current: string;
  actions: PendingRequestBlockActions;
  controlId: string;
  labelId: string;
  controlNamespace: string;
}): UiNode {
  switch (field.type) {
    case "boolean":
      return (
        <label className="codex-panel__mcp-elicitation-option">
          <input
            id={controlId}
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
        <fieldset className="codex-panel__mcp-elicitation-options" aria-labelledby={labelId}>
          {field.options?.map((option) => (
            <label key={option.value} className="codex-panel__mcp-elicitation-option">
              <input
                className="codex-panel__mcp-elicitation-radio"
                type="radio"
                name={controlName(controlNamespace, "mcp", field.draftKey)}
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
        </fieldset>
      );
    case "multi-select":
      return (
        <fieldset className="codex-panel__mcp-elicitation-options" aria-labelledby={labelId}>
          {field.options?.map((option) => {
            const selected = selectedMcpElicitationValues(current);
            return (
              <label key={option.value} className="codex-panel__mcp-elicitation-option">
                <input
                  className="codex-panel__mcp-elicitation-checkbox"
                  type="checkbox"
                  value={option.value}
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
        </fieldset>
      );
    case "number":
    case "integer":
      return (
        <input
          id={controlId}
          className="codex-panel__mcp-elicitation-input"
          type="number"
          step={field.type === "integer" ? "1" : "any"}
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
          id={controlId}
          className="codex-panel__mcp-elicitation-input"
          type="text"
          required={field.required}
          value={current}
          onInput={(event) => {
            actions.setMcpElicitationDraft(field.draftKey, event.currentTarget.value);
          }}
        />
      );
  }
}

function mcpElicitationFieldHasSingleControl(field: PendingMcpElicitationFieldViewModel): boolean {
  return field.type !== "single-select" && field.type !== "multi-select";
}

function mcpElicitationFieldElementId(namespace: string, kind: "control" | "label", draftKey: string): string {
  return controlName(namespace, "mcp", kind, draftKey);
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

function userInputRadioGroupName(namespace: string, requestId: PendingUserInputViewModel["requestId"], questionId: string): string {
  return controlName(namespace, "user-input", typeof requestId, String(requestId), questionId);
}

function controlName(namespace: string, ...parts: string[]): string {
  return ["codex-panel", namespace, ...parts].map(encodeURIComponent).join("-");
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
