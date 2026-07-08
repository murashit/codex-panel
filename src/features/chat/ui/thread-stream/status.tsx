import type { ComponentChild as UiNode } from "preact";

import type { ExecutionState } from "../../domain/thread-stream/items";
import type { AgentRunSummaryView, ThreadStreamStatusView } from "../../presentation/thread-stream/status-view";
import type { ThreadStreamContext } from "./context";

export function agentRunSummaryNode(view: AgentRunSummaryView, context: Pick<ThreadStreamContext, "openThreadInNewView">): UiNode {
  return <AgentRunSummary view={view} openThreadInNewView={context.openThreadInNewView} />;
}

export function statusNode(view: ThreadStreamStatusView): UiNode {
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
    tone === "warning" ? "codex-panel__status-message--warning" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function AgentRunSummary({
  view,
  openThreadInNewView,
}: {
  view: AgentRunSummaryView;
  openThreadInNewView?: ((threadId: string) => void) | undefined;
}): UiNode {
  return (
    <StatusMessage label={view.label} className={view.className} state={view.state}>
      <div className="codex-panel__stream-summary">{view.summary}</div>
      <AgentSummaryRows view={view} openThreadInNewView={openThreadInNewView} />
    </StatusMessage>
  );
}

function TaskProgress({ view }: { view: Extract<ThreadStreamStatusView, { kind: "taskProgress" }> }): UiNode {
  return (
    <StatusMessage label={view.label} className={view.className} state={view.state}>
      {view.summary ? <div className="codex-panel__stream-summary">{view.summary}</div> : null}
      {view.checklist.length === 0 ? (
        <div className="codex-panel__stream-summary">Plan updated</div>
      ) : (
        <ul className="codex-panel__task-list">
          {view.checklist.map((step) => (
            <li
              key={`${step.status}\n${step.step}`}
              className={
                step.status === "completed"
                  ? "codex-panel__task-step codex-panel__task-step--completed"
                  : step.status === "inProgress"
                    ? "codex-panel__task-step codex-panel__task-step--inProgress"
                    : "codex-panel__task-step"
              }
            >
              <span className="codex-panel__task-marker">
                {step.status === "completed" ? "[x]" : step.status === "inProgress" ? "[>]" : "[ ]"}
              </span>
              <span className="codex-panel__task-text">{step.step}</span>
            </li>
          ))}
        </ul>
      )}
    </StatusMessage>
  );
}

function ContextCompaction({ view }: { view: Extract<ThreadStreamStatusView, { kind: "contextCompaction" }> }): UiNode {
  return (
    <StatusMessage label={view.label} className={view.className} state={view.state}>
      <div className="codex-panel__stream-summary">{view.text}</div>
    </StatusMessage>
  );
}

function GenericStatus({ view }: { view: Extract<ThreadStreamStatusView, { kind: "generic" }> }): UiNode {
  return (
    <StatusMessage label={view.label} className={view.className} state={view.state}>
      <div className="codex-panel__stream-summary">{view.text}</div>
    </StatusMessage>
  );
}

function Reasoning({ view }: { view: Extract<ThreadStreamStatusView, { kind: "reasoning" }> }): UiNode {
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
  const classes = [createStatusMessageClassName(className), executionClassName(state)].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <div className="codex-panel__message-role">{label}</div>
      {children}
    </div>
  );
}

function executionClassName(state: ExecutionState): string {
  if (state === "completed") return "codex-panel__execution codex-panel__execution--completed";
  if (state === "failed") return "codex-panel__execution codex-panel__execution--failed";
  if (state === "running") return "codex-panel__execution codex-panel__execution--running";
  return "";
}

function AgentSummaryRows({
  view,
  openThreadInNewView,
}: {
  view: AgentRunSummaryView;
  openThreadInNewView?: ((threadId: string) => void) | undefined;
}): UiNode {
  if (view.rows.length === 0 && view.additionalAgents === 0) return null;
  return (
    <ul className="codex-panel__agent-list codex-panel__agent-list--summary">
      {view.rows.map((agent) => (
        <li key={agent.threadId} className={openThreadInNewView ? "codex-panel__agent-row-shell" : "codex-panel__agent-row"}>
          {openThreadInNewView ? (
            // biome-ignore lint/a11y: Agent summary rows follow the toolbar subpanel nav-item pattern: pointer-first rows with visible text as the interaction target.
            <div
              className="codex-panel-ui__nav-item codex-panel__agent-row codex-panel__agent-row--interactive"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openThreadInNewView(agent.threadId);
              }}
            >
              <span className="codex-panel__agent-thread">{agent.threadLabel}</span>
              <span className="codex-panel__agent-status">{agent.status}</span>
            </div>
          ) : (
            <>
              <span className="codex-panel__agent-thread">{agent.threadLabel}</span>
              <span className="codex-panel__agent-status">{agent.status}</span>
            </>
          )}
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
