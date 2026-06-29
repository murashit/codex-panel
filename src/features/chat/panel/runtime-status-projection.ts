import { appServerDiagnosticSections } from "../application/connection/diagnostic-sections";
import { toolInventoryDiagnosticSections } from "../application/connection/tool-inventory-diagnostic-sections";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import type { ChatState } from "../application/state/root-reducer";
import type { MessageStreamNoticeSection } from "../domain/message-stream/items";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../domain/runtime/labels";
import type { RuntimeSnapshot } from "../domain/runtime/snapshot";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "../presentation/runtime/status";

export interface ChatPanelRuntimeProjection {
  connectionDiagnosticDetails: () => MessageStreamNoticeSection[];
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
  statusSummaryLines: () => string[];
  toolInventoryDetails: () => MessageStreamNoticeSection[];
}

interface ChatPanelRuntimeProjectionInput {
  state: () => ChatState;
  connected: () => boolean;
  configuredCommand: () => string;
  nowMs: () => number;
}

export function createChatPanelRuntimeProjection(input: ChatPanelRuntimeProjectionInput): ChatPanelRuntimeProjection {
  return {
    connectionDiagnosticDetails: () => connectionDiagnosticDetails(input),
    modelStatusLines: () => modelStatusLines(input),
    effortStatusLines: () => effortStatusLines(input),
    statusSummaryLines: () => statusSummaryLines(input),
    toolInventoryDetails: () => toolInventoryDetails(input),
  };
}

function statusSummaryLines(input: ChatPanelRuntimeProjectionInput): string[] {
  const state = input.state();
  return buildStatusSummaryLines({
    activeThreadId: state.activeThread.id,
    snapshot: runtimeSnapshot(state),
    nowMs: input.nowMs(),
  });
}

function modelStatusLines(input: ChatPanelRuntimeProjectionInput): string[] {
  const state = input.state();
  return buildModelStatusLines({
    runtimeConfig: state.connection.runtimeConfig,
    pendingModel: state.runtime.pending.model,
    snapshot: runtimeSnapshot(state),
    collaborationModeLabel: collaborationModeLabel(state),
  });
}

function effortStatusLines(input: ChatPanelRuntimeProjectionInput): string[] {
  const state = input.state();
  return buildEffortStatusLines({
    runtimeConfig: state.connection.runtimeConfig,
    pendingReasoningEffort: state.runtime.pending.reasoningEffort,
    snapshot: runtimeSnapshot(state),
  });
}

function connectionDiagnosticDetails(input: ChatPanelRuntimeProjectionInput): MessageStreamNoticeSection[] {
  const state = input.state();
  const sections = appServerDiagnosticSections({
    connected: input.connected(),
    configuredCommand: input.configuredCommand(),
    initializeResponse: state.connection.initializeResponse,
    diagnostics: state.connection.serverDiagnostics,
  });
  return noticeSectionsFromDiagnostics(sections);
}

function toolInventoryDetails(input: ChatPanelRuntimeProjectionInput): MessageStreamNoticeSection[] {
  return noticeSectionsFromDiagnostics(toolInventoryDiagnosticSections(input.state().connection.serverDiagnostics));
}

function noticeSectionsFromDiagnostics(
  sections: readonly { title: string; rows: readonly { label: string; value: string }[] }[],
): MessageStreamNoticeSection[] {
  return sections.map((section) => ({
    title: section.title,
    auditFacts: section.rows.map((row) => ({ key: row.label, value: row.value })),
  }));
}

function collaborationModeLabel(state: ChatState): string {
  return formatCollaborationModeLabel(state.runtime.pending.collaborationMode);
}

function runtimeSnapshot(state: ChatState): RuntimeSnapshot {
  return runtimeSnapshotForChatState(state);
}
