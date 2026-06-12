import { describe, expect, it, vi } from "vitest";

import { createChatState, type ChatAction } from "../../../../../src/features/chat/state/reducer";
import { createMessageStreamContextPort } from "../../../../../src/features/chat/ui/message-stream/ports";

describe("message stream context port", () => {
  it("closes other fork action details before opening a fork action detail", () => {
    const state = createChatState();
    state.ui.openDetails = new Set(["message:fork-actions:old", "message:u1:expanded"]);
    const dispatched: ChatAction[] = [];

    const port = createMessageStreamContextPort({
      vaultPath: "/vault",
      state: () => state,
      dispatch: (action) => {
        dispatched.push(action);
      },
      loadOlderTurns: vi.fn(),
      renderMarkdown: vi.fn(),
      copyMessageText: vi.fn(),
      actions: {
        rollbackThread: vi.fn(),
        forkThreadFromTurn: vi.fn(),
        implementPlan: vi.fn(),
        openTurnDiff: vi.fn(),
      },
      requests: {
        pendingSignature: () => "",
        pendingSnapshot: () => ({ approvals: [], pendingUserInputs: [], userInputDrafts: new Map(), openDetails: new Set() }),
        pendingActions: () => ({
          resolveApproval: vi.fn(),
          resolveUserInput: vi.fn(),
          cancelUserInput: vi.fn(),
          setUserInputDraft: vi.fn(),
        }),
        consumePendingAutoFocus: () => false,
      },
    });

    port.setOpenDetail("message:fork-actions:new", true);

    expect(dispatched).toEqual([
      { type: "ui/detail-open-set", key: "message:fork-actions:old", open: false },
      { type: "ui/detail-open-set", key: "message:fork-actions:new", open: true },
    ]);
  });

  it("does not close fork action details when opening other message details", () => {
    const state = createChatState();
    state.ui.openDetails = new Set(["message:fork-actions:old"]);
    const dispatched: ChatAction[] = [];

    const port = createMessageStreamContextPort({
      vaultPath: "/vault",
      state: () => state,
      dispatch: (action) => {
        dispatched.push(action);
      },
      loadOlderTurns: vi.fn(),
      renderMarkdown: vi.fn(),
      copyMessageText: vi.fn(),
      actions: {
        rollbackThread: vi.fn(),
        forkThreadFromTurn: vi.fn(),
        implementPlan: vi.fn(),
        openTurnDiff: vi.fn(),
      },
      requests: {
        pendingSignature: () => "",
        pendingSnapshot: () => ({ approvals: [], pendingUserInputs: [], userInputDrafts: new Map(), openDetails: new Set() }),
        pendingActions: () => ({
          resolveApproval: vi.fn(),
          resolveUserInput: vi.fn(),
          cancelUserInput: vi.fn(),
          setUserInputDraft: vi.fn(),
        }),
        consumePendingAutoFocus: () => false,
      },
    });

    port.setOpenDetail("message:u1:expanded", true);

    expect(dispatched).toEqual([{ type: "ui/detail-open-set", key: "message:u1:expanded", open: true }]);
  });
});
