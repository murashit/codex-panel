import { vi } from "vitest";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import {
  ThreadActivation,
  type ThreadActivationHost,
  type ThreadResumeEffects,
  type ThreadResumeSnapshot,
} from "../../../../src/features/chat/application/threads/activation";
import { HistoryController, type ThreadHistorySource } from "../../../../src/features/chat/application/threads/history-controller";
import { createSystemItem } from "../../../../src/features/chat/domain/thread-stream/factories/system-items";
import { panelThreadFixture } from "../../../support/panel-thread";
import { threadActivationFixture } from "../../../support/thread-activation";

export function resumeSnapshot(threadId: string, overrides: Partial<ThreadResumeSnapshot> = {}): ThreadResumeSnapshot {
  return {
    activation: threadActivationFixture(panelThreadFixture({ id: threadId }), { model: "gpt-test", approvalsReviewer: "user" }),
    rolloutPath: null,
    activeTurnId: null,
    initialHistoryPage: null,
    ...overrides,
  };
}

export function createThreadActivationFixture(overrides: Partial<Omit<ThreadActivationHost, "history">> = {}) {
  const stateStore = overrides.stateStore ?? createChatStateStore();
  const resumeThread = vi.fn<ThreadResumeEffects["resumeThread"]>(async (threadId, adopt) => {
    adopt(resumeSnapshot(threadId));
  });
  const readHistoryPage = vi
    .fn<ThreadHistorySource["readHistoryPage"]>()
    .mockResolvedValue({ items: [], nextCursor: null, hadTurns: false });
  const addSystemMessage = vi.fn((text: string) => {
    stateStore.dispatch({
      type: "thread-stream/system-item-added",
      item: createSystemItem(`system-${addSystemMessage.mock.calls.length}`, text),
    });
  });
  const showLatestPageAtBottom = vi.fn();
  const setThreadTurnPresence = vi.fn();
  const history = new HistoryController({
    stateStore,
    source: { readHistoryPage },
    addSystemMessage: overrides.addSystemMessage ?? addSystemMessage,
    showLatestPageAtBottom,
    setThreadTurnPresence,
  });
  const host: ThreadActivationHost = {
    stateStore,
    history,
    closing: () => false,
    withThreadActivation: async (_threadId, operation) => operation(),
    resetThreadTurnPresence: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
    recordResumedThread: vi.fn(),
    addSystemMessage,
    effects: { resumeThread },
    ensureConnected: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return {
    commands: new ThreadActivation(host),
    host,
    stateStore,
    resumeThread,
    readHistoryPage,
    showLatestPageAtBottom,
    setThreadTurnPresence,
  };
}
