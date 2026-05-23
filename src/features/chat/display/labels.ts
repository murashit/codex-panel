import type { TurnPlanStep } from "../../../generated/app-server/v2/TurnPlanStep";
import { truncate } from "../../../utils";
import type { AgentRunSummary } from "./types";

export function taskStatusMarker(status: TurnPlanStep["status"]): string {
  if (status === "completed") return "[x]";
  if (status === "inProgress") return "[>]";
  return "[ ]";
}

export function agentActivitySummaryLabel(tool: string): string {
  if (tool === "spawnAgent") return "Spawn agent";
  if (tool === "sendInput") return "Send input to agent";
  if (tool === "resumeAgent") return "Resume agent";
  if (tool === "wait") return "Wait for agent";
  if (tool === "closeAgent") return "Close agent";
  return `Agent ${tool}`;
}

export function agentActivityMetaLabel(tool: string): string {
  if (tool === "spawnAgent") return "spawn";
  if (tool === "sendInput") return "send input";
  if (tool === "resumeAgent") return "resume";
  if (tool === "wait") return "wait";
  if (tool === "closeAgent") return "close";
  return tool;
}

export function agentRunSummaryLabel(summary: AgentRunSummary): string {
  const parts: string[] = [];
  if (summary.failed > 0) parts.push(`${String(summary.failed)} failed`);
  if (summary.running > 0) parts.push(`${String(summary.running)} running`);
  if (summary.completed > 0) parts.push(`${String(summary.completed)} done`);
  return `Agents ${parts.join(", ")}`;
}

export function agentMessagePreview(message: string | null, maxLength: number): string | null {
  if (!message) return null;
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  return truncate(firstLine.replace(/\s+/g, " "), maxLength);
}
