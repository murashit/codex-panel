import { describe, expect, it, vi } from "vitest";

import type { ChatAction } from "../../../../../src/features/chat/state/reducer";
import { createMessageStreamContextPort } from "../../../../../src/features/chat/panel/surface/message-stream-ports";

describe("message stream context port", () => {
  it("sets the active fork action item explicitly", () => {
    const dispatched: ChatAction[] = [];

    const port = createMessageStreamContextPort({
      vaultPath: "/vault",
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
        pendingSnapshot: () => ({ approvals: [], pendingUserInputs: [], userInputDrafts: new Map(), approvalDetails: new Set() }),
        pendingActions: () => ({
          resolveApproval: vi.fn(),
          resolveUserInput: vi.fn(),
          cancelUserInput: vi.fn(),
          setUserInputDraft: vi.fn(),
        }),
        consumePendingAutoFocus: () => false,
      },
    });

    port.setForkActionsItem("new");

    expect(dispatched).toEqual([{ type: "ui/message-fork-actions-set", itemId: "new" }]);
  });

  it("sets typed disclosure bucket entries", () => {
    const dispatched: ChatAction[] = [];

    const port = createMessageStreamContextPort({
      vaultPath: "/vault",
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
        pendingSnapshot: () => ({ approvals: [], pendingUserInputs: [], userInputDrafts: new Map(), approvalDetails: new Set() }),
        pendingActions: () => ({
          resolveApproval: vi.fn(),
          resolveUserInput: vi.fn(),
          cancelUserInput: vi.fn(),
          setUserInputDraft: vi.fn(),
        }),
        consumePendingAutoFocus: () => false,
      },
    });

    port.setDisclosureOpen("userMessageExpanded", "u1", true);

    expect(dispatched).toEqual([{ type: "ui/disclosure-set", bucket: "userMessageExpanded", id: "u1", open: true }]);
  });
});
