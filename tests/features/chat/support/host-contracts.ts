import { vi } from "vitest";
import type { CodexChatHost, WorkspacePanels } from "../../../../src/features/chat/host/contracts";

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

export function threadReplacementPublicationFixture(): CodexChatHost["threadReplacementPublication"] {
  return {
    visibleThreadId: vi.fn((_threads, threadId) => threadId),
  };
}

export function forkReplacementFixture(): CodexChatHost["forkReplacement"] {
  return {
    beginPublication: vi.fn(() => ({ attach: vi.fn(), finish: vi.fn() })),
    latestTurnId: vi.fn().mockResolvedValue(null),
    archiveSource: vi.fn().mockResolvedValue(true),
    notify: vi.fn(),
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
