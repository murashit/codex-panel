import type { ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";

import { activeAgentRunSummary } from "../display/agent";
import { executionState } from "../display/state";
import type {
  AgentDisplayItem,
  AgentRunSummary,
  AgentRunSummaryAgent,
  DisplayItem,
  ReasoningDisplayItem,
  TaskProgressDisplayItem,
} from "../display/types";
import { agentActivityMetaLabel, agentMessagePreview, agentRunSummaryLabel, taskStatusMarker } from "../display/labels";
import { activeTurnId, type ChatTurnLifecycleState } from "../chat-state";
import { createWorkMessageClassName } from "./work-message";
import { shortThreadId, truncate } from "../../../utils";

const AGENT_ROW_MESSAGE_PREVIEW_LIMIT = 120;
const AGENT_ACTIVITY_PROMPT_PREVIEW_LIMIT = 96;

export type WorkItemDisplayItem = TaskProgressDisplayItem | AgentDisplayItem | ReasoningDisplayItem;

export interface WorkItemContext {
  turnLifecycle: ChatTurnLifecycleState;
  displayItems: readonly DisplayItem[];
  openDetails: ReadonlySet<string>;
  onDetailsToggle?: (key: string, open: boolean) => void;
}

export function workItemsActiveTurnId(context: Pick<WorkItemContext, "turnLifecycle">): string | null {
  return activeTurnId(context);
}

export function activeAgentRunSummaryBlock(context: WorkItemContext): AgentRunSummary | null {
  return activeAgentRunSummary(context.displayItems, workItemsActiveTurnId(context));
}

export function agentRunSummaryNode(summary: AgentRunSummary): UiNode {
  return <AgentRunSummaryItem summary={summary} />;
}

export function workItemNode(item: WorkItemDisplayItem, context: WorkItemContext): UiNode {
  if (item.kind === "taskProgress") return <TaskProgressItem item={item} />;
  if (item.kind === "agent") return <AgentItem item={item} context={context} />;
  return <ReasoningItem item={item} context={context} />;
}

function AgentRunSummaryItem({ summary }: { summary: AgentRunSummary }): UiNode {
  return (
    <WorkMessage label="agents" className="codex-panel__agent-summary" state={summary.failed > 0 ? "failed" : "running"}>
      <div className="codex-panel__tool-summary">{agentRunSummaryLabel(summary)}</div>
      <AgentSummaryRows summary={summary} />
    </WorkMessage>
  );
}

function TaskProgressItem({ item }: { item: TaskProgressDisplayItem }): UiNode {
  return (
    <WorkMessage label="tasks" className="codex-panel__task-progress" state={executionState(item)}>
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

function AgentItem({ item, context }: { item: AgentDisplayItem; context: WorkItemContext }): UiNode {
  const detailsKey = `${item.id}:agent-details`;
  const [detailsOpen, setDetailsOpen] = useState(context.openDetails.has(detailsKey));
  useLayoutEffect(() => {
    setDetailsOpen(context.openDetails.has(detailsKey));
  }, [context.openDetails, detailsKey]);
  return (
    <WorkMessage label="agent" className={`codex-panel__agent-activity${detailsOpen ? " is-open" : ""}`} state={executionState(item)}>
      <div className="codex-panel__tool-summary codex-panel__agent-activity-summary">{agentSummaryText(item)}</div>
      <details
        className="codex-panel__output codex-panel__agent-details"
        open={detailsOpen}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          setDetailsOpen(nextOpen);
          context.onDetailsToggle?.(detailsKey, nextOpen);
        }}
      >
        <summary>Details</summary>
        <dl className="codex-panel__meta-grid">
          <MetaPair name="tool" value={agentActivityMetaLabel(item.tool)} />
          <MetaPair name="status" value={item.status} />
          <MetaPair name="sender" value={item.senderThreadId} />
          {item.receiverThreadIds.length > 0 ? <MetaPair name="target" value={item.receiverThreadIds.join(", ")} /> : null}
          {item.model ? <MetaPair name="model" value={item.model} /> : null}
          {item.reasoningEffort ? <MetaPair name="effort" value={item.reasoningEffort} /> : null}
        </dl>
        {item.prompt ? (
          <section className="codex-panel__agent-detail-section">
            <div className="codex-panel__output-title">Prompt</div>
            <pre>{item.prompt}</pre>
          </section>
        ) : null}
        {item.agents.length > 0 ? (
          <ul className="codex-panel__agent-list">
            {item.agents.map((agent) => (
              <li key={agent.threadId} className="codex-panel__agent-row">
                <span className="codex-panel__agent-thread">{shortThreadId(agent.threadId)}</span>
                <span className="codex-panel__agent-status">{agentStatusLabel(agent.status, agent.message)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {item.agents.map((agent) =>
          agent.message && isLongAgentMessage(agent.message) ? (
            <section key={agent.threadId} className="codex-panel__agent-detail-section">
              <div className="codex-panel__output-title">Agent output {shortThreadId(agent.threadId)}</div>
              <pre>{agent.message}</pre>
            </section>
          ) : null,
        )}
      </details>
    </WorkMessage>
  );
}

function ReasoningItem({ item, context }: { item: ReasoningDisplayItem; context: WorkItemContext }): UiNode {
  const active = isReasoningActive(item, context);
  return (
    <div className={`codex-panel__reasoning${active ? " is-active" : ""}`}>
      <div className="codex-panel__reasoning-role">{active ? "reasoning" : "thought"}</div>
      <div className="codex-panel__reasoning-content">
        <span>{item.text || (active ? "Reasoning" : "Thought")}</span>
        {active ? (
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
  state: ReturnType<typeof executionState>;
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

function AgentSummaryRows({ summary }: { summary: AgentRunSummary }): UiNode {
  if (summary.agents.length === 0 && summary.additionalAgents === 0) return null;
  return (
    <ul className="codex-panel__agent-list codex-panel__agent-list--summary">
      {summary.agents.map((agent) => (
        <li key={agent.threadId} className="codex-panel__agent-row">
          <span className="codex-panel__agent-thread">{shortThreadId(agent.threadId)}</span>
          <span className="codex-panel__agent-status">{agentSummaryStatusLabel(agent)}</span>
        </li>
      ))}
      {summary.additionalAgents > 0 ? (
        <li className="codex-panel__agent-row codex-panel__agent-row--more">
          <span className="codex-panel__agent-thread" />
          <span className="codex-panel__agent-status">+{String(summary.additionalAgents)} more</span>
        </li>
      ) : null}
    </ul>
  );
}

function agentSummaryText(item: AgentDisplayItem): string {
  const target = item.receiverThreadIds.length === 0 ? "" : ` ${item.receiverThreadIds.map(shortThreadId).join(", ")}`;
  const promptPreview = agentPromptPreview(item.prompt);
  return `${agentActivityMetaLabel(item.tool)}${target}${promptPreview ? `: ${promptPreview}` : ""} (${item.status})`;
}

function agentPromptPreview(prompt: string | null): string | null {
  if (!prompt) return null;
  const normalized = prompt.trim().replace(/\s+/g, " ");
  return normalized ? truncate(normalized, AGENT_ACTIVITY_PROMPT_PREVIEW_LIMIT) : null;
}

function agentStatusLabel(status: string, message: string | null): string {
  const preview = agentMessagePreview(message, AGENT_ROW_MESSAGE_PREVIEW_LIMIT);
  return preview ? `${status}: ${preview}` : status;
}

function agentSummaryStatusLabel(agent: AgentRunSummaryAgent): string {
  return agent.messagePreview ? `${agent.status}: ${agent.messagePreview}` : agent.status;
}

function isLongAgentMessage(message: string): boolean {
  return message.length > AGENT_ROW_MESSAGE_PREVIEW_LIMIT || message.includes("\n");
}

function isReasoningActive(item: ReasoningDisplayItem, context: WorkItemContext): boolean {
  const activeTurn = workItemsActiveTurnId(context);
  if (!activeTurn || item.turnId !== activeTurn) return false;
  if (executionState(item) === "completed") return false;
  const latestActiveTurnItem = [...context.displayItems].reverse().find((candidate) => candidate.turnId === activeTurn);
  return latestActiveTurnItem?.id === item.id;
}
