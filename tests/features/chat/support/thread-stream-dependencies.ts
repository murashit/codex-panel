import { vi } from "vitest";
import type { ChatThreadStreamDependencies } from "../../../../src/features/chat/host/thread-stream/view-projection";

export function threadStreamActionsFixture() {
  return {
    rollbackThread: vi.fn(),
    forkThreadFromTurn: vi.fn(),
    implementPlan: vi.fn(),
    openThreadInAvailableView: vi.fn(),
    openThreadInNewView: vi.fn(),
    openTurnDiff: vi.fn(),
  };
}

export function serverRequestActionsFixture() {
  return {
    resolveApproval: vi.fn(),
    resolveUserInput: vi.fn(),
    skipUserInput: vi.fn(),
    cancelUserInput: vi.fn(),
    resolveMcpElicitation: vi.fn(),
    setApprovalDetailsExpanded: vi.fn(),
    setUserInputDraft: vi.fn(),
    setMcpElicitationDraft: vi.fn(),
  };
}

export function threadStreamDependenciesFixture(overrides: Partial<ChatThreadStreamDependencies> = {}): ChatThreadStreamDependencies {
  return {
    panelId: "test-panel",
    vaultPath: "/vault",
    setDisclosureOpen: vi.fn(),
    setForkMenuItem: vi.fn(),
    loadOlderTurns: vi.fn(),
    renderObsidianMarkdown: vi.fn(),
    renderStreamMarkdown: vi.fn(),
    copyDialogueText: vi.fn(),
    actions: threadStreamActionsFixture(),
    requests: { actions: serverRequestActionsFixture(), consumeAutoFocus: () => false },
    ...overrides,
  };
}
