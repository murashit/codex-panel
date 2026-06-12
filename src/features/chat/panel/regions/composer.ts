import {
  autoReviewActive,
  currentModel,
  currentReasoningEffort,
  fastModeActive,
  runtimeConfigOrDefault,
  supportedReasoningEfforts,
} from "../../runtime/effective";
import { compactReasoningEffortLabel } from "../../conversation/turns/runtime-overrides";
import { contextSummary } from "../../display/status/runtime";
import { sortedModelMetadata } from "../../../../domain/catalog/metadata";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeSnapshot } from "../../runtime/snapshot";
import type { ChatState } from "../../state/reducer";
import type {
  ComposerContextMeterCellViewModel,
  ComposerContextMeterViewModel,
  ComposerMetaViewModel,
  RuntimeChoice,
} from "../../ui/composer";
import { explicitThreadName } from "../../../../domain/threads/model";
import type { ChatPanelComposerPorts, RestoredThreadTitleSnapshot } from "./ports";

export interface RuntimeComposerChoicesInput {
  state: ChatState;
  snapshot: RuntimeSnapshot;
  requestModel: (model: string) => void;
  requestReasoningEffort: (effort: ReasoningEffort) => void;
  resetReasoningEffortToConfig: () => void;
}

export function composerPlaceholder(threadName: string | null): string {
  return threadName ? `Ask Codex to work on “${threadName}”...` : "Ask Codex to work on this task...";
}

export function chatPanelComposerPlaceholder(ports: ChatPanelComposerPorts): string {
  return composerPlaceholder(activeComposerThreadName(ports.state.chat(), ports.thread.restoredPlaceholder()));
}

export function chatPanelComposerMetaViewModel(ports: ChatPanelComposerPorts) {
  const state = ports.state.chat();
  const snapshot = ports.runtime.snapshot();
  return {
    ...composerMetaViewModel(state, snapshot),
    ...runtimeComposerChoices({
      state,
      snapshot,
      requestModel: (model) => void ports.runtime.requestModel(model),
      requestReasoningEffort: (effort) => void ports.runtime.requestReasoningEffort(effort),
      resetReasoningEffortToConfig: () => void ports.runtime.resetReasoningEffortToConfig(),
    }),
  };
}

export function composerMetaViewModel(state: ChatState, snapshot: RuntimeSnapshot): ComposerMetaViewModel {
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

export function runtimeComposerChoices(input: RuntimeComposerChoicesInput): {
  modelChoices: RuntimeChoice[];
  effortChoices: RuntimeChoice[];
} {
  const config = runtimeConfigOrDefault(input.state.connection.runtimeConfig);
  const activeModel = currentModel(input.snapshot, config);
  const models = sortedModelMetadata(input.state.connection.availableModels);
  const modelChoices: RuntimeChoice[] = models.slice(0, 12).map((model) => ({
    label: model.model,
    selected: activeModel === model.model,
    onClick: () => {
      input.requestModel(model.model);
    },
  }));
  if (models.length === 0) {
    modelChoices.push({
      label: "No model list available.",
      disabled: true,
      onClick: () => undefined,
    });
  }

  const activeEffort = currentReasoningEffort(input.snapshot, config);
  const effortChoices: RuntimeChoice[] = [
    {
      label: "Codex default",
      selected: activeEffort === null,
      onClick: () => {
        input.resetReasoningEffortToConfig();
      },
    },
    ...supportedReasoningEfforts(input.snapshot, config).map((effort) => ({
      label: effort,
      selected: activeEffort === effort,
      onClick: () => {
        input.requestReasoningEffort(effort);
      },
    })),
  ];

  return { modelChoices, effortChoices };
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

function activeComposerThreadName(state: ChatState, restoredThread: RestoredThreadTitleSnapshot | null): string | null {
  const threadId = state.activeThread.id;
  if (!threadId) return null;
  const thread = state.threadList.listedThreads.find((item) => item.id === threadId);
  const listedName = thread ? explicitThreadName(thread) : null;
  if (listedName) return listedName;
  return restoredThread?.threadId === threadId ? restoredThread.explicitName : null;
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
