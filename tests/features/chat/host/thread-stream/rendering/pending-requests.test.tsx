// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createPendingRequestActions } from "../../../../../../src/features/chat/application/pending-requests/pending-request-actions";
import { createChatState } from "../../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../../src/features/chat/application/state/store";
import { userInputDraftKey } from "../../../../../../src/features/chat/domain/pending-requests/drafts";
import type {
  PendingApproval,
  PendingMcpElicitation,
  PendingUserInput,
} from "../../../../../../src/features/chat/domain/pending-requests/model";
import { pendingRequestFocusSignature } from "../../../../../../src/features/chat/domain/pending-requests/signatures";
import type { ThreadStreamItem } from "../../../../../../src/features/chat/domain/thread-stream/items";
import { pendingRequestBlockSnapshotFromState } from "../../../../../../src/features/chat/host/thread-stream/pending-requests";
import type { PendingRequestBlockContext } from "../../../../../../src/features/chat/ui/thread-stream/context";
import type { PendingRequestBlockSnapshot } from "../../../../../../src/features/chat/ui/thread-stream/model";
import { changeInputValue, textContents } from "../../../../../support/dom";
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
  projectedThreadStreamBlocks,
  renderPendingRequestNode,
  renderThreadStreamBlockElement,
  renderThreadStreamBlocksInAct,
  setNativeInputValue,
  unmountUiRootInAct,
} from "./test-helpers";

