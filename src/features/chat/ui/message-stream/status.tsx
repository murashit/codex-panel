import type { ComponentChild as UiNode } from "preact";

import type { ExecutionState } from "../../domain/message-stream/items";
import type { AgentRunSummaryView, MessageStreamStatusView, StatusChecklistItem } from "../../presentation/message-stream/status-view";

export function agentRunSummaryNode(view: AgentRunSummaryView): UiNode {
  return <AgentRunSummary view={view} />;
}

export function statusNode(view: MessageStreamStatusView): UiNode {
  if (view.kind === "taskProgress") return <TaskProgress view={view} />;
  if (view.kind === "contextCompaction") return <ContextCompaction view={view} />;
  if (view.kind === "reasoning") return <Reasoning view={view} />;
  return <GenericStatus view={view} />;
}

export function createStatusMessageClassName(className: string, tone?: "warning"): string {
  return [
    "codex-panel__message",
    "codex-panel__message--tool",
    "codex-panel__status-message",
    className,
    tone ? `codex-panel__status-message--${tone}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function AgentRunSummary({ view }: { view: AgentRunSummaryView }): UiNode {
  return (
    <StatusMessage label={view.label} className={view.className} state={view.state}>
      <div className="codex-panel__stream-summary">{view.summary}</div>
      <AgentSummaryRows view={view} />
    </StatusMessage>
  );
}

function TaskProgress({ view }: { view: Extract<MessageStreamStatusView, { kind: "taskProgress" }> }): UiNode {
  return (
    <StatusMessage label={view.label} className={view.className} state={view.state}>
      {view.summary ? <div className="codex-panel__stream-summary">{view.summary}</div> : null}
      {view.checklist.length === 0 ? (
        <div className="codex-panel__stream-summary">Plan updated</div>
      ) : (
        <ul className="codex-panel__task-list">
          {view.checklist.map((step) => (
            <li key={`${step.status}\n${step.step}`} className={`codex-panel__task-step codex-panel__task-step--${step.status}`}>
              <span className="codex-panel__task-marker">{taskStatusMarker(step.status)}</span>
              <span className="codex-panel__task-text">{step.step}</span>
            </li>
          ))}
        </ul>
      )}
    </StatusMessage>
  );
}

function taskStatusMarker(status: StatusChecklistItem["status"]): string {
  if (status === "completed") return "[x]";
  if (status === "inProgress") return "[>]";
  return "[ ]";
}

function ContextCompaction({ view }: { view: Extract<MessageStreamStatusView, { kind: "contextCompaction" }> }): UiNode {
  return (
    <StatusMessage label={view.label} className={view.className} state={view.state}>
      <div className="codex-panel__stream-summary">{view.text}</div>
    </StatusMessage>
  );
}

function GenericStatus({ view }: { view: Extract<MessageStreamStatusView, { kind: "generic" }> }): UiNode {
  return (
    <StatusMessage label={view.label} className={view.className} state={view.state}>
      <div className="codex-panel__stream-summary">{view.text}</div>
    </StatusMessage>
  );
}

function Reasoning({ view }: { view: Extract<MessageStreamStatusView, { kind: "reasoning" }> }): UiNode {
  return (
    <div className={`codex-panel__reasoning${view.active ? " is-active" : ""}`}>
      <div className="codex-panel__reasoning-role">{view.label}</div>
      <div className="codex-panel__reasoning-content">
        <span>{view.text}</span>
        {view.active ? (
          <span className="codex-panel__reasoning-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatusMessage({
  label,
  className,
  state,
  children,
}: {
  label: string;
  className: string;
  state: ExecutionState;
  children: UiNode;
}): UiNode {
  const classes = [createStatusMessageClassName(className), state ? `codex-panel__execution codex-panel__execution--${state}` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <div className="codex-panel__message-role">{label}</div>
      {children}
    </div>
  );
}

function AgentSummaryRows({ view }: { view: AgentRunSummaryView }): UiNode {
  if (view.rows.length === 0 && view.additionalAgents === 0) return null;
  return (
    <ul className="codex-panel__agent-list codex-panel__agent-list--summary">
      {view.rows.map((agent) => (
        <li key={agent.threadId} className="codex-panel__agent-row">
          <span className="codex-panel__agent-thread">{agent.threadLabel}</span>
          <span className="codex-panel__agent-status">{agent.status}</span>
        </li>
      ))}
      {view.additionalAgents > 0 ? (
        <li className="codex-panel__agent-row codex-panel__agent-row--more">
          <span className="codex-panel__agent-thread" />
          <span className="codex-panel__agent-status">+{String(view.additionalAgents)} more</span>
        </li>
      ) : null}
    </ul>
  );
}
