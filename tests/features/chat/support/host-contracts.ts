import { vi } from "vitest";
import type { CodexChatHost, WorkspacePanels } from "../../../../src/features/chat/host/contracts";
import { createServerDiagnostics } from "../../../support/runtime-diagnostics";

export function disconnectedChatLeaseFixture(): ReturnType<CodexChatHost["appServerConnection"]["createLease"]> {
  return {
    connect: vi.fn().mockResolvedValue({ codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "macos", userAgent: "codex-test" }),
    currentClient: () => null,
    updateThreadSubscriptions: vi.fn(),
    recordThreadSubscription: vi.fn(),
    withThreadActivation: async (_threadId, operation) => operation(),
    isConnected: () => false,
    disconnect: vi.fn(),
  };
}

export function threadGoalQueriesFixture(): CodexChatHost["threadGoalQueries"] {
  return {
    snapshot: vi.fn(() => null),
    observe: vi.fn((_threadId, listener) => {
      listener(null);
      return () => undefined;
    }),
    observeChanges: vi.fn(() => () => undefined),
  };
}

export function threadCatalogPublicationFixture(): Pick<CodexChatHost["threadCatalog"], "beginReplacement" | "visibleThreadId"> {
  return {
    beginReplacement: vi.fn(() => ({ attach: vi.fn(), finish: vi.fn() })),
    visibleThreadId: vi.fn((_threads, threadId) => threadId),
  };
}

export function threadTitlePortFixture(): CodexChatHost["threadTitlePort"] {
  return { persistedContext: vi.fn().mockResolvedValue(null), generateTitle: vi.fn().mockResolvedValue(null) };
}

export function workspacePanelsFixture(overrides: Partial<WorkspacePanels> = {}): WorkspacePanels {
  return {
    returnFromForkDraft: vi.fn().mockResolvedValue(true),
    openForkDraft: vi.fn(),
    openThreadInNewView: vi.fn(),
    openThreadInAvailableView: vi.fn(),
    openThreadFromPanel: vi.fn(),
    openTurnDiff: vi.fn(),
    notifyPanelActivityChanged: vi.fn(),
    ...overrides,
  };
}

export function appServerQueriesFixture(overrides: Partial<CodexChatHost["appServerQueries"]> = {}): CodexChatHost["appServerQueries"] {
  return {
    modelsResourceSnapshot: vi.fn(() => ({ id: "models" as const, value: undefined, probe: createServerDiagnostics().probes.models })),
    observeModelsResource: vi.fn(() => () => undefined),
    fetchModels: vi.fn().mockResolvedValue([]),
    metadataSnapshot: vi.fn(() => null),
    metadataDiagnosticsSnapshot: vi.fn(() => createServerDiagnostics()),
    ensureAppServerMetadata: vi.fn().mockResolvedValue(undefined),
    refreshAppServerMetadata: vi.fn().mockResolvedValue(undefined),
    observeMetadataResource: vi.fn(() => () => undefined),
    ...overrides,
  };
}
