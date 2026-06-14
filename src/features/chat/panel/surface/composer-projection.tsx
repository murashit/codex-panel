import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import {
  autoReviewActive,
  currentModel,
  currentReasoningEffort,
  fastModeActive,
  runtimeConfigOrDefault,
  supportedReasoningEfforts,
} from "../../domain/runtime/effective";
import { contextSummary } from "../../presentation/runtime/status";
import { compactReasoningEffortLabel } from "../../presentation/runtime/messages";
import { sortedModelMetadata } from "../../../../domain/catalog/metadata";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeSnapshot } from "../../application/runtime/snapshot";
import type { ChatState } from "../../application/state/root-reducer";
import { ComposerShell, type ComposerShellProps } from "../../ui/composer";
import { composerStateFromShellState, useChatPanelShellState, type ChatPanelComposerShellState } from "../shell-state";
import { explicitThreadName } from "../../../../domain/threads/model";
import type {
  ChatPanelComposerContextMeter,
  ChatPanelComposerContextMeterCell,
  ChatPanelComposerMeta,
  ChatPanelComposerProjection,
  ChatPanelComposerRuntimeChoice,
  ChatPanelComposerSurface,
  RestoredThreadTitleSnapshot,
} from "./model";
import { runtimeSnapshotForShellState } from "./runtime-snapshot";

type ComposerMetaState = Pick<ChatState, "connection" | "runtime">;

export interface ChatPanelComposerController {
  renderState(state: ChatPanelComposerShellState, actions: ChatPanelComposerActions): ComposerShellProps;
}

export interface ChatPanelComposerActions {
  submit: () => void;
}

export interface RuntimeComposerChoicesInput {
  state: Pick<ChatState, "connection">;
  snapshot: RuntimeSnapshot;
  requestModel: (model: string) => void;
  requestReasoningEffort: (effort: ReasoningEffort) => void;
  resetReasoningEffortToConfig: () => void;
}

export function composerPlaceholder(threadName: string | null): string {
  return threadName ? `Ask Codex to work on “${threadName}”...` : "Ask Codex to work on this task...";
}

export function ChatPanelComposer({
  controller,
  actions,
}: {
  controller: ChatPanelComposerController;
  actions: ChatPanelComposerActions;
}): UiNode {
  const state = composerStateFromShellState(useChatPanelShellState());
  return h(ComposerShell, controller.renderState(state, actions));
}

export function chatPanelComposerProjection(
  surface: ChatPanelComposerSurface,
  state: ChatPanelComposerShellState,
): ChatPanelComposerProjection {
  const snapshot = runtimeSnapshotForShellState(state);
  return {
    placeholder: composerPlaceholder(activeComposerThreadName(state, surface.thread.restoredPlaceholder())),
    meta: {
      ...composerMetaViewModel(state, snapshot),
      ...runtimeComposerChoices({
        state,
        snapshot,
        requestModel: (model) => void surface.runtime.requestModel(model),
        requestReasoningEffort: (effort) => void surface.runtime.requestReasoningEffort(effort),
        resetReasoningEffortToConfig: () => void surface.runtime.resetReasoningEffortToConfig(),
      }),
    },
  };
}

export function composerMetaViewModel(
  state: ComposerMetaState,
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
  modelChoices: ChatPanelComposerRuntimeChoice[];
  effortChoices: ChatPanelComposerRuntimeChoice[];
} {
  const config = runtimeConfigOrDefault(input.state.connection.runtimeConfig);
  const activeModel = currentModel(input.snapshot, config);
  const models = sortedModelMetadata(input.state.connection.availableModels);
  const modelChoices: ChatPanelComposerRuntimeChoice[] = models.slice(0, 12).map((model) => ({
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
  const effortChoices: ChatPanelComposerRuntimeChoice[] = [
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

function activeComposerThreadName(
  state: Pick<ChatState, "activeThread" | "threadList">,
  restoredThread: RestoredThreadTitleSnapshot | null,
): string | null {
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
