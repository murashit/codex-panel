import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { sortedModelMetadata } from "../../../../domain/catalog/metadata";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import { explicitThreadName } from "../../../../domain/threads/model";
import { compactReasoningEffortLabel } from "../../domain/runtime/labels";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { contextSummary } from "../../presentation/runtime/status";
import { ComposerShell, type ComposerShellProps } from "../../ui/composer";
import { type ChatPanelComposerShellState, composerStateFromShellState, useChatPanelShellState } from "../shell-state";

interface RestoredThreadTitleSnapshot {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}

interface ChatPanelComposerContextMeterCell {
  text: string;
  placeholder: boolean;
}

interface ChatPanelComposerContextMeter {
  cells: ChatPanelComposerContextMeterCell[];
  percent: string;
}

interface ChatPanelComposerRuntimeChoice {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  meta?: string;
  onClick: () => void;
}

interface ChatPanelComposerMeta {
  fatal: string | null;
  context: ChatPanelComposerContextMeter;
  statusSummary: string;
  model: string;
  effort: string | null;
  planActive: boolean;
  autoReviewActive: boolean;
  fastActive: boolean;
  modelChoices?: ChatPanelComposerRuntimeChoice[];
  effortChoices?: ChatPanelComposerRuntimeChoice[];
}

export interface ChatPanelComposerProjection {
  placeholder: string;
  meta: ChatPanelComposerMeta;
}

export interface ChatPanelComposerSurface {
  thread: {
    restoredPlaceholder: () => RestoredThreadTitleSnapshot | null;
  };
  runtime: {
    requestModel: (model: string) => Promise<void>;
    requestReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
  };
}

export interface ChatPanelComposerPresenter {
  renderState(state: ChatPanelComposerShellState, actions: ChatPanelComposerActions): ComposerShellProps;
}

export interface ChatPanelComposerActions {
  submit: () => void;
}

interface RuntimeComposerChoicesInput {
  state: ChatPanelComposerShellState;
  snapshot: RuntimeSnapshot;
  requestModel: (model: string) => void;
  requestReasoningEffort: (effort: ReasoningEffort) => void;
}

function composerPlaceholder(threadName: string | null): string {
  return threadName ? `Ask Codex to work on “${threadName}”...` : "Ask Codex to work on this task...";
}

export function ChatPanelComposer({
  presenter,
  actions,
}: {
  presenter: ChatPanelComposerPresenter;
  actions: ChatPanelComposerActions;
}): UiNode {
  const state = composerStateFromShellState(useChatPanelShellState());
  return h(ComposerShell, presenter.renderState(state, actions));
}

export function chatPanelComposerProjection(
  surface: ChatPanelComposerSurface,
  state: ChatPanelComposerShellState,
): ChatPanelComposerProjection {
  const snapshot = state.runtimeSnapshot;
  return {
    placeholder: composerPlaceholder(activeComposerThreadName(state, surface.thread.restoredPlaceholder())),
    meta: {
      ...composerMetaViewModel(state, snapshot),
      ...runtimeComposerChoices({
        state,
        snapshot,
        requestModel: (model) => void surface.runtime.requestModel(model),
        requestReasoningEffort: (effort) => void surface.runtime.requestReasoningEffort(effort),
      }),
    },
  };
}

function composerMetaViewModel(
  state: ChatPanelComposerShellState,
  snapshot: RuntimeSnapshot,
): Omit<ChatPanelComposerMeta, "modelChoices" | "effortChoices"> {
  if (state.connection.phase.kind === "failed" || state.connection.phase.kind === "disconnected") {
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
  const resolution = resolveRuntimeControls(snapshot, config);
  const context = contextSummary(snapshot);
  const model = resolution.model.effective;
  const effort = resolution.reasoningEffort.effective;
  const composerContext = contextComposerMeter(context?.percent ?? null);
  const compactEffort = effort ? compactReasoningEffortLabel(effort) : null;
  const planActive = resolution.collaborationMode.selected === "plan";
  const reviewActive = resolution.autoReview.active;
  const fastActive = resolution.fastMode.active;
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

function runtimeComposerChoices(input: RuntimeComposerChoicesInput): {
  modelChoices: ChatPanelComposerRuntimeChoice[];
  effortChoices: ChatPanelComposerRuntimeChoice[];
} {
  const config = runtimeConfigOrDefault(input.state.connection.runtimeConfig);
  const resolution = resolveRuntimeControls(input.snapshot, config);
  const effectiveModel = resolution.model.effective;
  const models = sortedModelMetadata(input.state.connection.availableModels);
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

function activeComposerThreadName(state: ChatPanelComposerShellState, restoredThread: RestoredThreadTitleSnapshot | null): string | null {
  const threadId = restoredThread?.threadId ?? state.activeThreadId ?? null;
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
