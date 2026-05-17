import type { DisplayItem } from "./types";
import type { TurnPlanStep } from "../generated/app-server/v2/TurnPlanStep";
import { taskStatusMarker } from "./labels";
import { classifyExecutionState } from "./state";

export function normalizeProposedPlanMarkdown(text: string): string {
  return text
    .replace(/^\s*<proposed_plan>\s*\n?/i, "")
    .replace(/\n?\s*<\/proposed_plan>\s*$/i, "")
    .trim();
}

export function planProgressDisplayItem(turnId: string, explanation: string | null, plan: TurnPlanStep[]): DisplayItem {
  const lines = plan.map((step) => `${taskStatusMarker(step.status)} ${step.step}`);
  const body = [explanation?.trim(), ...lines].filter((line): line is string => Boolean(line && line.length > 0)).join("\n");
  const status = plan.some((step) => step.status === "inProgress" || step.status === "pending") ? "inProgress" : "completed";
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    text: body || "Plan updated",
    turnId,
    itemId: `plan-progress-${turnId}`,
    explanation: explanation?.trim() || null,
    steps: plan.map((step) => ({ step: step.step, status: step.status })),
    status,
    state: classifyExecutionState({ status }),
  };
}
