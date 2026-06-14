// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { PendingRequestBlockSnapshot } from "../../../../../src/features/chat/presentation/pending-requests/snapshot";
import { pendingApprovalViewModel } from "../../../../../src/features/chat/presentation/pending-requests/view-model";
import type { PendingApproval, PendingUserInput } from "../../../../../src/features/chat/domain/pending-requests/model";
import type { PendingRequestBlockContext } from "../../../../../src/features/chat/ui/message-stream/context";
import type { MessageStreamItem } from "../../../../../src/features/chat/domain/message-stream/items";
import { changeInputValue } from "../../../../support/dom";
import "./setup";
import {
  actEvent,
  dispatchComposingInputValue,
  emptyDisclosures,
  expectPresent,
  idleTurnLifecycle,
  messageStreamBlocks,
  pendingApproval,
  pendingFreeformUserInput,
  pendingOtherUserInput,
  pendingRequestActions,
  pendingUserInput,
  renderMessageBlockElement,
  renderMessageStreamBlocksInAct,
  renderPendingRequestNode,
  setNativeInputValue,
  unmountUiRootInAct,
} from "./test-helpers";

describe("pending request renderer decisions", () => {
  it("renders pending requests as one message-stream block and keeps user input drafts live", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const resolveUserInput = vi.fn();
    const input = pendingUserInput();

    renderPendingRequestNode(
      parent,
      [],
      [input],
      {
        values: drafts,
        draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
        otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
      },
      new Set(),
      pendingRequestActions({ resolveUserInput }),
    );

    expect(parent.querySelectorAll(".codex-panel__pending-request-block")).toHaveLength(1);
    expect(parent.querySelector(".codex-panel__pending-request-block")?.classList.contains("codex-panel__work-message")).toBe(true);
    expect(parent.querySelector(".codex-panel__pending-request-block")?.classList.contains("codex-panel__work-message--warning")).toBe(
      true,
    );
    expect(parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button.mod-cta")?.textContent).toBe("Submit");
    expect(parent.querySelector(".codex-panel__user-input-answer .codex-panel__user-input-radio")).not.toBeNull();
    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-radio")?.checked).toBe(true);
    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-radio")?.type).toBe("radio");
    expect(parent.querySelector(".codex-panel__user-input-marker")).toBeNull();
    actEvent(() => {
      parent.querySelector<HTMLButtonElement>(".mod-cta")?.click();
    });
    expect(resolveUserInput).toHaveBeenCalledWith(input.requestId);
  });

  it("selects the other Plan mode answer from controlled drafts", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const input = pendingOtherUserInput();
    const draftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}`;
    const otherDraftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}:other`;
    const actions = pendingRequestActions({
      setUserInputDraft: vi.fn((key: string, value: string) => {
        drafts.set(key, value);
      }),
    });
    const render = () => {
      renderPendingRequestNode(parent, [], [input], { values: drafts, draftKey, otherDraftKey }, new Set(), actions);
    };

    render();
    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")?.getAttribute("aria-label")).toBeNull();
    actEvent(() => {
      changeInputValue(expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")), "Custom scope");
    });

    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope:other", "Custom scope");
    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope", "Custom scope");

    render();
    const radios = [...parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio")];
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
  });

  it("keeps the other Plan mode radio selected when the custom answer is empty", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const input = pendingOtherUserInput();
    const draftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}`;
    const otherDraftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}:other`;
    const actions = pendingRequestActions({
      setUserInputDraft: vi.fn((key: string, value: string) => {
        drafts.set(key, value);
      }),
    });
    const render = () => {
      renderPendingRequestNode(parent, [], [input], { values: drafts, draftKey, otherDraftKey }, new Set(), actions);
    };

    render();
    const radios = [...parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio")];
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);

    actEvent(() => {
      expectPresent(radios.at(1)).click();
    });

    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope", "");

    render();
    const rerenderedRadios = [...parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio")];
    expect(rerenderedRadios.map((radio) => radio.checked)).toEqual([false, true]);
  });

  it("keeps unselected other Plan mode text out of tab order", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const input = pendingOtherUserInput();
    const draftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}`;
    const otherDraftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}:other`;
    const actions = pendingRequestActions({
      setUserInputDraft: vi.fn((key: string, value: string) => {
        drafts.set(key, value);
      }),
    });
    const render = () => {
      renderPendingRequestNode(parent, [], [input], { values: drafts, draftKey, otherDraftKey }, new Set(), actions);
    };

    render();

    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")?.tabIndex).toBe(-1);

    actEvent(() => {
      expectPresent(parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio").item(1)).click();
    });
    render();

    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")?.tabIndex).toBe(0);
  });

  it("does not commit other Plan mode IME preedit text as the answer", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const input = pendingOtherUserInput();
    const draftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}`;
    const otherDraftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}:other`;
    const actions = pendingRequestActions({
      setUserInputDraft: vi.fn((key: string, value: string) => {
        drafts.set(key, value);
      }),
    });

    renderPendingRequestNode(parent, [], [input], { values: drafts, draftKey, otherDraftKey }, new Set(), actions);
    const otherInput = expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text"));

    actEvent(() => {
      otherInput.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      dispatchComposingInputValue(otherInput, "にほん");
    });

    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope", "");
    expect(actions.setUserInputDraft).not.toHaveBeenCalledWith("99:scope:other", "にほん");
    expect(actions.setUserInputDraft).not.toHaveBeenCalledWith("99:scope", "にほん");

    setNativeInputValue(otherInput, "日本");
    actEvent(() => {
      otherInput.dispatchEvent(new Event("compositionend", { bubbles: true }));
    });

    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope:other", "日本");
    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope", "日本");
  });

  it("renders pending approvals and Plan mode questions in the same request block", () => {
    const parent = document.createElement("div");
    const approval = pendingApproval();
    const input = pendingUserInput();

    renderPendingRequestNode(
      parent,
      [approval],
      [input],
      {
        values: new Map(),
        draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
        otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
      },
      new Set(),
      pendingRequestActions(),
    );

    expect(parent.querySelectorAll(".codex-panel__pending-request-block")).toHaveLength(1);
    expect(parent.querySelectorAll(".codex-panel__pending-request-card")).toHaveLength(2);
    expect(parent.querySelectorAll(".codex-panel__pending-request-body")).toHaveLength(2);
    expect(parent.querySelector(".codex-panel__approval-body")).toBeNull();
    expect(parent.querySelector(".codex-panel__approval .codex-panel__pending-request-title")?.textContent).toBe("Permission approval");
    expect(parent.querySelector(".codex-panel__approval .codex-panel__pending-request-body")?.textContent).toContain("Need network");
    expect(parent.querySelector(".codex-panel__approval-details summary")?.textContent).toBe("Request details");
    expect(parent.querySelector<HTMLElement>(".codex-panel__approval-details summary")?.tabIndex).toBe(-1);
    expect(parent.querySelector(".codex-panel__user-input .codex-panel__pending-request-title")?.textContent).toBe("Codex needs input");
    expect([...parent.querySelectorAll(".codex-panel__pending-request-button")].map((button) => button.textContent)).toEqual([
      "Allow",
      "Allow session",
      "Deny",
      "Cancel",
      "Submit",
      "Cancel",
    ]);
  });

  it("focuses Plan mode input when pending requests ask for autofocus", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const input = pendingFreeformUserInput();

    try {
      renderPendingRequestNode(
        parent,
        [pendingApproval()],
        [input],
        {
          values: new Map(),
          draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
          otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
        },
        new Set(),
        pendingRequestActions(),
        true,
      );

      const inputElement = parent.querySelector<HTMLInputElement>(".codex-panel__user-input-text");
      expect(inputElement?.getAttribute("aria-label")).toBeNull();
      expect(document.activeElement).toBe(inputElement);
    } finally {
      unmountUiRootInAct(parent);
      parent.remove();
    }
  });

  it("focuses the selected Plan mode option before the other text field", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const input = pendingOtherUserInput();

    try {
      renderPendingRequestNode(
        parent,
        [],
        [input],
        {
          values: new Map(),
          draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
          otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
        },
        new Set(),
        pendingRequestActions(),
        true,
      );

      expect(document.activeElement).toBe(parent.querySelector(".codex-panel__user-input-radio:checked"));
      expect(document.activeElement).not.toBe(parent.querySelector(".codex-panel__user-input-other-text"));
    } finally {
      unmountUiRootInAct(parent);
      parent.remove();
    }
  });

  it("focuses the approval action when pending approval asks for autofocus", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    try {
      renderPendingRequestNode(
        parent,
        [pendingApproval()],
        [],
        {
          values: new Map(),
          draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
          otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
        },
        new Set(),
        pendingRequestActions(),
        true,
      );

      expect(document.activeElement).toBe(parent.querySelector(".codex-panel__pending-request-button.mod-cta"));
    } finally {
      unmountUiRootInAct(parent);
      parent.remove();
    }
  });

  it("renders command approval buttons from app-server available decisions", () => {
    const parent = document.createElement("div");
    const approval: PendingApproval = {
      requestId: 43,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        startedAtMs: 1,
        reason: "Needs network",
        networkApprovalContext: { host: "registry.npmjs.org", protocol: "https" },
        command: null,
        cwd: "/vault",
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
        availableDecisions: [
          { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "registry.npmjs.org", action: "allow" } } },
          "decline",
        ],
      },
    };
    const resolveApproval = vi.fn();

    renderPendingRequestNode(
      parent,
      [approval],
      [],
      {
        values: new Map(),
        draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
        otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
      },
      new Set(),
      pendingRequestActions({ resolveApproval }),
    );

    const buttons = [...parent.querySelectorAll<HTMLButtonElement>(".codex-panel__pending-request-button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Allow network rule", "Deny"]);
    const allowButton = buttons.at(0);
    if (!allowButton) throw new Error("Missing allow button");
    actEvent(() => {
      allowButton.click();
    });
    expect(resolveApproval).toHaveBeenCalledWith(approval.requestId, {
      kind: "command-decision",
      decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "registry.npmjs.org", action: "allow" } } },
    });
  });

  it("renders submitted user input separately from approvals", () => {
    const renderMarkdown = vi.fn((parent: HTMLElement, text: string) => parent.createDiv({ text: `markdown:${text}` }));
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "user-input-submitted-1",
          kind: "userInputResult",
          role: "tool",
          text: "Input submitted for 1 question.",
          turnId: "turn",
          executionState: "completed",
          questions: [{ id: "scope", header: "Scope", question: "How broad?", answer: "Narrow" }],
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown,
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("Input");
    expect(element.querySelector(".codex-panel__message-content")?.textContent).toBe("Input submitted for 1 question.");
    expect(element.querySelector(".codex-panel__message-content")?.classList.contains("markdown-rendered")).toBe(false);
    expect(renderMarkdown).not.toHaveBeenCalled();
    expect(element.textContent).not.toContain("Approval");
    expect(element.querySelector("details summary")?.textContent).toBe("Question: Scope");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("AnswerNarrow");
  });

  it("renders manual approval results with completion state and details", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "approval-1",
          kind: "approvalResult",
          role: "tool",
          text: "Allowed for this session: Need access",
          turnId: "turn",
          executionState: "completed",
          approval: {
            status: "allowed for session",
            scope: "session",
            request: "Permission approval",
            auditFacts: [],
          },
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__message--approval-result")).toBe(true);
    expect(element.classList.contains("codex-panel__tool-result")).toBe(true);
    expect(element.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(element.querySelector(".codex-panel__message-content")).toBeNull();
    expect(element.querySelector(".codex-panel__tool-result-header")?.textContent).toBe("approval");
    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("Allowed for this session: Need access");
    expect(element.querySelector("details summary")?.textContent).toBe("approval");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statusallowed for session");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("scopesession");
  });

  it("renders auto-review summaries under the final assistant message", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "review-1",
          kind: "reviewResult",
          role: "tool",
          text: "Auto-review approved: npm test",
          turnId: "turn",
          provenance: { source: "appServer", channel: "notification", event: "autoReview", sourceItemId: "review-1" },
        },
        {
          id: "review-2",
          kind: "reviewResult",
          role: "tool",
          text: "Auto-review approved: npm test",
          turnId: "turn",
          provenance: { source: "appServer", channel: "notification", event: "autoReview", sourceItemId: "review-2" },
        },
        {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          messageKind: "assistantResponse",
          messageState: "completed",
          text: "Done",
          turnId: "turn",
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    });
    const block = blocks.find((candidate) => candidate.key === "item:assistant-1");
    if (!block) throw new Error("Expected assistant block");

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__auto-reviews summary")?.textContent).toBe("Auto-reviewed 2 requests");
    expect(element.querySelector(".codex-panel__auto-reviews")?.textContent).toContain("Auto-review approved: npm test");
  });

  it("adds pending requests to the bottom of message stream blocks", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      items: [{ id: "a1", kind: "message", role: "assistant", text: "Done", messageKind: "assistantResponse", messageState: "completed" }],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      pendingRequests: pendingRequestContext({
        signature: "request:1",
      }),
    });

    expect(blocks.map((block) => block.key)).toEqual(["item:a1", "pending-requests"]);
    expect(expectPresent(blocks[1]).node).not.toBeUndefined();
  });

  it("does not consume pending request autofocus while building message stream blocks", () => {
    const consumeAutoFocus = vi.fn(() => true);

    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      items: [{ id: "a1", kind: "message", role: "assistant", text: "Done", messageKind: "assistantResponse", messageState: "completed" }],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      pendingRequests: pendingRequestContext({
        signature: "request:1",
        consumeAutoFocus,
      }),
    });

    expect(blocks.map((block) => block.key)).toEqual(["item:a1", "pending-requests"]);
    expect(consumeAutoFocus).not.toHaveBeenCalled();
  });

  it("consumes pending request autofocus when the pending block is mounted", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const consumeAutoFocus = vi.fn(() => true);

    try {
      renderMessageStreamBlocksInAct(
        parent,
        messageStreamBlocks({
          activeThreadId: "thread",
          turnLifecycle: idleTurnLifecycle(),
          historyCursor: null,
          loadingHistory: false,
          items: [
            { id: "a1", kind: "message", role: "assistant", text: "Done", messageKind: "assistantResponse", messageState: "completed" },
          ],
          disclosures: emptyDisclosures(),
          forkActionsItemId: null,
          loadOlderTurns: vi.fn(),
          renderMarkdown: (element, text) => element.createDiv({ text }),
          pendingRequests: pendingRequestContext({
            signature: "approval:1",
            snapshot: emptyPendingRequestBlockSnapshot({ approvals: [pendingApprovalViewModel(pendingApproval())] }),
            consumeAutoFocus,
          }),
        }),
      );

      expect(consumeAutoFocus).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(parent.querySelector(".codex-panel__pending-request-button.mod-cta"));
    } finally {
      unmountUiRootInAct(parent);
      parent.remove();
    }
  });

  it("does not build pending request nodes when no pending block is inserted", () => {
    const pendingSnapshot = vi.fn(() => emptyPendingRequestBlockSnapshot());
    const consumeAutoFocus = vi.fn(() => true);

    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      items: [],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      pendingRequests: pendingRequestContext({
        signature: "request:1",
        snapshot: pendingSnapshot,
        consumeAutoFocus,
      }),
    });

    expect(blocks.map((block) => block.key)).toEqual(["empty"]);
    expect(pendingSnapshot).not.toHaveBeenCalled();
    expect(consumeAutoFocus).not.toHaveBeenCalled();
  });

  it("removes pending request blocks when the signature clears", () => {
    const parent = document.createElement("div");
    const baseContext = {
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      items: [
        { id: "a1", kind: "message", role: "assistant", text: "Done", messageKind: "assistantResponse", messageState: "completed" },
      ] satisfies MessageStreamItem[],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (element: HTMLElement, text: string) => element.createDiv({ text }),
    };

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        ...baseContext,
        pendingRequests: pendingRequestContext({
          signature: "request:1",
          snapshot: emptyPendingRequestBlockSnapshot({ approvals: [pendingApprovalViewModel(pendingApproval())] }),
        }),
      }),
    );
    expect(parent.querySelector('[data-codex-panel-block-key="pending-requests"]')).not.toBeNull();

    renderMessageStreamBlocksInAct(parent, messageStreamBlocks(baseContext));

    expect(parent.querySelector('[data-codex-panel-block-key="pending-requests"]')).toBeNull();
    expect(parent.querySelector('[data-codex-panel-block-key="item:a1"]')).not.toBeNull();
    unmountUiRootInAct(parent);
  });
});

function pendingRequestContext(options: {
  signature: string;
  snapshot?: PendingRequestBlockSnapshot | (() => PendingRequestBlockSnapshot);
  actions?: ReturnType<typeof pendingRequestActions>;
  consumeAutoFocus?: () => boolean;
}): PendingRequestBlockContext {
  const snapshot = options.snapshot;
  const snapshotFn =
    typeof snapshot === "function" ? (snapshot as () => PendingRequestBlockSnapshot) : () => snapshot ?? emptyPendingRequestBlockSnapshot();
  return {
    signature: options.signature,
    snapshot: snapshotFn,
    actions: () => options.actions ?? pendingRequestActions(),
    consumeAutoFocus: options.consumeAutoFocus ?? (() => false),
  };
}

function emptyPendingRequestBlockSnapshot(overrides: Partial<PendingRequestBlockSnapshot> = {}): PendingRequestBlockSnapshot {
  return {
    approvals: [],
    pendingUserInputs: [],
    userInputDrafts: new Map(),
    approvalDetails: new Set(),
    ...overrides,
  };
}
