import { runtimeSnapshotForChatState } from "../../application/runtime/snapshot";
import type { ChatState } from "../../application/state/root-reducer";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import type { ToolbarStatusRow as DiagnosticRow } from "../../ui/toolbar-model";
import { appServerDiagnosticSections } from "./diagnostics";
import { runtimePermissionSections } from "./permissions";
import {
  effortStatusDetails as buildEffortStatusDetails,
  modelStatusDetails as buildModelStatusDetails,
  statusDetails as buildStatusDetails,
} from "./status";
import { toolInventoryDiagnosticSections } from "./tool-inventory";

export interface ChatPanelRuntimeNotices {
  connectionDiagnosticDetails: () => ThreadStreamNoticeSection[];
  permissionDetails: () => ThreadStreamNoticeSection[];
  modelStatusDetails: () => ThreadStreamNoticeSection[];
  effortStatusDetails: () => ThreadStreamNoticeSection[];
  statusDetails: () => ThreadStreamNoticeSection[];
  toolInventoryDetails: () => ThreadStreamNoticeSection[];
}

interface ChatPanelRuntimeNoticesInput {
  state: () => ChatState;
  connected: () => boolean;
  configuredCommand: () => string;
  vaultPath: () => string;
}

export function createChatPanelRuntimeNotices(input: ChatPanelRuntimeNoticesInput): ChatPanelRuntimeNotices {
  return {
    connectionDiagnosticDetails: () => connectionDiagnosticDetails(input),
    permissionDetails: () => permissionDetails(input),
    modelStatusDetails: () => modelStatusDetails(input),
    effortStatusDetails: () => effortStatusDetails(input),
    statusDetails: () => statusDetails(input),
    toolInventoryDetails: () => toolInventoryDetails(input),
  };
}

function statusDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  return noticeSectionsFromRows(
    buildStatusDetails({
      snapshot: runtimeSnapshot(state),
      nowMs: Date.now(),
    }),
  );
}

function modelStatusDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  const snapshot = runtimeSnapshot(state);
  return noticeSectionsFromRows(buildModelStatusDetails(snapshot));
}

function effortStatusDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  return noticeSectionsFromRows(buildEffortStatusDetails(runtimeSnapshot(state)));
}

function connectionDiagnosticDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  const sections = appServerDiagnosticSections({
    connected: input.connected(),
    configuredCommand: input.configuredCommand(),
    initializeResponse: state.connection.initializeResponse,
    diagnostics: state.connection.serverDiagnostics,
  });
  return noticeSectionsFromDiagnostics(sections);
}

function toolInventoryDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  return noticeSectionsFromDiagnostics(toolInventoryDiagnosticSections(input.state().connection.serverDiagnostics));
}

function permissionDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
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

function noticeSectionsFromRows(rows: readonly DiagnosticRow[]): ThreadStreamNoticeSection[] {
  return [{ auditFacts: rows.map((row) => ({ key: row.label, value: row.value })) }];
}

function runtimeSnapshot(state: ChatState): RuntimeSnapshot {
  return runtimeSnapshotForChatState(state);
}
