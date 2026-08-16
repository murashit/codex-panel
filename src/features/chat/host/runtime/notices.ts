import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import { diagnosticsWithMetadataResourceProbes, type MetadataResourceDiagnostics } from "../../../../domain/server/diagnostics";
import { runtimeSnapshotForChatState } from "../../application/runtime/snapshot";
import type { ChatState } from "../../application/state/model";
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
  sharedResources: Parameters<typeof runtimeSnapshotForChatState>[1] & {
    metadataDiagnosticsSnapshot(): MetadataResourceDiagnostics;
    skillsSnapshot(): readonly SkillMetadata[] | null;
  };
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
      snapshot: runtimeSnapshot(state, input.sharedResources),
      nowMs: Date.now(),
    }),
  );
}

function modelStatusDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  const snapshot = runtimeSnapshot(state, input.sharedResources);
  return noticeSectionsFromRows(buildModelStatusDetails(snapshot));
}

function effortStatusDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  return noticeSectionsFromRows(buildEffortStatusDetails(runtimeSnapshot(state, input.sharedResources)));
}

function connectionDiagnosticDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  const sections = appServerDiagnosticSections({
    connected: input.connected(),
    configuredCommand: input.configuredCommand(),
    initializeResponse: state.connection.initializeResponse,
    diagnostics: diagnosticsWithMetadataResourceProbes(
      state.connection.serverDiagnostics,
      input.sharedResources.metadataDiagnosticsSnapshot(),
    ),
  });
  return noticeSectionsFromDiagnostics(sections);
}

function toolInventoryDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const metadataDiagnostics = input.sharedResources.metadataDiagnosticsSnapshot();
  return noticeSectionsFromDiagnostics(
    toolInventoryDiagnosticSections(input.state().connection.serverDiagnostics, {
      value: input.sharedResources.skillsSnapshot() ?? [],
      probe: metadataDiagnostics.probes.skills,
    }),
  );
}

function permissionDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  return noticeSectionsFromDiagnostics(
    runtimePermissionSections({
      snapshot: runtimeSnapshot(state, input.sharedResources),
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

function runtimeSnapshot(state: ChatState, sharedResources: Parameters<typeof runtimeSnapshotForChatState>[1]): RuntimeSnapshot {
  return runtimeSnapshotForChatState(state, sharedResources);
}
