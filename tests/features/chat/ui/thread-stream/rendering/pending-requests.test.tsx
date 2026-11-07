// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createChatState } from "../../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../../src/features/chat/application/state/store";
import { localUserDialogueItemFromInput } from "../../../../../../src/features/chat/application/submission/local-user-dialogue";
import { userInputDraftKey } from "../../../../../../src/features/chat/domain/pending-requests/drafts";
import type {
  PendingApproval,
  PendingMcpElicitation,
  PendingUserInput,
} from "../../../../../../src/features/chat/domain/pending-requests/model";
import { pendingRequestFocusSignature } from "../../../../../../src/features/chat/domain/pending-requests/signatures";
import type { ThreadStreamItem } from "../../../../../../src/features/chat/domain/thread-stream/items";
import type { PendingRequestBlockContext } from "../../../../../../src/features/chat/ui/thread-stream/context";
import type { PendingRequestBlockSnapshot } from "../../../../../../src/features/chat/ui/thread-stream/model";
import { pendingRequestBlockSnapshotFromState } from "../../../../../../src/features/chat/ui/thread-stream/pending-requests";
import { appServerAgentMessageFixture, appServerTurnFixture, appServerUserMessageFixture } from "../../../../../support/app-server-records";
import { changeInputValue, textContents } from "../../../../../support/dom";
import { commandApprovalRequestFixture, mcpFormRequestFixture } from "../../../../../support/server-requests";
import { pendingRequestFixture } from "../../../support/pending-requests";
import { chatStateThreadStreamItems } from "../../../support/thread-stream";
import { setupThreadStreamRendering } from "./setup";

setupThreadStreamRendering();

import {
  actEvent,
  expectPresent,
  pendingApproval,
  pendingFreeformUserInput,
  pendingOtherUserInput,
  pendingRequestActions,
  pendingUserInput,
  projectedThreadStream,
  renderPendingRequestNode,
  renderThreadStreamBlockElement,
  renderThreadStreamBlocksInAct,
  unmountUiRootInAct,
} from "./test-helpers";

