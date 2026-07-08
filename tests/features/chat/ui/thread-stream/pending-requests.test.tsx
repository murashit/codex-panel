// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { PendingApproval, PendingMcpElicitation, PendingUserInput } from "../../../../../src/domain/pending-requests/model";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import {
  type PendingRequestBlockSnapshot,
  pendingRequestBlockSnapshotFromState,
} from "../../../../../src/features/chat/presentation/pending-requests/view-model";
import type { PendingRequestBlockContext } from "../../../../../src/features/chat/ui/thread-stream/context";
import { changeInputValue, textContents } from "../../../../support/dom";
import "./setup";
import {
  actEvent,
  dispatchComposingInputValue,
  expectPresent,
  pendingApproval,
  pendingFreeformUserInput,
  pendingOtherUserInput,
  pendingRequestActions,
  pendingUserInput,
  renderMessageBlockElement,
  renderPendingRequestNode,
  renderThreadStreamBlocksInAct,
  setNativeInputValue,
  threadStreamBlocks,
  unmountUiRootInAct,
} from "./test-helpers";

describe("pending request renderer decisions", () => {
  it("renders pending requests as one thread stream block and keeps user input drafts live", () => {
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
    expect(parent.querySelector(".codex-panel__pending-request-block")?.classList.contains("codex-panel__status-message")).toBe(true);
    expect(parent.querySelector(".codex-panel__pending-request-block")?.classList.contains("codex-panel__status-message--warning")).toBe(
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
    expect(textContents(parent, ".codex-panel__pending-request-button")).toEqual([
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
    const allowResponse = {
      decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "registry.npmjs.org", action: "allow" } } },
    };
    const denyResponse = { decision: "decline" };
    const approval: PendingApproval = {
      requestId: 43,
      kind: "command",
      turnId: "turn",
      title: "Command approval",
      summary: "Needs network",
      resultSummary: "Needs network",
      details: [
        { key: "reason", value: "Needs network" },
        { key: "network", value: "https://registry.npmjs.org" },
      ],
      responses: { accept: {}, acceptSession: {}, decline: denyResponse, cancel: {} },
      actionOptions: [
        {
          id: "approval-option:0:network-allow",
          label: "Allow network rule",
          intent: "accept-session",
          action: { kind: "approval-option", intent: "accept-session", response: allowResponse },
        },
        {
          id: "approval-option:1:decline",
          label: "Deny",
          intent: "decline",
          action: { kind: "approval-option", intent: "decline", response: denyResponse },
        },
      ],
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
    expect(textContents(parent, ".codex-panel__pending-request-button")).toEqual(["Allow network rule", "Deny"]);
    const allowButton = buttons.at(0);
    if (!allowButton) throw new Error("Missing allow button");
    actEvent(() => {
      allowButton.click();
    });
    expect(resolveApproval).toHaveBeenCalledWith(approval.requestId, {
      kind: "approval-option",
      intent: "accept-session",
      response: allowResponse,
    });
  });

  it("renders submitted user input separately from approvals", () => {
    const renderMarkdown = vi.fn((parent: HTMLElement, text: string) => parent.createDiv({ text: `markdown:${text}` }));
    const block = threadStreamBlocks({
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
    const block = threadStreamBlocks({
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
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__message--approval-result")).toBe(true);
    expect(element.classList.contains("codex-panel__detail")).toBe(true);
    expect(element.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(element.querySelector(".codex-panel__message-content")).toBeNull();
    expect(element.querySelector(".codex-panel__detail-header")?.textContent).toBe("approval");
    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("Allowed for this session: Need access");
    expect(element.querySelector("details summary")?.textContent).toBe("approval");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statusallowed for session");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("scopesession");
  });

  it("renders auto-review summaries under the final assistant message", () => {
    const blocks = threadStreamBlocks({
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
          kind: "dialogue",
          role: "assistant",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
          text: "Done",
          turnId: "turn",
        },
      ],
    });
    const block = blocks.find((candidate) => candidate.key === "item:assistant-1");
    if (!block) throw new Error("Expected assistant block");

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__auto-reviews summary")?.textContent).toBe("Auto-reviewed 2 requests");
    expect(element.querySelector(".codex-panel__auto-reviews")?.textContent).toContain("Auto-review approved: npm test");
  });

  it("adds pending requests to the bottom of thread stream blocks", () => {
    const blocks = threadStreamBlocks({
      items: [
        { id: "a1", kind: "dialogue", role: "assistant", text: "Done", dialogueKind: "assistantResponse", dialogueState: "completed" },
      ],
      pendingRequests: pendingRequestContext({
        signature: "request:1",
      }),
    });

    expect(blocks.map((block) => block.key)).toEqual(["item:a1", "pending-requests"]);
    expect(expectPresent(blocks[1]).kind).toBe("pendingRequests");
  });

  it("renders MCP elicitation fields and resolves them separately from Plan mode input", () => {
    const parent = document.createElement("div");
    const resolveMcpElicitation = vi.fn();
    const setMcpElicitationDraft = vi.fn();

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        items: [
          { id: "a1", kind: "dialogue", role: "assistant", text: "Done", dialogueKind: "assistantResponse", dialogueState: "completed" },
        ],
        renderMarkdown: (element, text) => element.createDiv({ text }),
        pendingRequests: pendingRequestContext({
          signature: "mcp:51",
          snapshot: emptyPendingRequestBlockSnapshot({
            pendingMcpElicitations: [pendingMcpElicitationSnapshot(pendingMcpElicitation())],
          }),
          actions: pendingRequestActions({ resolveMcpElicitation, setMcpElicitationDraft }),
        }),
      }),
    );

    expect(parent.querySelector(".codex-panel__pending-request-title")?.textContent).toBe("MCP request from github");
    const input = expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__mcp-elicitation-input"));
    const label = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__mcp-elicitation-label"));
    expect(label.tagName).toBe("LABEL");
    expect(label.getAttribute("for")).toBe(input.id);
    changeInputValue(input, "Updated");
    actEvent(() => {
      expectPresent(parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button.mod-cta")).click();
    });

    expect(setMcpElicitationDraft).toHaveBeenCalledWith("51:mcp:title", "Updated");
    expect(resolveMcpElicitation).toHaveBeenCalledWith(51, "accept");
    unmountUiRootInAct(parent);
  });

  it("does not accept invalid MCP elicitation forms", () => {
    const parent = document.createElement("div");
    const resolveMcpElicitation = vi.fn();

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        items: [
          { id: "a1", kind: "dialogue", role: "assistant", text: "Done", dialogueKind: "assistantResponse", dialogueState: "completed" },
        ],
        renderMarkdown: (element, text) => element.createDiv({ text }),
        pendingRequests: pendingRequestContext({
          signature: "mcp:52",
          snapshot: emptyPendingRequestBlockSnapshot({
            pendingMcpElicitations: [pendingMcpElicitationSnapshot(pendingMcpElicitation({ requestId: 52, defaultValue: "" }))],
          }),
          actions: pendingRequestActions({ resolveMcpElicitation }),
        }),
      }),
    );

    actEvent(() => {
      expectPresent(parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button.mod-cta")).click();
    });
    expect(resolveMcpElicitation).not.toHaveBeenCalled();

    changeInputValue(expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__mcp-elicitation-input")), "Ready");
    actEvent(() => {
      expectPresent(parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button.mod-cta")).click();
    });
    expect(resolveMcpElicitation).toHaveBeenCalledWith(52, "accept");
    unmountUiRootInAct(parent);
  });

  it("accepts MCP multi-select fields without panel-side cardinality validation", () => {
    const parent = document.createElement("div");
    const resolveMcpElicitation = vi.fn();

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        items: [
          { id: "a1", kind: "dialogue", role: "assistant", text: "Done", dialogueKind: "assistantResponse", dialogueState: "completed" },
        ],
        renderMarkdown: (element, text) => element.createDiv({ text }),
        pendingRequests: pendingRequestContext({
          signature: "mcp:53",
          snapshot: emptyPendingRequestBlockSnapshot({
            pendingMcpElicitations: [pendingMcpMultiSelectElicitation()],
          }),
          actions: pendingRequestActions({ resolveMcpElicitation }),
        }),
      }),
    );

    expect(parent.querySelectorAll<HTMLInputElement>(".codex-panel__mcp-elicitation-checkbox")).toHaveLength(2);
    actEvent(() => {
      expectPresent(parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button.mod-cta")).click();
    });

    expect(resolveMcpElicitation).toHaveBeenCalledWith(53, "accept");
    unmountUiRootInAct(parent);
  });

  it("does not consume pending request autofocus while building thread stream blocks", () => {
    const consumeAutoFocus = vi.fn(() => true);

    const blocks = threadStreamBlocks({
      items: [
        { id: "a1", kind: "dialogue", role: "assistant", text: "Done", dialogueKind: "assistantResponse", dialogueState: "completed" },
      ],
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
      renderThreadStreamBlocksInAct(
        parent,
        threadStreamBlocks({
          items: [
            { id: "a1", kind: "dialogue", role: "assistant", text: "Done", dialogueKind: "assistantResponse", dialogueState: "completed" },
          ],
          renderMarkdown: (element, text) => element.createDiv({ text }),
          pendingRequests: pendingRequestContext({
            signature: "approval:1",
            snapshot: emptyPendingRequestBlockSnapshot({ approvals: [pendingApprovalSnapshot(pendingApproval())] }),
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

    const blocks = threadStreamBlocks({
      items: [],
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
      items: [
        { id: "a1", kind: "dialogue", role: "assistant", text: "Done", dialogueKind: "assistantResponse", dialogueState: "completed" },
      ] satisfies ThreadStreamItem[],
    };

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        ...baseContext,
        pendingRequests: pendingRequestContext({
          signature: "request:1",
          snapshot: emptyPendingRequestBlockSnapshot({ approvals: [pendingApprovalSnapshot(pendingApproval())] }),
        }),
      }),
    );
    expect(parent.querySelector('[data-codex-panel-block-key="pending-requests"]')).not.toBeNull();

    renderThreadStreamBlocksInAct(parent, threadStreamBlocks(baseContext));

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
    pendingMcpElicitations: [],
    userInputDrafts: new Map(),
    mcpElicitationDrafts: new Map(),
    approvalDetails: new Set(),
    ...overrides,
  };
}

function pendingMcpElicitation({
  requestId = 51,
  defaultValue = "Issue",
}: {
  requestId?: PendingMcpElicitation["requestId"];
  defaultValue?: string;
} = {}): PendingMcpElicitation {
  return {
    requestId,
    params: {
      threadId: "thread",
      turnId: null,
      serverName: "github",
      mode: "form",
      message: "Provide issue details",
      meta: null,
      fields: [
        {
          id: "title",
          title: "Title",
          description: "Issue title",
          type: "string",
          required: true,
          defaultValue,
        },
      ],
    },
  };
}

function pendingApprovalSnapshot(approval: PendingApproval): PendingRequestBlockSnapshot["approvals"][number] {
  return expectPresent(
    pendingRequestBlockSnapshotFromState({
      approvals: [approval],
      pendingUserInputs: [],
      pendingMcpElicitations: [],
      userInputDrafts: new Map(),
      mcpElicitationDrafts: new Map(),
      approvalDetails: new Set(),
    }).approvals[0],
  );
}

function pendingMcpElicitationSnapshot(elicitation: PendingMcpElicitation): PendingRequestBlockSnapshot["pendingMcpElicitations"][number] {
  return expectPresent(
    pendingRequestBlockSnapshotFromState({
      approvals: [],
      pendingUserInputs: [],
      pendingMcpElicitations: [elicitation],
      userInputDrafts: new Map(),
      mcpElicitationDrafts: new Map(),
      approvalDetails: new Set(),
    }).pendingMcpElicitations[0],
  );
}

function pendingMcpMultiSelectElicitation(): PendingRequestBlockSnapshot["pendingMcpElicitations"][number] {
  return pendingMcpElicitationSnapshot({
    requestId: 53,
    params: {
      threadId: "thread",
      turnId: null,
      serverName: "github",
      mode: "form",
      message: "Choose labels",
      meta: null,
      fields: [
        {
          id: "labels",
          title: "Labels",
          description: null,
          type: "multi-select",
          required: true,
          options: [
            { value: "bug", label: "Bug" },
            { value: "docs", label: "Docs" },
          ],
          defaultValue: [],
        },
      ],
    },
  });
}
