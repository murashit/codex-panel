import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { sortedModelMetadata } from "../../../../domain/catalog/metadata";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import { runtimeSnapshotForChatSlices } from "../../application/runtime/snapshot";
import { compactReasoningEffortLabel } from "../../domain/runtime/labels";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { contextSummary } from "../../presentation/runtime/status";
import { type ComposerMetaViewModel, ComposerShell, type ComposerShellProps } from "../../ui/composer";
import type { ChatPanelComposerModel } from "../shell-selectors";

type ChatPanelComposerMeta = ComposerMetaViewModel;
type ChatPanelComposerContextMeter = ComposerMetaViewModel["context"];
type ChatPanelComposerContextMeterCell = ComposerMetaViewModel["context"]["cells"][number];
type ChatPanelComposerRuntimeChoice = NonNullable<ComposerMetaViewModel["modelChoices"]>[number];

export interface ChatPanelComposerProjection {
  placeholder: string;
  meta: ChatPanelComposerMeta;
}

export interface ChatPanelComposerProjectionActions {
  requestModel: (model: string) => Promise<void>;
  requestReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
}

export interface ChatPanelComposerPresenter {
  renderState(model: ChatPanelComposerModel, actions: ChatPanelComposerActions): ComposerShellProps;
}

export interface ChatPanelComposerActions {
  submit: () => void;
}

interface RuntimeComposerChoicesInput {
  model: ChatPanelComposerModel;
  snapshot: RuntimeSnapshot;
  requestModel: (model: string) => void;
  requestReasoningEffort: (effort: ReasoningEffort) => void;
}

function composerPlaceholder(threadName: string | null, sideChatActive: boolean, sideChatSourceTitle: string | null): string {
  if (sideChatActive) return sideChatSourceTitle ? `Ask in side chat for “${sideChatSourceTitle}”...` : "Ask in side chat...";
  return threadName ? `Ask Codex in “${threadName}”...` : "Ask Codex...";
}

export function ChatPanelComposer({
  model,
  presenter,
  actions,
}: {
  model: ChatPanelComposerModel;
  presenter: ChatPanelComposerPresenter;
  actions: ChatPanelComposerActions;
}): UiNode {
  return h(ComposerShell, presenter.renderState(model, actions));
}

export function chatPanelComposerProjection(
  model: ChatPanelComposerModel,
  actions: ChatPanelComposerProjectionActions,
): ChatPanelComposerProjection {
  const snapshot = runtimeSnapshotForChatSlices({
    runtimeConfig: model.runtimeConfig,
    activeThread: { id: model.activeThreadId, tokenUsage: model.activeThreadTokenUsage },
    runtime: model.runtime,
    rateLimit: model.rateLimit,
    hasThreadTurns: model.hasThreadTurns,
    availableModels: model.availableModels,
  });
  return {
    placeholder: model.activeThreadSubagent
      ? "Agent thread is read-only."
      : composerPlaceholder(activeComposerThreadName(model), model.sideChatActive, model.sideChatSourceTitle),
    meta: {
      ...composerMetaViewModel(model, snapshot),
      ...runtimeComposerChoices({
        model,
        snapshot,
        requestModel: (model) => void actions.requestModel(model),
        requestReasoningEffort: (effort) => void actions.requestReasoningEffort(effort),
      }),
    },
  };
}

function composerMetaViewModel(
  model: ChatPanelComposerModel,
  snapshot: RuntimeSnapshot,
): Omit<ChatPanelComposerMeta, "modelChoices" | "effortChoices"> {
  const phase = model.connectionPhase;
  if (phase.kind === "failed" || phase.kind === "disconnected") {
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

  const config = runtimeConfigOrDefault(model.runtimeConfig);
  const resolution = resolveRuntimeControls(snapshot, config);
  const context = contextSummary(snapshot);
  const selectedModel = resolution.model.effective;
  const effort = resolution.reasoningEffort.effective;
  const composerContext = contextComposerMeter(context?.percent ?? emptyThreadContextPercent(snapshot));
  const compactEffort = effort ? compactReasoningEffortLabel(effort) : null;
  const planActive = resolution.collaborationMode.effective === "plan";
  const reviewActive = resolution.autoReview.active;
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
    fastActive,
  };
}

function emptyThreadContextPercent(snapshot: RuntimeSnapshot): number | null {
  return snapshot.activeThreadId ? null : 0;
}

function runtimeComposerChoices(input: RuntimeComposerChoicesInput): {
  modelChoices: ChatPanelComposerRuntimeChoice[];
  effortChoices: ChatPanelComposerRuntimeChoice[];
} {
  const config = runtimeConfigOrDefault(input.model.runtimeConfig);
  const resolution = resolveRuntimeControls(input.snapshot, config);
  const effectiveModel = resolution.model.effective;
  const models = sortedModelMetadata(input.model.availableModels);
  const modelChoices: ChatPanelComposerRuntimeChoice[] = models.slice(0, 12).map((model) => ({
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
  const effortChoices: ChatPanelComposerRuntimeChoice[] = resolution.supportedReasoningEfforts.map((effort) => ({
    label: effort,
    selected: activeEffort === effort,
    onClick: () => {
      input.requestReasoningEffort(effort);
    },
  }));

  return { modelChoices, effortChoices };
}

function composerStatusSummary(input: {
  context: ChatPanelComposerContextMeter;
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

function activeComposerThreadName(model: ChatPanelComposerModel): string | null {
  return model.activeThreadId ? model.activeListedThreadName : null;
}

const CONTEXT_DOT_WIDTH = 4;
const CONTEXT_CELL_PERCENT = 100 / CONTEXT_DOT_WIDTH;
const CONTEXT_PARTIAL_DOTS = ["", "⣀", "⣤", "⣶", "⣿"] as const;
const CONTEXT_FULL_DOT = "⣿";
const CONTEXT_EMPTY_DOT = "⣀";

function contextComposerMeter(percent: number | null): ChatPanelComposerContextMeter {
  const percentLabel = percent === null ? "--%" : `${String(Math.round(Math.max(0, Math.min(100, percent)))).padStart(2, " ")}%`;
  return {
    cells: contextBrailleCells(percent),
    percent: percentLabel,
  };
}

function contextBrailleCells(percent: number | null): ChatPanelComposerContextMeterCell[] {
  if (percent === null) return Array.from({ length: CONTEXT_DOT_WIDTH }, () => ({ text: CONTEXT_EMPTY_DOT, placeholder: true }));
  const clamped = Math.max(0, Math.min(100, percent));
  const cells: ChatPanelComposerContextMeterCell[] = [];
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