describe("panel pending request rendering", () => {
  it("keeps a human answer with its work when the turn completes before its start acknowledgement", () => {
    const parent = document.createElement("div");
    const { handler, stateStore, receive, pendingRequests } = pendingRequestFixture();
    stateStore.dispatch({ type: "turn/scoped-cleared" });
    stateStore.dispatch({
      type: "turn/optimistic-started",
      item: localUserDialogueItemFromInput({
        id: "local-prompt",
        clientId: "prompt",
        text: "Run tests",
        codexInput: [],
      }),
    });
    handler.handleNotification({
      method: "turn/started",
      params: {
        threadId: "thread-active",
        turn: appServerTurnFixture({ id: "turn-active", status: "inProgress", itemsView: "full", items: [] }),
      },
    });
    const response = receive(
      commandApprovalRequestFixture(81, {
        threadId: "thread-active",
        turnId: "turn-active",
        kind: "humanCommand",
        availableDecisions: ["accept", "decline", "cancel"],
        command: "npm test",
      }),
    );
    renderPendingRequestNode(parent, stateStore.getState().requests.approvals, [], new Map(), new Set(), pendingRequests.actions);
    expect(textContents(parent, ".codex-panel__pending-request-body")).toContain("npm test");
    const buttons = [...parent.querySelectorAll<HTMLButtonElement>(".codex-panel__pending-request-actions button")];
    expect(buttons.map((item) => item.textContent)).toEqual(["Allow once", "Deny", "Cancel"]);
    actEvent(() => buttons.find((item) => item.textContent === "Allow once")?.click());
    expect(stateStore.getState().requests.approvals).toEqual([]);
    expect(response.respond).toHaveBeenCalledExactlyOnceWith({ decision: "accept" });
    handler.handleNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-active",
        turn: appServerTurnFixture({
          id: "turn-active",
          status: "completed",
          itemsView: "full",
          items: [
            appServerUserMessageFixture("server-prompt", "Run tests", { clientId: "prompt" }),
            appServerAgentMessageFixture("answer", "Done"),
          ],
        }),
      },
    });
    renderThreadStreamBlocksInAct(parent, projectedThreadStream({ items: chatStateThreadStreamItems(stateStore.getState()) }));
    const record = expectPresent(parent.querySelector(".codex-panel__stream-item--approval-result"));
    const group = expectPresent(record.closest(".codex-panel__activity-group"));
    expect(group.closest("[data-codex-panel-block-key]")?.nextElementSibling?.getAttribute("data-codex-panel-block-key")).toBe(
      "item:answer",
    );
    expect(chatStateThreadStreamItems(stateStore.getState())).toMatchObject([
      { id: "server-prompt" },
      { kind: "approvalResult", turnId: "turn-active", approval: { status: "allowed", scope: "command" } },
      { id: "answer" },
    ]);
  });

  it("keeps a failed human response actionable and sends the retry choice through the replayed responder", () => {
    const parent = document.createElement("div");
    const { stateStore, receive, pendingRequests } = pendingRequestFixture();
    const request = commandApprovalRequestFixture(81, {
      threadId: "thread-active",
      turnId: "turn-active",
      kind: "humanCommand",
      availableDecisions: ["accept", "decline", "cancel"],
    });
    const original = receive(request);
    original.respond.mockImplementationOnce(() => {
      throw new Error("transport unavailable");
    });
    const render = () =>
      renderPendingRequestNode(parent, stateStore.getState().requests.approvals, [], new Map(), new Set(), pendingRequests.actions);
    render();
    actEvent(() => parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-actions button")?.click());
    render();
    expect(textContents(parent, ".codex-panel__pending-request-actions button:enabled")).toEqual(["Allow once", "Deny", "Cancel"]);
    expect(chatStateThreadStreamItems(stateStore.getState()).filter((item) => item.kind === "approvalResult")).toEqual([]);

    const replayed = receive(request);
    render();
    const buttons = [...parent.querySelectorAll<HTMLButtonElement>(".codex-panel__pending-request-actions button")];
    actEvent(() => buttons.find((item) => item.textContent === "Deny")?.click());
    expect(original.respond).toHaveBeenCalledExactlyOnceWith({ decision: "accept" });
    expect(replayed.respond).toHaveBeenCalledExactlyOnceWith({ decision: "decline" });
    expect(stateStore.getState().requests.approvals).toEqual([]);
    expect(chatStateThreadStreamItems(stateStore.getState()).filter((item) => item.kind === "approvalResult")).toMatchObject([
      { approval: { status: "denied" } },
    ]);
  });

  it("preserves draft selection and consumed autofocus across deadline updates and remounts", () => {
    const parent = document.createElement("div");
    const composer = document.createElement("textarea");
    document.body.append(composer, parent);
    const stateStore = createChatStateStore(createChatState());
    const { handler, pendingRequests: requests } = pendingRequestFixture({
      stateStore,
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
        state.userInputDrafts,
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
      handler.clearServerRequests();
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
      renderPendingRequestNode(parent, [], [input], new Map(), new Set(), pendingRequestActions(), false, undefined, "", namespace);

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

    renderPendingRequestNode(parent, [], [input], drafts, new Set(), pendingRequestActions({ resolveUserInput }));

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
      renderPendingRequestNode(parent, [], [input], new Map(), new Set(), actions);

      expect(parent.querySelector(".codex-panel__pending-request-body")?.textContent).toBe("Optional — Codex will continue automatically.");
      expect(textContents(parent, ".codex-panel__pending-request-button")).toEqual(["Submit", "Skip"]);

      actEvent(() => {
        vi.advanceTimersByTime(90_000);
      });
      expect(parent.querySelector(".codex-panel__pending-request-body")?.textContent).toBe(
        "Optional — Codex will continue without an answer in 30 seconds.",
      );

      renderPendingRequestNode(parent, [], [{ ...input, autoResolutionAtMs: 211_000 }], new Map(), new Set(), actions);
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
    const { parent, drafts, render } = controlledOtherInput();

    render();
    actEvent(() => {
      changeInputValue(expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")), "Custom scope");
    });

    expect(drafts().get("99:scope:other")).toBe("Custom scope");
    expect(drafts().get("99:scope")).toBe("Custom scope");

    render();
    const radios = [...parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio")];
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
  });

  it("keeps an empty other Plan mode answer selected and updates its tab order", () => {
    const { parent, drafts, render } = controlledOtherInput();

    render();
    const radios = [...parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio")];
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")?.tabIndex).toBe(-1);

    actEvent(() => {
      expectPresent(radios.at(1)).click();
    });

    expect(drafts().get("99:scope")).toBe("");

    render();
    const rerenderedRadios = [...parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio")];
    expect(rerenderedRadios.map((radio) => radio.checked)).toEqual([false, true]);
    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")?.tabIndex).toBe(0);
  });

  it.each(["main document", "iframe"])("commits other Plan mode IME answers in the %s", (target) => {
    const iframe = target === "iframe" ? document.createElement("iframe") : null;
    if (iframe) document.body.appendChild(iframe);
    const targetDocument = iframe ? expectPresent(iframe.contentDocument) : document;
    const targetWindow = expectPresent(targetDocument.defaultView);
    const parent = targetDocument.createElement("div");
    targetDocument.body.appendChild(parent);
    const { drafts, render } = controlledOtherInput(parent);
    try {
      render();
      const otherInput = expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text"));
      expect(otherInput.ownerDocument).toBe(targetDocument);
      expect(otherInput instanceof HTMLInputElement).toBe(iframe === null);

      actEvent(() => {
        otherInput.dispatchEvent(new targetWindow.CompositionEvent("compositionstart", { bubbles: true }));
        otherInput.value = "にほん";
        otherInput.dispatchEvent(new targetWindow.InputEvent("input", { bubbles: true, isComposing: true }));
      });
      render();
      expect(otherInput.value).toBe("にほん");
      expect(drafts().get("99:scope:other")).toBeUndefined();
      expect(drafts().get("99:scope")).toBe("");
      expect(parent.querySelector<HTMLInputElement>('.codex-panel__user-input-radio[value="__other__"]')?.checked).toBe(true);

      actEvent(() => {
        otherInput.value = "日本";
        otherInput.dispatchEvent(new targetWindow.CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
      });
      render();
      expect(otherInput.value).toBe("日本");
      expect(drafts().get("99:scope:other")).toBe("日本");
      expect(drafts().get("99:scope")).toBe("日本");

      actEvent(() => {
        otherInput.value = "日本!";
        otherInput.dispatchEvent(new targetWindow.InputEvent("input", { bubbles: true, data: "!" }));
      });
      render();
      expect(otherInput.value).toBe("日本!");
      expect(drafts().get("99:scope:other")).toBe("日本!");
      expect(drafts().get("99:scope")).toBe("日本!");
    } finally {
      unmountUiRootInAct(parent);
      parent.remove();
      iframe?.remove();
    }
  });

  it("renders pending approvals and user input questions in the same request block", () => {
    const parent = document.createElement("div");
    const approval = pendingApproval();
    const input = pendingUserInput();

    renderPendingRequestNode(parent, [approval], [input], new Map(), new Set(), pendingRequestActions());

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

  it.each([
    { isSecret: false, type: "text" },
    { isSecret: true, type: "password" },
  ])("focuses and routes $type input when pending requests ask for autofocus", ({ isSecret, type }) => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const input = pendingFreeformUserInput();
    input.params.questions = input.params.questions.map((question) => ({ ...question, isSecret }));
    const setUserInputDraft = vi.fn();

    try {
      renderPendingRequestNode(
        parent,
        [pendingApproval()],
        [input],
        new Map(),
        new Set(),
        pendingRequestActions({ setUserInputDraft }),
        true,
      );

      const inputElement = parent.querySelector<HTMLInputElement>(".codex-panel__user-input-text");
      expect(document.activeElement).toBe(inputElement);
      expect(inputElement?.type).toBe(type);
      changeInputValue(expectPresent(inputElement), "Answer");
      expect(setUserInputDraft).toHaveBeenCalledWith(input.requestId, "99:scope", "Answer");
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
      renderPendingRequestNode(parent, [], [input], new Map(), new Set(), pendingRequestActions(), true);

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
      renderPendingRequestNode(parent, [pendingApproval()], [], new Map(), new Set(), pendingRequestActions(), true);

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
      threadId: "thread",
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

    renderPendingRequestNode(parent, [approval], [], new Map(), new Set(), pendingRequestActions({ resolveApproval }));

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
    const { blocks, context } = projectedThreadStream({
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
    });

    const element = renderThreadStreamBlockElement(expectPresent(blocks[0]), context);

    expect(element.querySelector(".codex-panel__stream-item-role")?.textContent).toBe("Input");
    expect(element.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("Input submitted for 1 question.");
    expect(renderMarkdown).not.toHaveBeenCalled();
    expect(element.textContent).not.toContain("Approval");
    expect(element.querySelector("details summary")?.textContent).toBe("Question: Scope");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("AnswerNarrow");
  });

  it("renders manual approval results with completion state and details", () => {
    const { blocks, context } = projectedThreadStream({
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
    });

    const element = renderThreadStreamBlockElement(expectPresent(blocks[0]), context);

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
    const { blocks, context } = projectedThreadStream({
      items: [
        {
          reviewKind: "automaticResult",
          id: "review-1",
          kind: "reviewResult",
          role: "tool",
          text: "Auto-review approved: npm test",
          turnId: "turn",
          provenance: { source: "appServer", channel: "notification", event: "autoReview", sourceItemId: "review-1" },
        },
        {
          reviewKind: "automaticResult",
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

    const element = renderThreadStreamBlockElement(block, context);

    expect(element.querySelector(".codex-panel__auto-reviews summary")?.textContent).toBe("Auto-reviewed 2 requests");
    expect(element.querySelector(".codex-panel__auto-reviews")?.textContent).toContain("Auto-review approved: npm test");
  });

  it("associates MCP field labels with their own panel when the same request is shown twice", () => {
    const parents = [document.createElement("div"), document.createElement("div")];
    document.body.append(...parents);
    try {
      const inputs = parents.map((parent, index) => {
        renderThreadStreamBlocksInAct(
          parent,
          projectedThreadStream({
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

  it("keeps an invalid MCP form editable and submits the corrected control values", () => {
    const parent = document.createElement("div");
    const fixture = pendingRequestFixture();
    const response = fixture.receive(
      mcpFormRequestFixture(
        52,
        {
          type: "object",
          required: ["title", "labels"],
          properties: {
            title: { type: "string", title: "Title", default: "Hi", minLength: 3, maxLength: 5 },
            labels: {
              type: "array",
              title: "Labels",
              items: { type: "string", enum: ["bug", "docs"] },
              minItems: 1n,
              default: ["outdated"],
            },
            notify: { type: "boolean", title: "Notify", default: false },
            priority: { type: "string", title: "Priority", enum: ["low", "high"], default: "low" },
            estimate: { type: "number", title: "Estimate", default: 1.5 },
            count: { type: "integer", title: "Count", default: 1 },
          },
        },
        { serverName: "issue-tracker" },
      ),
    );
    try {
      renderMcpWorkflow(parent, fixture);
      expect(parent.querySelector(".codex-panel__pending-request-title")?.textContent).toContain("issue-tracker");
      const title = expectPresent(parent.querySelector<HTMLInputElement>('input[type="text"]'));
      const [estimateInput, countInput] = parent.querySelectorAll<HTMLInputElement>('input[type="number"]');
      const estimate = expectPresent(estimateInput);
      const count = expectPresent(countInput);
      const label = expectPresent(parent.querySelector<HTMLInputElement>('input[value="docs"]'));
      const labelControls = [...expectPresent(label.closest("fieldset")).querySelectorAll("input")];
      expect(title.value).toBe("Hi");
      expect(estimate.value).toBe("1.5");
      expect(label.checked).toBe(false);
      expect(parent.querySelector<HTMLInputElement>('input[value="low"]')?.checked).toBe(true);
      actEvent(() => expectPresent(parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button.mod-cta")).click());
      expect(title.validity.customError).toBe(true);
      expect(labelControls.some((control) => !control.validity.valid)).toBe(true);
      expect(response.respond).not.toHaveBeenCalled();
      expect(fixture.focusComposer).not.toHaveBeenCalled();

      changeInputValue(title, "Ready");
      changeInputValue(estimate, "3.5");
      changeInputValue(count, "2");
      actEvent(() => {
        label.click();
        expectPresent(parent.querySelector<HTMLInputElement>('input[value="high"]')).click();
        expectPresent(
          [...parent.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => input.value === "on"),
        ).click();
      });
      renderMcpWorkflow(parent, fixture);
      expect(title.value).toBe("Ready");
      expect(estimate.value).toBe("3.5");
      expect(label.checked).toBe(true);
      expect(parent.querySelector<HTMLInputElement>('input[value="high"]')?.checked).toBe(true);
      expect(title.validity.valid).toBe(true);
      expect(labelControls.every((control) => control.validity.valid)).toBe(true);
      actEvent(() => expectPresent(parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button.mod-cta")).click());
      expect(response.respond).toHaveBeenCalledExactlyOnceWith({
        action: "accept",
        content: { title: "Ready", labels: ["docs"], notify: true, priority: "high", estimate: 3.5, count: 2 },
        _meta: null,
      });
      expect(fixture.stateStore.getState().requests.pendingMcpElicitations).toEqual([]);
      expect(fixture.focusComposer).toHaveBeenCalledOnce();
    } finally {
      unmountUiRootInAct(parent);
    }
  });

  it("lets the user decline an MCP request without supplying its required answer", () => {
    const parent = document.createElement("div");
    const fixture = pendingRequestFixture();
    const response = fixture.receive(
      mcpFormRequestFixture(52, {
        type: "object",
        required: ["title"],
        properties: { title: { type: "string", title: "Title", minLength: 1 } },
      }),
    );
    try {
      renderMcpWorkflow(parent, fixture);
      actEvent(() => expectPresent([...parent.querySelectorAll("button")].find((button) => button.textContent === "Decline")).click());
      expect(response.respond).toHaveBeenCalledExactlyOnceWith({ action: "decline", content: null, _meta: null });
    } finally {
      unmountUiRootInAct(parent);
    }
  });

  it("updates checkbox groups and clears an empty-valued single choice", () => {
    const parent = document.createElement("div");
    const fixture = pendingRequestFixture();
    const response = fixture.receive(
      mcpFormRequestFixture(51, {
        type: "object",
        properties: {
          choice: { type: "string", title: "Choice", oneOf: [{ const: "", title: "Empty label" }] },
          labels: { type: "array", title: "Labels", items: { type: "string", enum: ["bug", "docs"] }, default: ["bug"] },
        },
      }),
    );
    try {
      renderMcpWorkflow(parent, fixture);
      expect(parent.querySelector('input[type="radio"]:checked')).toBeNull();
      actEvent(() => expectPresent(parent.querySelector<HTMLInputElement>('input[value=""]')).click());
      renderMcpWorkflow(parent, fixture);
      expect(parent.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value).toBe("");
      actEvent(() =>
        expectPresent([...parent.querySelectorAll("button")].find((button) => button.textContent === "Clear selection")).click(),
      );
      renderMcpWorkflow(parent, fixture);
      expect(parent.querySelector('input[type="radio"]:checked')).toBeNull();
      expect([...parent.querySelectorAll("button")].some((button) => button.textContent === "Clear selection")).toBe(false);

      actEvent(() => expectPresent(parent.querySelector<HTMLInputElement>('input[value="docs"]')).click());
      renderMcpWorkflow(parent, fixture);
      expect([...parent.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((input) => input.value)).toEqual([
        "bug",
        "docs",
      ]);
      actEvent(() => expectPresent(parent.querySelector<HTMLInputElement>('input[value="bug"]')).click());
      renderMcpWorkflow(parent, fixture);
      expect([...parent.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((input) => input.value)).toEqual([
        "docs",
      ]);
      actEvent(() => expectPresent(parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button.mod-cta")).click());
      expect(response.respond).toHaveBeenCalledExactlyOnceWith({ action: "accept", content: { labels: ["docs"] }, _meta: null });
    } finally {
      unmountUiRootInAct(parent);
    }
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
      new Map(),
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
      projectedThreadStream({
        ...baseContext,
        pendingRequests: pendingRequestContext({
          signature: "request:1",
          snapshot: emptyPendingRequestBlockSnapshot({ approvals: [pendingApprovalSnapshot(pendingApproval())] }),
        }),
      }),
    );
    expect(parent.querySelector('[data-codex-panel-block-key="pending-requests"]')).not.toBeNull();

    renderThreadStreamBlocksInAct(parent, projectedThreadStream(baseContext));

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
    approvalDetails: new Set(),
    ...overrides,
  };
}

function pendingMcpElicitation({
  requestId = 51,
  value = "Issue",
}: {
  requestId?: PendingMcpElicitation["requestId"];
  value?: string;
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
          value,
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
      approvalDetails: new Set(),
    }).pendingMcpElicitations[0],
  );
}

function controlledOtherInput(parent = document.createElement("div")) {
  const { stateStore, pendingRequests } = pendingRequestFixture();
  stateStore.dispatch({ type: "request/user-input-queued", input: pendingOtherUserInput() });
  const drafts = () => stateStore.getState().requests.userInputDrafts;
  const render = () => {
    const state = stateStore.getState().requests;
    renderPendingRequestNode(parent, [], state.pendingUserInputs, drafts(), new Set(), pendingRequests.actions);
  };
  return { parent, drafts, render };
}

function renderMcpWorkflow(parent: HTMLElement, fixture: ReturnType<typeof pendingRequestFixture>): void {
  const snapshot = pendingRequestBlockSnapshotFromState({ ...fixture.stateStore.getState().requests, approvalDetails: new Set() });
  renderThreadStreamBlocksInAct(
    parent,
    projectedThreadStream({
      items: [{ id: "prompt", kind: "dialogue", role: "user", dialogueKind: "user", text: "Configure the issue" }],
      pendingRequests: pendingRequestContext({ signature: "mcp", snapshot, actions: fixture.pendingRequests.actions }),
    }),
  );
}