describe("panel pending request rendering", () => {
  it("preserves draft selection and consumed autofocus across deadline updates and remounts", () => {
    const parent = document.createElement("div");
    const composer = document.createElement("textarea");
    document.body.append(composer, parent);
    const stateStore = createChatStateStore(createChatState());
    const requests = createPendingRequestActions({
      stateStore,
      responder: {
        resolveApproval: vi.fn(),
        resolveUserInput: vi.fn(),
        skipUserInput: vi.fn(),
        extendUserInputAutoResolution: vi.fn(),
        cancelUserInput: vi.fn(),
        resolveMcpElicitation: vi.fn(),
      },
      composerHasFocus: () => document.activeElement === composer,
      focusComposer: () => composer.focus(),
    });
    const freeform = pendingFreeformUserInput();
    const input = { ...freeform, params: { ...freeform.params, isBlocking: false } };
    const question = expectPresent(input.params.questions[0]);
    const render = () => {
      const state = stateStore.getState().requests;
      renderPendingRequestNode(
        parent,
        state.approvals,
        state.pendingUserInputs,
        { values: state.userInputDrafts },
        new Set(),
        requests.actions,
        false,
        requests.consumeAutoFocus,
        pendingRequestFocusSignature(state.approvals, state.pendingUserInputs, state.pendingMcpElicitations),
      );
    };
    try {
      composer.focus();
      stateStore.dispatch({ type: "request/user-input-queued", input });
      render();
      const field = expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-text"));
      expect(document.activeElement).toBe(field);
      stateStore.dispatch({
        type: "request/user-input-draft-set",
        key: userInputDraftKey(input.requestId, question.id),
        value: "draft answer",
      });
      render();
      expect(field.value).toBe("draft answer");
      field.setSelectionRange(2, 5);
      stateStore.dispatch({
        type: "request/user-input-auto-resolution-extended",
        requestId: input.requestId,
        autoResolutionAtMs: Date.now() + 60_000,
      });
      render();
      expect(document.activeElement).toBe(field);
      expect([field.selectionStart, field.selectionEnd]).toEqual([2, 5]);
      composer.focus();
      unmountUiRootInAct(parent);
      render();
      expect(document.activeElement).toBe(composer);
      // The next render can replace a request without ever displaying an empty queue.
      stateStore.dispatch({ type: "request/resolved", requestId: input.requestId });
      stateStore.dispatch({ type: "request/user-input-queued", input: { ...input, requestId: 1001 } });
      render();
      expect(document.activeElement).toBe(parent.querySelector(".codex-panel__user-input-text"));
      composer.focus();
      stateStore.dispatch({ type: "request/approval-queued", approval: pendingApproval() });
      render();
      expect(parent.contains(document.activeElement)).toBe(true);
    } finally {
      unmountUiRootInAct(parent);
      parent.remove();
      composer.remove();
    }
  });

  it("keeps radio groups separate across panels with the same request id", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const input = pendingUserInput();
    const render = (parent: HTMLElement, namespace: string) =>
      renderPendingRequestNode(
        parent,
        [],
        [input],
        { values: new Map() },
        new Set(),
        pendingRequestActions(),
        false,
        undefined,
        "",
        namespace,
      );

    render(first, "panel-a");
    render(second, "panel-b");

    const firstName = first.querySelector<HTMLInputElement>(".codex-panel__user-input-radio")?.name;
    const secondName = second.querySelector<HTMLInputElement>(".codex-panel__user-input-radio")?.name;
    expect(firstName).toBeTruthy();
    expect(secondName).toBeTruthy();
    expect(firstName).not.toBe(secondName);
  });

  it("renders the default user input option and dispatches submission", () => {
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
    expect(parent.querySelector(".codex-panel__pending-request-block")?.classList.contains("codex-panel__status-stream-item")).toBe(true);
    expect(
      parent.querySelector(".codex-panel__pending-request-block")?.classList.contains("codex-panel__status-stream-item--warning"),
    ).toBe(true);
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

  it("renders optional input inline and reveals its countdown only for the final 30 seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const parent = document.createElement("div");
    const blockingInput = pendingUserInput();
    const input: PendingUserInput = {
      ...blockingInput,
      autoResolutionAtMs: 121_000,
      params: { ...blockingInput.params, isBlocking: false },
    };
    const actions = pendingRequestActions();
    try {
      renderPendingRequestNode(parent, [], [input], { values: new Map() }, new Set(), actions);

      expect(parent.querySelector(".codex-panel__pending-request-body")?.textContent).toBe("Optional — Codex will continue automatically.");
      expect(textContents(parent, ".codex-panel__pending-request-button")).toEqual(["Submit", "Skip"]);

      actEvent(() => {
        vi.advanceTimersByTime(90_000);
      });
      expect(parent.querySelector(".codex-panel__pending-request-body")?.textContent).toBe(
        "Optional — Codex will continue without an answer in 30 seconds.",
      );

      renderPendingRequestNode(parent, [], [{ ...input, autoResolutionAtMs: 211_000 }], { values: new Map() }, new Set(), actions);
      expect(parent.querySelector(".codex-panel__pending-request-body")?.textContent).toBe("Optional — Codex will continue automatically.");

      actEvent(() => {
        vi.advanceTimersByTime(90_000);
      });
      expect(parent.querySelector(".codex-panel__pending-request-body")?.textContent).toBe(
        "Optional — Codex will continue without an answer in 30 seconds.",
      );

      actEvent(() => {
        parent.querySelectorAll<HTMLButtonElement>(".codex-panel__pending-request-button").item(1).click();
      });
      expect(actions.skipUserInput).toHaveBeenCalledWith(input.requestId);
      expect(actions.cancelUserInput).not.toHaveBeenCalled();
    } finally {
      unmountUiRootInAct(parent);
      vi.useRealTimers();
    }
  });

  it("selects the other Plan mode answer from controlled drafts", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const input = pendingOtherUserInput();
    const draftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}`;
    const otherDraftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}:other`;
    const actions = pendingRequestActions({
      setUserInputDraft: vi.fn((_requestId, key: string, value: string) => {
        drafts.set(key, value);
      }),
    });
    const render = () => {
      renderPendingRequestNode(parent, [], [input], { values: drafts, draftKey, otherDraftKey }, new Set(), actions);
    };

    render();
    actEvent(() => {
      changeInputValue(expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")), "Custom scope");
    });

    expect(actions.setUserInputDraft).toHaveBeenCalledWith(99, "99:scope:other", "Custom scope");
    expect(actions.setUserInputDraft).toHaveBeenCalledWith(99, "99:scope", "Custom scope");

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
      setUserInputDraft: vi.fn((_requestId, key: string, value: string) => {
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

    expect(actions.setUserInputDraft).toHaveBeenCalledWith(99, "99:scope", "");

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
      setUserInputDraft: vi.fn((_requestId, key: string, value: string) => {
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
      setUserInputDraft: vi.fn((_requestId, key: string, value: string) => {
        drafts.set(key, value);
      }),
    });

    renderPendingRequestNode(parent, [], [input], { values: drafts, draftKey, otherDraftKey }, new Set(), actions);
    const otherInput = expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text"));

    actEvent(() => {
      otherInput.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      dispatchComposingInputValue(otherInput, "にほん");
    });

    expect(actions.setUserInputDraft).toHaveBeenCalledWith(99, "99:scope", "");
    expect(actions.setUserInputDraft).not.toHaveBeenCalledWith(99, "99:scope:other", "にほん");
    expect(actions.setUserInputDraft).not.toHaveBeenCalledWith(99, "99:scope", "にほん");

    setNativeInputValue(otherInput, "日本");
    actEvent(() => {
      otherInput.dispatchEvent(new Event("compositionend", { bubbles: true }));
    });

    expect(actions.setUserInputDraft).toHaveBeenCalledWith(99, "99:scope:other", "日本");
    expect(actions.setUserInputDraft).toHaveBeenCalledWith(99, "99:scope", "日本");
  });

  it("renders pending approvals and user input questions in the same request block", () => {
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
      kind: "command",
      turnId: "turn",
      title: "Command approval",
      summary: "Needs network",
      resultSummary: "Needs network",
      details: [
        { key: "reason", value: "Needs network" },
        { key: "network", value: "https://registry.npmjs.org" },
      ],
      actionOptions: [
        {
          id: "approval-option:0:network-allow",
          label: "Allow network rule",
          action: { kind: "approval-option", optionId: "approval-option:0:network-allow", intent: "accept-session" },
        },
        {
          id: "approval-option:1:decline",
          label: "Deny",
          action: { kind: "approval-option", optionId: "approval-option:1:decline", intent: "decline" },
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
      optionId: "approval-option:0:network-allow",
      intent: "accept-session",
    });
  });

  it("renders submitted user input separately from approvals", () => {
    const renderMarkdown = vi.fn((parent: HTMLElement, text: string) => parent.createDiv({ text: `markdown:${text}` }));
    const block = projectedThreadStreamBlocks({
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

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__stream-item-role")?.textContent).toBe("Input");
    expect(element.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("Input submitted for 1 question.");
    expect(renderMarkdown).not.toHaveBeenCalled();
    expect(element.textContent).not.toContain("Approval");
    expect(element.querySelector("details summary")?.textContent).toBe("Question: Scope");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("AnswerNarrow");
  });

  it("renders manual approval results with completion state and details", () => {
    const block = projectedThreadStreamBlocks({
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

    const element = renderThreadStreamBlockElement(block);

    expect(element.classList.contains("codex-panel__stream-item--approval-result")).toBe(true);
    expect(element.classList.contains("codex-panel__detail")).toBe(true);
    expect(element.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(element.querySelector(".codex-panel__stream-item-content")).toBeNull();
    expect(element.querySelector(".codex-panel__detail-header")?.textContent).toBe("approval");
    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("Allowed for this session: Need access");
    expect(element.querySelector("details summary")?.textContent).toBe("approval");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statusallowed for session");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("scopesession");
  });

  it("renders auto-review summaries under the final assistant message", () => {
    const blocks = projectedThreadStreamBlocks({
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

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__auto-reviews summary")?.textContent).toBe("Auto-reviewed 2 requests");
    expect(element.querySelector(".codex-panel__auto-reviews")?.textContent).toContain("Auto-review approved: npm test");
  });

  it("renders MCP elicitation fields and resolves them separately from Plan mode input", () => {
    const parent = document.createElement("div");
    const resolveMcpElicitation = vi.fn();
    const setMcpElicitationDraft = vi.fn();

    renderThreadStreamBlocksInAct(
      parent,
      projectedThreadStreamBlocks({
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
    expect(label.getAttribute("for")).toBe(input.id);
    changeInputValue(input, "Updated");
    actEvent(() => {
      expectPresent(parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button.mod-cta")).click();
    });

    expect(setMcpElicitationDraft).toHaveBeenCalledWith("51:mcp:title", "Updated");
    expect(resolveMcpElicitation).toHaveBeenCalledWith(51, "accept");
    unmountUiRootInAct(parent);
  });

  it("associates MCP field labels with their own panel when the same request is shown twice", () => {
    const parents = [document.createElement("div"), document.createElement("div")];
    document.body.append(...parents);
    try {
      const inputs = parents.map((parent, index) => {
        renderThreadStreamBlocksInAct(
          parent,
          projectedThreadStreamBlocks({
            items: [
              {
                id: "a1",
                kind: "dialogue",
                role: "assistant",
                text: "Done",
                dialogueKind: "assistantResponse",
                dialogueState: "completed",
              },
            ],
            pendingRequests: {
              ...pendingRequestContext({
                signature: "mcp:51",
                snapshot: emptyPendingRequestBlockSnapshot({
                  pendingMcpElicitations: [pendingMcpElicitationSnapshot(pendingMcpElicitation())],
                }),
              }),
              controlNamespace: `panel-${index}`,
            },
          }),
        );
        return expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__mcp-elicitation-input"));
      });
      expect(inputs.every((input) => input.id.length > 0)).toBe(true);
      expect(new Set(inputs.map((input) => input.id)).size).toBe(2);
      parents.forEach((parent, index) => {
        const label = expectPresent(parent.querySelector<HTMLLabelElement>(".codex-panel__mcp-elicitation-label"));
        expect(label.control).toBe(inputs[index]);
      });
    } finally {
      parents.forEach((parent) => {
        unmountUiRootInAct(parent);
        parent.remove();
      });
    }
  });

  it("does not accept invalid MCP elicitation forms", () => {
    const parent = document.createElement("div");
    const resolveMcpElicitation = vi.fn();

    renderThreadStreamBlocksInAct(
      parent,
      projectedThreadStreamBlocks({
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
      projectedThreadStreamBlocks({
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

  it("keeps mixed MCP form fields wired to their drafts and supports declining the request", () => {
    const parent = document.createElement("div");
    const resolveMcpElicitation = vi.fn();
    const setMcpElicitationDraft = vi.fn();
    const elicitation = pendingMcpElicitationSnapshot({
      requestId: 54,
      params: {
        turnId: null,
        serverName: "github",
        mode: "form",
        message: "Configure the issue",
        fields: [
          { id: "notify", title: "Notify", description: null, type: "boolean", required: false, defaultValue: false },
          {
            id: "priority",
            title: "Priority",
            description: null,
            type: "single-select",
            required: true,
            options: [
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ],
            defaultValue: "low",
          },
          { id: "estimate", title: "Estimate", description: null, type: "number", required: false, defaultValue: 1.5 },
          { id: "note", title: "Note", description: null, type: "string", required: false, defaultValue: "" },
        ],
      },
    });

    renderThreadStreamBlocksInAct(
      parent,
      projectedThreadStreamBlocks({
        items: [
          { id: "a1", kind: "dialogue", role: "assistant", text: "Done", dialogueKind: "assistantResponse", dialogueState: "completed" },
        ],
        pendingRequests: pendingRequestContext({
          signature: "mcp:54",
          snapshot: emptyPendingRequestBlockSnapshot({ pendingMcpElicitations: [elicitation] }),
          actions: pendingRequestActions({ resolveMcpElicitation, setMcpElicitationDraft }),
        }),
      }),
    );

    const fields = [...parent.querySelectorAll<HTMLElement>(".codex-panel__mcp-elicitation-field")];
    actEvent(() => {
      expectPresent(fields[0]?.querySelector<HTMLInputElement>(".codex-panel__mcp-elicitation-checkbox")).click();
      expectPresent(fields[1]?.querySelectorAll<HTMLInputElement>(".codex-panel__mcp-elicitation-radio").item(1)).click();
      changeInputValue(expectPresent(fields[2]?.querySelector<HTMLInputElement>(".codex-panel__mcp-elicitation-input")), "3.5");
      changeInputValue(expectPresent(fields[3]?.querySelector<HTMLInputElement>(".codex-panel__mcp-elicitation-input")), "Ship today");
      expectPresent(
        [...parent.querySelectorAll<HTMLButtonElement>(".codex-panel__pending-request-button")].find(
          (button) => button.textContent === "Decline",
        ),
      ).click();
    });

    expect(setMcpElicitationDraft.mock.calls).toEqual([
      ["54:mcp:notify", "true"],
      ["54:mcp:priority", "high"],
      ["54:mcp:estimate", "3.5"],
      ["54:mcp:note", "Ship today"],
    ]);
    expect(resolveMcpElicitation).toHaveBeenCalledWith(54, "decline");
    unmountUiRootInAct(parent);
  });

  it("routes user-input cancellation and approval detail expansion from the shared request block", () => {
    const parent = document.createElement("div");
    const cancelUserInput = vi.fn();
    const setApprovalDetailsExpanded = vi.fn();
    const approval = pendingApproval();
    const input = pendingUserInput();

    renderPendingRequestNode(
      parent,
      [approval],
      [input],
      { values: new Map() },
      new Set(),
      pendingRequestActions({ cancelUserInput, setApprovalDetailsExpanded }),
    );

    const details = expectPresent(parent.querySelector<HTMLDetailsElement>(".codex-panel__approval-details"));
    actEvent(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
      expectPresent(
        [...parent.querySelectorAll<HTMLButtonElement>(".codex-panel__user-input .codex-panel__pending-request-button")].find(
          (button) => button.textContent === "Cancel",
        ),
      ).click();
    });

    expect(setApprovalDetailsExpanded).toHaveBeenCalledWith(approval.requestId, true);
    expect(cancelUserInput).toHaveBeenCalledWith(input.requestId);
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
      projectedThreadStreamBlocks({
        ...baseContext,
        pendingRequests: pendingRequestContext({
          signature: "request:1",
          snapshot: emptyPendingRequestBlockSnapshot({ approvals: [pendingApprovalSnapshot(pendingApproval())] }),
        }),
      }),
    );
    expect(parent.querySelector('[data-codex-panel-block-key="pending-requests"]')).not.toBeNull();

    renderThreadStreamBlocksInAct(parent, projectedThreadStreamBlocks(baseContext));

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
}): PendingRequestBlockContext & { signature: string; snapshot: () => PendingRequestBlockSnapshot } {
  const snapshot = options.snapshot;
  const snapshotFn =
    typeof snapshot === "function" ? (snapshot as () => PendingRequestBlockSnapshot) : () => snapshot ?? emptyPendingRequestBlockSnapshot();
  return {
    controlNamespace: "test-panel",
    signature: options.signature,
    snapshot: snapshotFn,
    actions: options.actions ?? pendingRequestActions(),
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
      turnId: null,
      serverName: "github",
      mode: "form",
      message: "Provide issue details",
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
      turnId: null,
      serverName: "github",
      mode: "form",
      message: "Choose labels",
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
