import type { ComponentChild as UiNode } from "preact";

import type { ExecutionState, TaskProgressMessageStreamItem } from "../../domain/message-stream/items";
import type { AgentRunSummaryView, MessageStreamWorkView } from "../../presentation/message-stream/work-view";
import type { MessageStreamDisclosureState } from "./context";
import { createWorkMessageClassName } from "./work-message";

export interface WorkItemContext {
  disclosures: MessageStreamDisclosureState;
  onDisclosureToggle?: (bucket: "agentDetails", id: string, open: boolean) => void;
}

export function agentRunSummaryNode(view: AgentRunSummaryView): UiNode {
  return <AgentRunSummaryItem view={view} />;
}

export function workItemNode(view: MessageStreamWorkView, context: WorkItemContext): UiNode {
  if (view.kind === "taskProgress") return <TaskProgressItem view={view} />;
  if (view.kind === "agent") return <AgentItem view={view} context={context} />;
  if (view.kind === "contextCompaction") return <ContextCompactionItem view={view} />;
  return <ReasoningItem view={view} />;
}

function AgentRunSummaryItem({ view }: { view: AgentRunSummaryView }): UiNode {
  return (
    <WorkMessage label={view.label} className={view.className} state={view.state}>
      <div className="codex-panel__tool-summary">{view.summary}</div>
      <AgentSummaryRows view={view} />
    </WorkMessage>
  );
}

function TaskProgressItem({ view }: { view: Extract<MessageStreamWorkView, { kind: "taskProgress" }> }): UiNode {
  const { item } = view;
  return (
    <WorkMessage label={view.label} className={view.className} state={view.state}>
      {item.explanation ? <div className="codex-panel__tool-summary">{item.explanation}</div> : null}
      {item.steps.length === 0 ? (
        <div className="codex-panel__tool-summary">Plan updated</div>
      ) : (
        <ul className="codex-panel__task-list">
          {item.steps.map((step) => (
            <li key={`${step.status}\n${step.step}`} className={`codex-panel__task-step codex-panel__task-step--${step.status}`}>
              <span className="codex-panel__task-marker">{taskStatusMarker(step.status)}</span>
              <span className="codex-panel__task-text">{step.step}</span>
            </li>
          ))}
        </ul>
      )}
    </WorkMessage>
  );
}

function taskStatusMarker(status: TaskProgressMessageStreamItem["steps"][number]["status"]): string {
  if (status === "completed") return "[x]";
  if (status === "inProgress") return "[>]";
  return "[ ]";
}

function ContextCompactionItem({ view }: { view: Extract<MessageStreamWorkView, { kind: "contextCompaction" }> }): UiNode {
  return (
    <WorkMessage label={view.label} className={view.className} state={view.state}>
      <div className="codex-panel__tool-summary">{view.summary}</div>
    </WorkMessage>
  );
}

function AgentItem({ view, context }: { view: Extract<MessageStreamWorkView, { kind: "agent" }>; context: WorkItemContext }): UiNode {
  const { item } = view;
  const detailsOpen = context.disclosures.agentDetails.has(item.id);
  return (
    <WorkMessage label={view.label} className={`${view.className}${detailsOpen ? " is-open" : ""}`} state={view.state}>
      <div className="codex-panel__tool-summary codex-panel__agent-activity-summary">{view.summary}</div>
      <details
        className="codex-panel__output codex-panel__agent-details"
        open={detailsOpen}
        onToggle={(event) => {
          context.onDisclosureToggle?.("agentDetails", item.id, event.currentTarget.open);
        }}
      >
        <summary tabIndex={-1}>Details</summary>
        <dl className="codex-panel__meta-grid">
          {view.metaRows.map((row) => (
            <MetaPair key={`${row.key}\n${row.value}`} name={row.key} value={row.value} />
          ))}
        </dl>
        {view.prompt ? (
          <section className="codex-panel__agent-detail-section">
            <div className="codex-panel__output-title">Prompt</div>
            <pre>{view.prompt}</pre>
          </section>
        ) : null}
        {view.agentRows.length > 0 ? (
          <ul className="codex-panel__agent-list">
            {view.agentRows.map((agent) => (
              <li key={agent.threadId} className="codex-panel__agent-row">
                <span className="codex-panel__agent-thread">{agent.threadLabel}</span>
                <span className="codex-panel__agent-status">{agent.status}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {view.expandedMessages.map((agent) => (
          <section key={agent.threadId} className="codex-panel__agent-detail-section">
            <div className="codex-panel__output-title">Agent output {agent.threadLabel}</div>
            <pre>{agent.message}</pre>
          </section>
        ))}
      </details>
    </WorkMessage>
  );
}

function ReasoningItem({ view }: { view: Extract<MessageStreamWorkView, { kind: "reasoning" }> }): UiNode {
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

function WorkMessage({
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
  const classes = [createWorkMessageClassName(className), state ? `codex-panel__execution codex-panel__execution--${state}` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <div className="codex-panel__message-role">{label}</div>
      {children}
    </div>
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
