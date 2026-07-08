import { runtimeConfigOrDefault } from "../../../domain/runtime/config";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import type { ChatState } from "../application/state/root-reducer";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../domain/runtime/labels";
import { resolveRuntimeControls } from "../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../domain/runtime/snapshot";
import type { ThreadStreamNoticeSection } from "../domain/thread-stream/items";
import { appServerDiagnosticSections } from "../presentation/runtime/diagnostic-sections";
import { runtimePermissionSections } from "../presentation/runtime/permission-sections";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "../presentation/runtime/status";
import { toolInventoryDiagnosticSections } from "../presentation/runtime/tool-inventory-diagnostic-sections";

export interface ChatPanelRuntimeProjection {
  connectionDiagnosticDetails: () => ThreadStreamNoticeSection[];
  permissionDetails: () => ThreadStreamNoticeSection[];
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
  statusSummaryLines: () => string[];
  toolInventoryDetails: () => ThreadStreamNoticeSection[];
}

interface ChatPanelRuntimeProjectionInput {
  state: () => ChatState;
  connected: () => boolean;
  configuredCommand: () => string;
  vaultPath: () => string;
  nowMs: () => number;
}

export function createChatPanelRuntimeProjection(input: ChatPanelRuntimeProjectionInput): ChatPanelRuntimeProjection {
  return {
    connectionDiagnosticDetails: () => connectionDiagnosticDetails(input),
    permissionDetails: () => permissionDetails(input),
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

function connectionDiagnosticDetails(input: ChatPanelRuntimeProjectionInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  const sections = appServerDiagnosticSections({
    connected: input.connected(),
    configuredCommand: input.configuredCommand(),
    initializeResponse: state.connection.initializeResponse,
    diagnostics: state.connection.serverDiagnostics,
  });
  return noticeSectionsFromDiagnostics(sections);
}

function toolInventoryDetails(input: ChatPanelRuntimeProjectionInput): ThreadStreamNoticeSection[] {
  return noticeSectionsFromDiagnostics(toolInventoryDiagnosticSections(input.state().connection.serverDiagnostics));
}

function permissionDetails(input: ChatPanelRuntimeProjectionInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  return noticeSectionsFromDiagnostics(
    runtimePermissionSections({
      snapshot: runtimeSnapshot(state),
      vaultPath: input.vaultPath(),
    }),
  );
}

function noticeSectionsFromDiagnostics(
  sections: readonly { title: string; rows: readonly { label: string; value: string }[] }[],
): ThreadStreamNoticeSection[] {
  return sections.map((section) => ({
    title: section.title,
    auditFacts: section.rows.map((row) => ({ key: row.label, value: row.value })),
  }));
}

function collaborationModeLabel(state: ChatState): string {
  const snapshot = runtimeSnapshot(state);
  return formatCollaborationModeLabel(
    resolveRuntimeControls(snapshot, runtimeConfigOrDefault(snapshot.runtimeConfig)).collaborationMode.effective,
  );
}

function runtimeSnapshot(state: ChatState): RuntimeSnapshot {
  return runtimeSnapshotForChatState(state);
}
