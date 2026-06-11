import {
  autoReviewActive,
  currentModel,
  currentReasoningEffort,
  fastModeActive,
  runtimeConfigOrDefault,
} from "../../runtime/effective-settings";
import { compactReasoningEffortLabel } from "../../conversation/turns/runtime-overrides";
import { contextSummary } from "../../runtime/status-summary";
import type { ChatState } from "../../state/reducer";
import type { ComposerContextMeterCellViewModel, ComposerContextMeterViewModel, ComposerMetaViewModel } from "./types";
import type { runtimeSnapshotForChatSlices } from "./runtime";

export function composerPlaceholder(threadName: string | null): string {
  return threadName ? `Ask Codex to work on “${threadName}”...` : "Ask Codex to work on this task...";
}

export function composerMetaViewModel(state: ChatState, snapshot: ReturnType<typeof runtimeSnapshotForChatSlices>): ComposerMetaViewModel {
  if (state.connection.status === "Connection failed.") {
    return {
      fatal: "Codex app-server disconnected",
      context: contextComposerMeter(null),
      statusSummary: "Codex app-server disconnected",
      model: "",
      effort: null,
      planActive: false,
      autoReviewActive: false,
      fastActive: false,
    };
  }

  const config = runtimeConfigOrDefault(state.connection.runtimeConfig);
  const context = contextSummary(snapshot);
  const model = currentModel(snapshot, config);
  const effort = currentReasoningEffort(snapshot, config);
  const composerContext = contextComposerMeter(context?.percent ?? null);
  const compactEffort = effort ? compactReasoningEffortLabel(effort) : null;
  const planActive = state.runtime.selectedCollaborationMode === "plan";
  const reviewActive = autoReviewActive(snapshot, config);
  const fastActive = fastModeActive(snapshot, config);
  return {
    fatal: null,
    context: composerContext,
    statusSummary: composerStatusSummary({
      context: composerContext,
      model: model ?? "default",
      effort: compactEffort,
      planActive,
      autoReviewActive: reviewActive,
      fastActive,
    }),
    model: model ?? "default",
    effort: compactEffort,
    planActive,
    autoReviewActive: reviewActive,
    fastActive,
  };
}

function composerStatusSummary(input: {
  context: ComposerContextMeterViewModel;
  model: string;
  effort: string | null;
  planActive: boolean;
  autoReviewActive: boolean;
  fastActive: boolean;
}): string {
  const context = input.context.percent === "--%" ? "Context unavailable" : `Context ${input.context.percent.trim()}`;
  return [
    context,
    `plan ${onOffLabel(input.planActive)}`,
    `auto-review ${onOffLabel(input.autoReviewActive)}`,
    `fast ${onOffLabel(input.fastActive)}`,
    `model ${input.model}`,
    `reasoning effort ${input.effort ?? "default"}`,
  ].join(", ");
}

function onOffLabel(active: boolean): string {
  return active ? "on" : "off";
}

const CONTEXT_DOT_WIDTH = 4;
const CONTEXT_CELL_PERCENT = 100 / CONTEXT_DOT_WIDTH;
const CONTEXT_PARTIAL_DOTS = ["", "⣀", "⣤", "⣶", "⣿"] as const;
const CONTEXT_FULL_DOT = "⣿";
const CONTEXT_EMPTY_DOT = "⣀";

function contextComposerMeter(percent: number | null): ComposerContextMeterViewModel {
  const percentLabel = percent === null ? "--%" : `${String(Math.round(Math.max(0, Math.min(100, percent)))).padStart(2, " ")}%`;
  return {
    cells: contextBrailleCells(percent),
    percent: percentLabel,
  };
}

function contextBrailleCells(percent: number | null): ComposerContextMeterCellViewModel[] {
  if (percent === null) return Array.from({ length: CONTEXT_DOT_WIDTH }, () => ({ text: CONTEXT_EMPTY_DOT, placeholder: true }));
  const clamped = Math.max(0, Math.min(100, percent));
  const cells: ComposerContextMeterCellViewModel[] = [];
  for (let index = 0; index < CONTEXT_DOT_WIDTH; index += 1) {
    const remaining = clamped - index * CONTEXT_CELL_PERCENT;
    if (remaining <= 0) {
      cells.push({ text: CONTEXT_EMPTY_DOT, placeholder: true });
      continue;
    }
    const partialIndex = Math.min(CONTEXT_PARTIAL_DOTS.length - 1, Math.ceil((remaining / CONTEXT_CELL_PERCENT) * 4));
    cells.push({ text: CONTEXT_PARTIAL_DOTS[partialIndex] ?? CONTEXT_FULL_DOT, placeholder: false });
  }
  return cells;
}
