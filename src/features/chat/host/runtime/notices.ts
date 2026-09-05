import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import { type MetadataResourceDiagnostics, serverDiagnostics } from "../../../../domain/server/diagnostics";
import type { ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";
import { type ChatRuntimeSharedResources, runtimeSnapshotForChatState } from "../../application/runtime/snapshot";
import { activeThreadId, type ChatState } from "../../application/state/model";
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
  sharedResources: ChatRuntimeSharedResources & {
    metadataDiagnosticsSnapshot(): MetadataResourceDiagnostics;
    skillsSnapshot(): readonly SkillMetadata[] | null;
    toolInventorySnapshot(threadId: string | null): ToolInventorySnapshot | null;
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
      snapshot: runtimeSnapshotForChatState(state, input.sharedResources),
      nowMs: Date.now(),
    }),
  );
}

function modelStatusDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  const snapshot = runtimeSnapshotForChatState(state, input.sharedResources);
  return noticeSectionsFromRows(buildModelStatusDetails(snapshot));
}

function effortStatusDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  return noticeSectionsFromRows(buildEffortStatusDetails(runtimeSnapshotForChatState(state, input.sharedResources)));
}

function connectionDiagnosticDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  const inventory = input.sharedResources.toolInventorySnapshot(activeThreadId(state));
  const sections = appServerDiagnosticSections({
    connected: input.connected(),
    configuredCommand: input.configuredCommand(),
    initializeResponse: state.connection.initializeResponse,
    diagnostics: serverDiagnostics(input.sharedResources.metadataDiagnosticsSnapshot(), inventory?.mcpDiagnostics ?? []),
  });
  return noticeSectionsFromDiagnostics(sections);
}

function toolInventoryDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const metadataDiagnostics = input.sharedResources.metadataDiagnosticsSnapshot();
  return noticeSectionsFromDiagnostics(
    toolInventoryDiagnosticSections(input.sharedResources.toolInventorySnapshot(activeThreadId(input.state())), {
      value: input.sharedResources.skillsSnapshot() ?? [],
      probe: metadataDiagnostics.probes.skills,
    }),
  );
}

function permissionDetails(input: ChatPanelRuntimeNoticesInput): ThreadStreamNoticeSection[] {
  const state = input.state();
  return noticeSectionsFromDiagnostics(
    runtimePermissionSections({
      snapshot: runtimeSnapshotForChatState(state, input.sharedResources),
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
