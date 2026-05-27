import { useLayoutEffect, useState, type ReactNode } from "react";

import { activeAgentRunSummary } from "../display/agent";
import { executionState } from "../display/state";
import type { AgentDisplayItem, AgentRunSummary, AgentRunSummaryAgent, TaskProgressDisplayItem, ToolDisplayItem } from "../display/types";
import { agentActivityMetaLabel, agentMessagePreview, agentRunSummaryLabel, taskStatusMarker } from "../display/labels";
import type { MessageStreamContext } from "./message-stream";
import { createWorkMessageClassName } from "./work-message";
import { shortThreadId } from "../../../utils";

const AGENT_ROW_MESSAGE_PREVIEW_LIMIT = 120;

type ReasoningDisplayItem = ToolDisplayItem & { kind: "reasoning" };
export type WorkItemDisplayItem = TaskProgressDisplayItem | AgentDisplayItem | ReasoningDisplayItem;

export function activeAgentRunSummaryBlock(context: MessageStreamContext): AgentRunSummary | null {
  return activeAgentRunSummary(context.displayItems, context.activeTurnId, context.busy);
}

export function agentRunSummaryNode(summary: AgentRunSummary): ReactNode {
  return <AgentRunSummaryItem summary={summary} />;
}

export function workItemNode(item: WorkItemDisplayItem, context: MessageStreamContext): ReactNode {
  if (item.kind === "taskProgress") return <TaskProgressItem item={item} />;
  if (item.kind === "agent") return <AgentItem item={item} context={context} />;
  return <ReasoningItem item={item} context={context} />;
}

function AgentRunSummaryItem({ summary }: { summary: AgentRunSummary }): ReactNode {
  return (
    <WorkMessage label="agents" className="codex-panel__agent-summary" state={summary.failed > 0 ? "failed" : "running"}>
      <div className="codex-panel__tool-summary">{agentRunSummaryLabel(summary)}</div>
      <AgentSummaryRows summary={summary} />
    </WorkMessage>
  );
}

function TaskProgressItem({ item }: { item: TaskProgressDisplayItem }): ReactNode {
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

function AgentItem({ item, context }: { item: AgentDisplayItem; context: MessageStreamContext }): ReactNode {
  return (
    <WorkMessage label="agent" className="codex-panel__agent-activity" state={executionState(item)}>
      <div className="codex-panel__tool-summary">{agentSummaryText(item)}</div>
      <RememberedDetails
        detailsClassName="codex-panel__output codex-panel__agent-details"
        detailsKey={`${item.id}:agent-details`}
        summary="Details"
        context={context}
      >
        <dl className="codex-panel__meta-grid">
          <MetaPair name="tool" value={agentActivityMetaLabel(item.tool)} />
          <MetaPair name="status" value={item.status} />
          <MetaPair name="sender" value={item.senderThreadId} />
          {item.receiverThreadIds.length > 0 ? <MetaPair name="target" value={item.receiverThreadIds.join(", ")} /> : null}
          {item.model ? <MetaPair name="model" value={item.model} /> : null}
          {item.reasoningEffort ? <MetaPair name="effort" value={item.reasoningEffort} /> : null}
        </dl>
      </RememberedDetails>
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
          <RememberedDetails
            key={agent.threadId}
            detailsClassName="codex-panel__output"
            detailsKey={`${item.id}:agent:${agent.threadId}:message`}
            summary={`Agent output ${shortThreadId(agent.threadId)}`}
            context={context}
          >
            <pre>{agent.message}</pre>
          </RememberedDetails>
        ) : null,
      )}
      {item.prompt ? (
        <RememberedDetails detailsClassName="codex-panel__output" detailsKey={`${item.id}:prompt`} summary="Prompt" context={context}>
          <pre>{item.prompt}</pre>
        </RememberedDetails>
      ) : null}
    </WorkMessage>
  );
}

function ReasoningItem({ item, context }: { item: ReasoningDisplayItem; context: MessageStreamContext }): ReactNode {
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
  children: ReactNode;
}): ReactNode {
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

function RememberedDetails({
  detailsClassName,
  detailsKey,
  summary,
  context,
  children,
}: {
  detailsClassName: string;
  detailsKey: string;
  summary: string;
  context: MessageStreamContext;
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(context.openDetails.has(detailsKey));
  useLayoutEffect(() => {
    setOpen(context.openDetails.has(detailsKey));
  }, [context.openDetails, detailsKey]);
  return (
    <details
      className={detailsClassName}
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        context.onDetailsToggle?.(detailsKey, nextOpen);
      }}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

function MetaPair({ name, value }: { name: string; value: string }): ReactNode {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  );
}

function AgentSummaryRows({ summary }: { summary: AgentRunSummary }): ReactNode {
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
  return `${agentActivityMetaLabel(item.tool)}${target} (${item.status})`;
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

function isReasoningActive(item: ReasoningDisplayItem, context: MessageStreamContext): boolean {
  if (!context.busy || !context.activeTurnId || item.turnId !== context.activeTurnId) return false;
  if (executionState(item) === "completed") return false;
  const latestActiveTurnItem = [...context.displayItems].reverse().find((candidate) => candidate.turnId === context.activeTurnId);
  return latestActiveTurnItem?.id === item.id;
}
