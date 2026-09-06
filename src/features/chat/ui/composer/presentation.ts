import type { ModelMetadata, ReasoningEffort } from "../../../../domain/catalog/metadata";
import { sortedModelMetadata } from "../../../../domain/catalog/metadata";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import { compactReasoningEffortLabel } from "../../domain/runtime/labels";
import { type RuntimeControlsResolution, resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { contextSummary } from "../runtime/status";
import type { ComposerMetaViewModel } from "./composer";

type ComposerContextMeter = ComposerMetaViewModel["context"];
type ComposerContextMeterCell = ComposerContextMeter["cells"][number];
type ComposerRuntimeChoice = ComposerMetaViewModel["modelChoices"][number];

interface ComposerPresentationInput {
  snapshot: RuntimeSnapshot;
  disconnected: boolean;
  threadName: string | null;
  sideChatActive: boolean;
  sideChatSourceTitle: string | null;
  inputRestriction: "read-only" | "agent-unknown" | null;
}

interface ComposerRuntimeActions {
  requestModel: (model: string) => void;
  requestReasoningEffort: (effort: ReasoningEffort) => void;
}

export function composerPresentation(
  input: ComposerPresentationInput,
  actions: ComposerRuntimeActions,
): {
  placeholder: string;
  meta: ComposerMetaViewModel;
} {
  const { snapshot } = input;
  const resolution = resolveRuntimeControls(snapshot, runtimeConfigOrDefault(snapshot.runtimeConfig));
  return {
    placeholder:
      input.inputRestriction === "read-only"
        ? "This thread cannot accept messages."
        : input.inputRestriction === "agent-unknown"
          ? "Agent thread is read-only."
          : composerPlaceholder(input.threadName, input.sideChatActive, input.sideChatSourceTitle),
    meta: {
      ...composerMetaViewModel(input.disconnected, snapshot, resolution),
      ...runtimeComposerChoices({ models: snapshot.availableModels, resolution, ...actions }),
    },
  };
}

interface RuntimeComposerChoicesInput {
  models: readonly ModelMetadata[];
  resolution: RuntimeControlsResolution;
  requestModel: (model: string) => void;
  requestReasoningEffort: (effort: ReasoningEffort) => void;
}

function composerPlaceholder(threadName: string | null, sideChatActive: boolean, sideChatSourceTitle: string | null): string {
  if (sideChatActive) return sideChatSourceTitle ? `Ask in side chat for “${sideChatSourceTitle}”...` : "Ask in side chat...";
  return threadName ? `Ask Codex in “${threadName}”...` : "Ask Codex...";
}

function composerMetaViewModel(
  disconnected: boolean,
  snapshot: RuntimeSnapshot,
  resolution: RuntimeControlsResolution,
): Omit<ComposerMetaViewModel, "modelChoices" | "effortChoices"> {
  if (disconnected) {
    return {
      fatal: "Codex app-server disconnected",
      context: contextComposerMeter(null),
      statusSummary: "Codex app-server disconnected",
      model: "",
      effort: null,
      planActive: false,
      autoReviewActive: false,
      fastAvailable: false,
      fastActive: false,
    };
  }

  const context = contextSummary(snapshot);
  const selectedModel = resolution.model.effective;
  const effort = resolution.reasoningEffort.effective;
  const composerContext = contextComposerMeter(context?.percent ?? emptyThreadContextPercent(snapshot));
  const compactEffort = effort ? compactReasoningEffortLabel(effort) : null;
  const planActive = resolution.collaborationMode.effective === "plan";
  const reviewActive = resolution.autoReview.active;
  const fastAvailable = resolution.fastMode.available;
  const fastActive = resolution.fastMode.active;
  return {
    fatal: null,
    context: composerContext,
    statusSummary: composerStatusSummary({
      context: composerContext,
      model: selectedModel ?? "default",
      effort: compactEffort,
      planActive,
      autoReviewActive: reviewActive,
      fastActive,
    }),
    model: selectedModel ?? "default",
    effort: compactEffort,
    planActive,
    autoReviewActive: reviewActive,
    fastAvailable,
    fastActive,
  };
}

function emptyThreadContextPercent(snapshot: RuntimeSnapshot): number | null {
  return snapshot.activeThreadId ? null : 0;
}

function runtimeComposerChoices(input: RuntimeComposerChoicesInput): {
  modelChoices: ComposerRuntimeChoice[];
  effortChoices: ComposerRuntimeChoice[];
} {
  const resolution = input.resolution;
  const effectiveModel = resolution.model.effective;
  const models = sortedModelMetadata(input.models);
  const modelChoices: ComposerRuntimeChoice[] = models.slice(0, 12).map((model) => ({
    label: model.model,
    selected: effectiveModel === model.model,
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

  const activeEffort = resolution.reasoningEffort.effective;
  const effortChoices: ComposerRuntimeChoice[] = resolution.supportedReasoningEfforts.map((effort) => ({
    label: effort,
    selected: activeEffort === effort,
    onClick: () => {
      input.requestReasoningEffort(effort);
    },
  }));

  return { modelChoices, effortChoices };
}

function composerStatusSummary(input: {
  context: ComposerContextMeter;
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

function contextComposerMeter(percent: number | null): ComposerContextMeter {
  const percentLabel = percent === null ? "--%" : `${String(Math.round(Math.max(0, Math.min(100, percent)))).padStart(2, " ")}%`;
  return {
    cells: contextBrailleCells(percent),
    percent: percentLabel,
  };
}

function contextBrailleCells(percent: number | null): ComposerContextMeterCell[] {
  if (percent === null) return Array.from({ length: CONTEXT_DOT_WIDTH }, () => ({ text: CONTEXT_EMPTY_DOT, placeholder: true }));
  const clamped = Math.max(0, Math.min(100, percent));
  const cells: ComposerContextMeterCell[] = [];
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
