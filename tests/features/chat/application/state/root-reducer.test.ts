import { describe, expect, it } from "vitest";
import { createServerDiagnostics, diagnosticProbeOk, diagnosticsWithProbe } from "../../../../../src/domain/server/diagnostics";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { Thread } from "../../../../../src/domain/threads/model";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../../../../../src/features/chat/application/state/panel-target";
import { activeThreadState, type ChatState, chatReducer } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { threadStreamStableItems } from "../../../../../src/features/chat/application/state/thread-stream";
import { pendingWebSubmissionItem } from "../../../../../src/features/chat/application/submission/web-submission";
import { activeTurnId, chatTurnBusy, pendingTurnStart } from "../../../../../src/features/chat/application/turns/turn-state";
import { setCollaborationModeIntent, setRuntimeIntentValue } from "../../../../../src/features/chat/domain/runtime/intent";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems, withChatStateStableThreadStreamItems } from "../../support/thread-stream";

describe("chatReducer", () => {
  it("leaves composer restoration to its owner when the connection scope clears pending web context", () => {
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    const state = chatReducer(chatReducer(chatStateFixture(), { type: "composer/draft-set", draft: "" }), {
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: null,
        phase: "cancellable",
      },
    } as never);

    const cleared = chatReducer(state, { type: "connection/scoped-cleared" });

    expect(cleared.pendingSubmission).toBeNull();
    expect(cleared.composer.draft).toBe("");
  });

  it("keeps the panel draft when its restored thread resumes", () => {
    let state = chatReducer(chatStateFixture({ activeThread: { id: "thread-1" } }), {
      type: "composer/draft-set",
      draft: "Continue here",
    });
    state = chatReducer(state, { type: "connection/scoped-cleared" });

    const resumed = chatReducer(state, resumedThreadAction("thread-1"));

    expect(resumed.composer.draft).toBe("Continue here");
  });

  it("retargets only the explicitly preserved pending web submission when a thread resumes", () => {
    const pending = pendingWebSubmission("current-web", "committed");
    const state = chatReducer(chatStateFixture(), { type: "web-submission/pending", submission: pending });

    const preserved = chatReducer(state, {
      ...resumedThreadAction("resumed-thread"),
      preservePendingSubmissionId: "current-web",
    });
    const stale = chatReducer(state, {
      ...resumedThreadAction("resumed-thread"),
      preservePendingSubmissionId: "older-web",
    });

    expect(preserved.pendingSubmission).toEqual({ ...pending, targetThreadId: "resumed-thread" });
    expect(stale.pendingSubmission).toBeNull();
  });

  it.each([
    { label: "a different submission", phase: "committed", actionId: "older-web" },
    { label: "an uncommitted submission", phase: "cancellable", actionId: "current-web" },
  ] as const)("ignores an optimistic turn start owned by $label", ({ phase, actionId }) => {
    const state = chatReducer(chatStateFixture(), {
      type: "web-submission/pending",
      submission: pendingWebSubmission("current-web", phase),
    });
    const item = pendingWebSubmission("optimistic").item;

    const next = chatReducer(state, {
      type: "turn/optimistic-started",
      item,
      pendingTurnStart: { anchorItemId: item.id, promptSubmitHookItemIds: [] },
      pendingSubmissionId: actionId,
    });

    expect(next).toBe(state);
  });

  it("adopts an optimistic turn start from the matching committed web submission", () => {
    const state = chatReducer(chatStateFixture(), {
      type: "web-submission/pending",
      submission: pendingWebSubmission("current-web", "committed"),
    });
    const item = pendingWebSubmission("optimistic").item;

    const next = chatReducer(state, {
      type: "turn/optimistic-started",
      item,
      pendingTurnStart: { anchorItemId: item.id, promptSubmitHookItemIds: [] },
      pendingSubmissionId: "current-web",
    });

    expect(next.pendingSubmission).toBeNull();
    expect(next.activeTurn.activeSegment?.items).toEqual([item]);
  });

  it.each([
    {
      label: "commit",
      phase: "cancellable",
      action: { type: "web-submission/committed", submissionId: "older-web" },
    },
    {
      label: "cancel",
      phase: "cancellable",
      action: { type: "web-submission/cancelled", submissionId: "older-web" },
    },
    {
      label: "fail",
      phase: "committed",
      action: { type: "web-submission/failed", submissionId: "older-web" },
    },
    {
      label: "queue steer",
      phase: "committed",
      action: {
        type: "web-submission/steer-pending",
        submissionId: "older-web",
        item: pendingWebSubmission("adopted-web").item,
      },
    },
  ] as const)("ignores a stale $label callback after a newer web submission is pending", ({ phase, action }) => {
    let state = chatReducer(chatStateFixture(), {
      type: "web-submission/pending",
      submission: pendingWebSubmission("older-web"),
    });
    state = chatReducer(state, {
      type: "web-submission/pending",
      submission: pendingWebSubmission("newer-web", phase),
    });

    expect(chatReducer(state, action)).toBe(state);
  });

  it.each([
    {
      label: "commit an already committed submission",
      phase: "committed",
      action: { type: "web-submission/committed", submissionId: "current-web" },
    },
    {
      label: "cancel a committed submission",
      phase: "committed",
      action: { type: "web-submission/cancelled", submissionId: "current-web" },
    },
    {
      label: "fail a cancellable submission",
      phase: "cancellable",
      action: { type: "web-submission/failed", submissionId: "current-web" },
    },
    {
      label: "queue a cancellable steer",
      phase: "cancellable",
      action: {
        type: "web-submission/steer-pending",
        submissionId: "current-web",
        item: pendingWebSubmission("adopted-web").item,
      },
    },
  ] as const)("refuses to $label", ({ phase, action }) => {
    const state = chatReducer(chatStateFixture(), {
      type: "web-submission/pending",
      submission: pendingWebSubmission("current-web", phase),
    });

    expect(chatReducer(state, action)).toBe(state);
  });

  it("moves a committed web submission into the pending steer projection", () => {
    let state = chatStateFixture();
    state = chatReducer(state, {
      type: "web-submission/pending",
      submission: pendingWebSubmission("current-web", "committed"),
    });
    const adoptedItem = {
      ...pendingWebSubmission("adopted-web").item,
      clientId: "local-steer",
      contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      referencedFiles: [{ name: "Note.md", path: "/vault/Note.md" }],
      referencedThread: {
        threadId: "referenced-thread",
        title: "Referenced",
        includedTurns: 1,
        turnLimit: 20,
      },
    };

    const next = chatReducer(state, {
      type: "web-submission/steer-pending",
      submissionId: "current-web",
      item: adoptedItem,
    });

    expect(next.pendingSubmission).toBeNull();
    expect(chatStateThreadStreamItems(next)).toEqual([]);
    expect(next.activeTurn.pendingSteers).toEqual([adoptedItem]);
  });

  it("clears panel-scoped diagnostics on disconnect without owning shared resources", () => {
    let serverDiagnostics = createServerDiagnostics();
    serverDiagnostics = diagnosticsWithProbe(serverDiagnostics, diagnosticProbeOk("models", "1 model", 1));
    serverDiagnostics = diagnosticsWithProbe(serverDiagnostics, diagnosticProbeOk("skills", "1 skill", 2));
    serverDiagnostics = diagnosticsWithProbe(serverDiagnostics, diagnosticProbeOk("plugins", "1 plugin", 3));
    serverDiagnostics = {
      ...serverDiagnostics,
      mcpServers: [{ name: "local", startupStatus: "ready", authStatus: null, toolCount: 1, message: null }],
      toolInventory: {
        checkedAt: 3,
        plugins: [],
        pluginMarketplaceErrors: [],
        pluginsError: null,
        mcpServers: [],
        mcpDiagnostics: [],
        mcpError: null,
      },
    };
    const state = chatStateWith(chatStateFixture(), {
      connection: {
        initializeResponse: {
          codexHome: "/old/codex-home",
          platformFamily: "unix",
          platformOs: "macos",
          userAgent: "codex-old",
        },
        serverDiagnostics,
      },
    });

    const disconnected = chatReducer(state, { type: "connection/scoped-cleared" });
    expect(disconnected.connection.initializeResponse).toEqual(state.connection.initializeResponse);
    expect(disconnected.connection).not.toHaveProperty("runtimeConfig");
    expect(disconnected).not.toHaveProperty("threadList");
    expect(disconnected.connection.serverDiagnostics.probes.models.status).toBe("unknown");
    expect(disconnected.connection.serverDiagnostics.probes.skills.status).toBe("unknown");
    expect(disconnected.connection.serverDiagnostics.probes.plugins.status).toBe("unknown");
    expect(disconnected.connection.serverDiagnostics.mcpServers).toEqual([]);
    expect(disconnected.connection.serverDiagnostics.toolInventory).toBeNull();
  });

  it.each([
    { label: "interactive", provenance: { kind: "interactive" } as const },
    {
      label: "subagent",
      provenance: {
        kind: "subagent",
        subagentKind: "review",
        parentThreadId: "parent",
        sessionId: "session",
        depth: 1,
        agentNickname: "reviewer",
        agentRole: "review",
      } as const,
    },
  ])("keeps an active $label thread reconnectable across a same-context disconnect", ({ provenance }) => {
    let state = chatStateFixture({
      activeThread: {
        id: "active-thread",
        title: "Reconnect me",
        lifetime: { kind: "persistent" },
        provenance,
      },
    });
    state = withChatStateStableThreadStreamItems(state, [dialogueItem("retained-item")]);

    const disconnected = chatReducer(state, { type: "connection/scoped-cleared" });

    expect(disconnected.panelThread).toEqual({
      kind: "awaiting-resume",
      threadId: "active-thread",
      fallbackTitle: "Reconnect me",
      provenance,
    });
    expect(threadStreamStableItems(disconnected.threadStream)).toEqual([dialogueItem("retained-item")]);
  });

  it("expires an active ephemeral thread instead of making it reconnectable", () => {
    let state = chatStateFixture({
      activeThread: {
        id: "side-thread",
        title: "Side chat",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });
    state = withChatStateStableThreadStreamItems(state, [dialogueItem("side-item")]);

    const disconnected = chatReducer(state, { type: "connection/scoped-cleared" });

    expect(disconnected.panelThread).toEqual({ kind: "empty" });
    expect(threadStreamStableItems(disconnected.threadStream)).toEqual([]);
  });

  it("applies restored thread identity as an atomic thread-scoped transition", () => {
    const state = threadScopedResidue({ threadId: "old-thread", draft: "stale draft", itemId: "stale-item" });

    const restored = chatReducer(state, {
      type: "panel/restored-thread-applied",
      threadId: "restored-thread",
      fallbackTitle: "Restored title",
    });

    expect(restored.panelThread).toEqual({
      kind: "awaiting-resume",
      threadId: "restored-thread",
      fallbackTitle: "Restored title",
      provenance: null,
    });
    expect(restored.connection.statusText).toBe("Thread ready to resume.");
    expectThreadScopeReset(restored, { items: [] });

    const disconnected = chatReducer(restored, { type: "connection/scoped-cleared" });
    expect(disconnected.panelThread).toEqual(restored.panelThread);
  });

  it("invalidates an old panel lease even when navigation returns to the same thread", () => {
    let state = chatReducer(chatStateFixture(), resumedThreadAction("first"));
    const oldLease = capturePanelTargetLease(state);

    state = chatReducer(state, resumedThreadAction("second"));
    state = chatReducer(state, resumedThreadAction("first"));

    expect(panelTargetLeaseIsCurrent(state, oldLease)).toBe(false);
    expect(state.panelTargetRevision).toBeGreaterThan(oldLease.revision);
  });

  it("preserves a panel lease when an awaited thread becomes active", () => {
    let state = chatReducer(chatStateFixture(), {
      type: "panel/restored-thread-applied",
      threadId: "restored",
      fallbackTitle: "Restored",
    });
    const lease = capturePanelTargetLease(state);

    state = chatReducer(state, resumedThreadAction("restored"));

    expect(panelTargetLeaseIsCurrent(state, lease)).toBe(true);
  });

  it("ignores stale clear and resume transitions after the panel target changes", () => {
    let state = chatReducer(chatStateFixture(), resumedThreadAction("first"));
    const staleRevision = state.panelTargetRevision;
    state = chatReducer(state, resumedThreadAction("newer"));

    const staleClear = chatReducer(state, {
      type: "active-thread/cleared",
      expectedPanelTargetRevision: staleRevision,
    });
    const staleResume = chatReducer(state, {
      ...resumedThreadAction("stale-resume"),
      expectedPanelTargetRevision: staleRevision,
    });

    expect(staleClear).toBe(state);
    expect(staleResume).toBe(state);
    expect(activeThreadState(state)?.id).toBe("newer");
  });

  it("applies clear and resume transitions with the current panel target revision", () => {
    const state = chatReducer(chatStateFixture(), resumedThreadAction("current"));
    const currentRevision = state.panelTargetRevision;

    const cleared = chatReducer(state, {
      type: "active-thread/cleared",
      expectedPanelTargetRevision: currentRevision,
    });
    const resumed = chatReducer(state, {
      ...resumedThreadAction("next"),
      expectedPanelTargetRevision: currentRevision,
    });

    expect(cleared.panelThread).toEqual({ kind: "empty" });
    expect(cleared.panelTargetRevision).toBeGreaterThan(currentRevision);
    expect(activeThreadState(resumed)?.id).toBe("next");
    expect(resumed.panelTargetRevision).toBeGreaterThan(currentRevision);
  });

  it("invalidates the panel target when clearing an already empty thread scope", () => {
    const state = chatStateFixture();

    const cleared = chatReducer(state, {
      type: "active-thread/cleared",
      expectedPanelTargetRevision: state.panelTargetRevision,
    });

    expect(cleared.panelThread).toEqual({ kind: "empty" });
    expect(cleared.panelTargetRevision).toBe(state.panelTargetRevision + 1);
  });

  it("keeps active-only metadata out of the awaiting-resume phase", () => {
    let state = chatReducer(chatStateFixture(), {
      type: "panel/restored-thread-applied",
      threadId: "restored-thread",
      fallbackTitle: "Restored title",
    });
    const awaitingResume = state.panelThread;

    const usage = {
      total: { totalTokens: 1, inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      last: { totalTokens: 1, inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      modelContextWindow: 100,
    };
    state = chatReducer(state, { type: "active-thread/token-usage-set", tokenUsage: usage });
    state = chatReducer(state, { type: "active-thread/goal-set", goal: goal("restored-thread") });
    state = chatReducer(state, { type: "turn/started", threadId: "other-thread", turnId: "stale-turn" });

    expect(state.panelThread).toEqual(awaitingResume);
    expect(state.activeTurn.lifecycle).toEqual({ kind: "idle" });
  });

  it("clears active turn and thread-scoped state", () => {
    let state = threadScopedResidue({ draft: "keep me", itemId: "m1" });
    state = chatStateWith(state, {
      runtime: {
        active: {
          model: "gpt-5.1",
          reasoningEffort: "high",
          serviceTier: "fast",
          approvalsReviewer: "auto_review",
          activePermissionProfile: { id: ":workspace", extends: null },
        },
      },
    });
    let pendingState = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.2" });
    pendingState = chatReducer(pendingState, { type: "runtime/permission-profile-requested", permissionProfile: ":read-only" });
    pendingState = chatReducer(pendingState, { type: "runtime/reasoning-effort-requested", effort: "medium" });
    pendingState = chatReducer(pendingState, { type: "runtime/fast-mode-requested", fastMode: "disabled" });
    pendingState = chatReducer(pendingState, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "user" });

    const next = chatReducer(pendingState, { type: "active-thread/cleared" });

    expect(next.panelThread).toEqual({ kind: "empty" });
    expect(next.runtime.active.model).toBeNull();
    expect(next.runtime.active.reasoningEffort).toBeNull();
    expect(next.runtime.active.serviceTier).toBeNull();
    expect(next.runtime.active.approvalsReviewer).toBeNull();
    expect(next.runtime.active.activePermissionProfile).toBeNull();
    expect(next.runtime.active.collaborationMode).toBeNull();
    expect(next.runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(next.runtime.pending.permissionProfile).toEqual({ kind: "unchanged" });
    expect(next.runtime.pending.reasoningEffort).toEqual({ kind: "unchanged" });
    expect(next.runtime.pending.fastMode).toEqual({ kind: "unchanged" });
    expect(next.runtime.pending.approvalsReviewer).toEqual({ kind: "unchanged" });
    expect(next.runtime.pending.collaborationMode).toEqual({ kind: "unchanged" });
    expectThreadScopeReset(next, { items: [] });
  });

  it("resets thread-scoped state when resuming a thread", () => {
    const state = threadScopedResidue({ threadId: "previous-thread", turnId: "previous-turn" });
    const resumedItems = [dialogueItem("resumed-message")];

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("resumed-thread"),
      model: "gpt-5.1",
      reasoningEffort: "high",
      serviceTier: "fast",
      approvalsReviewer: "user",
      items: resumedItems,
    });

    expect(activeThreadState(next)).toMatchObject({ id: "resumed-thread", goal: null });
    expect(next.runtime.active.collaborationMode).toBeNull();
    expect(next.runtime.pending.collaborationMode).toEqual({ kind: "unchanged" });
    expectThreadScopeReset(next, { items: resumedItems });
  });

  it("preserves empty-panel runtime reservations when thread activation explicitly requests it", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.5" });
    state = chatReducer(state, { type: "runtime/permission-profile-requested", permissionProfile: ":workspace" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-requested", effort: "high" });
    state = chatReducer(state, { type: "runtime/fast-mode-requested", fastMode: "enabled" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });
    state = chatReducer(state, { type: "runtime/requested-collaboration-mode-set", collaborationMode: "plan" });

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("started-thread"),
      model: "gpt-5",
      reasoningEffort: "medium",
      serviceTier: "fast",
      approvalsReviewer: "user",
      preserveRequestedRuntimeSettings: true,
    });

    expect(activeThreadState(next)?.id).toBe("started-thread");
    expect(next.runtime.active.model).toBe("gpt-5");
    expect(next.runtime.active.reasoningEffort).toBe("medium");
    expect(next.runtime.active.serviceTier).toBe("fast");
    expect(next.runtime.active.approvalsReviewer).toBe("user");
    expect(next.runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(next.runtime.pending.permissionProfile).toEqual({ kind: "set", value: ":workspace" });
    expect(next.runtime.pending.reasoningEffort).toEqual({ kind: "set", value: "high" });
    expect(next.runtime.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(next.runtime.pending.approvalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(next.runtime.pending.collaborationMode).toEqual(setCollaborationModeIntent("plan"));
    expect(next.runtime.active.collaborationMode).toBeNull();
  });

  it("keeps reset and set permission profile requests explicit", () => {
    let state = chatStateFixture();

    state = chatReducer(state, { type: "runtime/permission-profile-requested", permissionProfile: ":workspace" });

    expect(state.runtime.pending.permissionProfile).toEqual(setRuntimeIntentValue(":workspace"));

    state = chatReducer(state, { type: "runtime/permission-profile-reset-to-config" });

    expect(state.runtime.pending.permissionProfile).toEqual({ kind: "resetToConfig" });
  });

  it("starts resumed threads with empty display state when no history items are supplied", () => {
    let state = chatStateFixture();
    state = withChatStateStableThreadStreamItems(state, [dialogueItem("previous-message")]);

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("resumed-thread"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    expect(chatStateThreadStreamItems(next)).toEqual([]);
  });

  it("clears running state when a turn start fails", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeTurn: { lifecycle: { kind: "starting", pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook"] } } },
    });

    const next = chatReducer(state, { type: "turn/start-failed", items: [] });

    expect(chatTurnBusy(next.activeTurn)).toBe(false);
    expect(activeTurnId(next.activeTurn)).toBeNull();
    expect(pendingTurnStart(next.activeTurn)).toBeNull();
  });

  it("ignores stale turn start failures after the turn is already running", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeTurn: { lifecycle: { kind: "running", turnId: "turn" } } });
    state = withChatStateStableThreadStreamItems(state, [dialogueItem("existing")]);

    const next = chatReducer(state, { type: "turn/start-failed", items: [] });

    expect(chatTurnBusy(next.activeTurn)).toBe(true);
    expect(activeTurnId(next.activeTurn)).toBe("turn");
    expect(chatStateThreadStreamItems(next)).toEqual([dialogueItem("existing")]);
  });

  it("clears turn-scoped requests when clearing the local turn scope", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeTurn: { lifecycle: { kind: "running", turnId: "turn" } } });
    state = chatStateWith(state, { requests: { approvals: [approval(1)] } });
    state = chatStateWith(state, { requests: { pendingUserInputs: [userInput(2)] } });
    state = chatStateWith(state, { requests: { userInputDrafts: new Map([["2:note", "draft"]]) } });
    state = withChatStateStableThreadStreamItems(state, [dialogueItem("kept")]);
    state = chatStateWith(state, { ui: { disclosures: { approvalDetails: new Set(["1:details"]) } } });
    state = chatStateWith(state, { ui: { disclosures: { textDetails: new Set(["kept:details"]) } } });
    state = chatReducer(state, {
      type: "subagent-activity/tracked",
      threadId: "child",
      parentTurnId: "turn",
    });

    const next = chatReducer(state, { type: "turn/scoped-cleared" });

    expect(chatTurnBusy(next.activeTurn)).toBe(false);
    expect(activeTurnId(next.activeTurn)).toBeNull();
    expect(next.requests.approvals).toEqual([]);
    expect(next.requests.pendingUserInputs).toEqual([]);
    expect(next.requests.userInputDrafts.size).toBe(0);
    expect(chatStateThreadStreamItems(next)).toEqual([dialogueItem("kept")]);
    expect(next.activeTurn.subagents.byThreadId.size).toBe(0);
    expect([...next.ui.disclosures.approvalDetails]).toEqual([]);
    expect([...next.ui.disclosures.textDetails]).toEqual(["kept:details"]);
  });

  it("resolves requests while optionally appending a result item", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { requests: { approvals: [approval(1)] } });
    state = chatStateWith(state, { requests: { pendingUserInputs: [userInput(2)] } });
    state = chatStateWith(state, {
      requests: {
        userInputDrafts: new Map([
          ["2:note", "draft"],
          ["2:note:other", "other draft"],
        ]),
      },
    });
    state = withChatStateStableThreadStreamItems(state, [dialogueItem("existing")]);
    state = chatStateWith(state, { ui: { disclosures: { approvalDetails: new Set(["1:details"]) } } });
    state = chatStateWith(state, { ui: { disclosures: { textDetails: new Set(["existing:details"]) } } });

    const withoutResult = chatReducer(state, { type: "request/resolved", requestId: 1 });
    expect(withoutResult.requests.approvals).toEqual([]);
    expect(withoutResult.requests.pendingUserInputs).toEqual([userInput(2)]);
    expect(chatStateThreadStreamItems(withoutResult)).toEqual([dialogueItem("existing")]);
    expect([...withoutResult.ui.disclosures.approvalDetails]).toEqual([]);
    expect([...withoutResult.ui.disclosures.textDetails]).toEqual(["existing:details"]);

    const resultItem = dialogueItem("result");
    const withResult = chatReducer(withoutResult, { type: "request/resolved", requestId: 2, resultItem });
    expect(withResult.requests.pendingUserInputs).toEqual([]);
    expect(withResult.requests.userInputDrafts.size).toBe(0);
    expect(chatStateThreadStreamItems(withResult)).toEqual([dialogueItem("existing"), resultItem]);
    expect([...withResult.ui.disclosures.textDetails]).toEqual(["existing:details"]);
  });

  it("ignores stale request resolutions without appending result items", () => {
    let state = chatStateFixture();
    state = withChatStateStableThreadStreamItems(state, [dialogueItem("existing")]);
    state = chatStateWith(state, { ui: { disclosures: { textDetails: new Set(["existing:details"]) } } });

    const next = chatReducer(state, { type: "request/resolved", requestId: 99, resultItem: dialogueItem("stale result") });

    expect(chatStateThreadStreamItems(next)).toEqual([dialogueItem("existing")]);
    expect([...next.ui.disclosures.textDetails]).toEqual(["existing:details"]);

    let running = chatStateFixture({ activeTurn: { lifecycle: { kind: "running", turnId: "current-turn" } } });
    running = chatStateWith(running, { requests: { approvals: [approval(99)] } });
    running = withChatStateStableThreadStreamItems(running, [dialogueItem("existing")]);
    const staleResult = { ...dialogueItem("stale result"), turnId: "old-turn" } satisfies ThreadStreamItem;
    const settled = chatReducer(running, { type: "request/resolved", requestId: 99, resultItem: staleResult });

    expect(settled.requests.approvals).toEqual([]);
    expect(chatStateThreadStreamItems(settled)).toEqual([dialogueItem("existing")]);
  });

  it("ignores turn start acknowledgements after the turn has already gone idle", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeTurn: { lifecycle: { kind: "idle" } } });

    const next = chatReducer(state, {
      type: "turn/start-acknowledged",
      turnId: "completed-turn",
      items: [{ id: "local-user", kind: "dialogue", dialogueKind: "user", role: "user", text: "hello", turnId: "completed-turn" }],
    });

    expect(chatTurnBusy(next.activeTurn)).toBe(false);
    expect(activeTurnId(next.activeTurn)).toBeNull();
  });

  it("ignores completed turns while a new turn is still starting", () => {
    const pending = { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook"] };
    let state = chatStateFixture();
    state = chatStateWith(state, { activeTurn: { lifecycle: { kind: "starting", pendingTurnStart: pending } } });
    state = withChatStateStableThreadStreamItems(state, [
      { id: "local-user", kind: "dialogue", dialogueKind: "user", role: "user", text: "hello" },
    ]);

    const next = chatReducer(state, {
      type: "turn/completed",
      turnId: "stale-turn",
      status: "completed",
      items: [],
    });

    expect(chatTurnBusy(next.activeTurn)).toBe(true);
    expect(pendingTurnStart(next.activeTurn)).toEqual(pending);
    expect(chatStateThreadStreamItems(next)).toEqual(chatStateThreadStreamItems(state));
  });

  it("preserves unknown service tier state when resuming from active runtime", () => {
    const state = chatReducer(chatStateFixture(), {
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread"),
      model: "gpt-5.1",
      reasoningEffort: "high",
      serviceTier: null,
      serviceTierKnown: false,
      approvalsReviewer: "user",
    });

    expect(state.runtime.active.serviceTier).toBeNull();
    expect(state.runtime.active.serviceTierKnown).toBe(false);
  });

  it("updates composer suggestions when insertion-only fields change", () => {
    const initialSuggestion = {
      display: "Alpha",
      detail: "alpha.md",
      replacement: "[[Alpha]]",
      start: 0,
      tabCursorOffset: -2,
    } satisfies ChatState["composer"]["suggestions"][number];
    const nextSuggestion = {
      ...initialSuggestion,
      tabCursorOffset: 0,
      suffixOnInsert: "]]",
    } satisfies ChatState["composer"]["suggestions"][number];

    let state = chatReducer(chatStateFixture(), { type: "composer/suggestions-set", suggestions: [initialSuggestion] });
    state = chatReducer(state, { type: "composer/suggestions-set", suggestions: [nextSuggestion] });

    expect(state.composer.suggestions).toEqual([nextSuggestion]);
  });

  it("accepts the first composer suggestion as an explicit selection", () => {
    const suggestions = [suggestion("/plan"), suggestion("/status")];
    let state = chatReducer(chatStateFixture(), { type: "composer/suggestions-set", suggestions, selected: 1 });

    state = chatReducer(state, { type: "composer/suggestions-set", suggestions, selected: 0 });

    expect(state.composer.suggestSelected).toBe(0);
  });

  it("stores updates through ChatStateStore without mutating the initial snapshot", () => {
    let initial = chatStateFixture();
    initial = withChatStateStableThreadStreamItems(initial, [dialogueItem("initial")]);
    const store = createChatStateStore(initial);

    store.dispatch({ type: "thread-stream/item-upserted", item: dialogueItem("next") });

    expect(chatStateThreadStreamItems(initial)).toEqual([dialogueItem("initial")]);
    expect(chatStateThreadStreamItems(store.getState())).toEqual([dialogueItem("initial"), dialogueItem("next")]);
  });

  it("keeps panel-local thread, request, and composer state isolated across stores", () => {
    const panelA = createChatStateStore();
    const panelB = createChatStateStore();

    panelA.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread-a"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    panelA.dispatch({ type: "composer/draft-set", draft: "panel A draft" });
    panelA.dispatch({ type: "request/user-input-queued", input: userInput(1) });
    panelA.dispatch({ type: "request/user-input-draft-set", key: "1:note", value: "panel A answer" });

    panelB.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread-b"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    panelB.dispatch({ type: "composer/draft-set", draft: "panel B draft" });
    panelB.dispatch({ type: "request/user-input-queued", input: userInput(2) });
    panelB.dispatch({ type: "request/user-input-draft-set", key: "2:note", value: "panel B answer" });

    panelA.dispatch({ type: "request/resolved", requestId: 1 });
    panelA.dispatch({ type: "active-thread/cleared" });

    expect(panelA.getState()).toMatchObject({
      panelThread: { kind: "empty" },
      composer: { draft: "" },
      requests: { pendingUserInputs: [] },
    });
    expect(panelA.getState().requests.userInputDrafts.size).toBe(0);

    expect(panelB.getState()).toMatchObject({
      panelThread: { kind: "active", thread: { id: "thread-b" } },
      composer: { draft: "panel B draft" },
      requests: { pendingUserInputs: [expect.objectContaining({ requestId: 2 })] },
    });
    expect(panelB.getState().requests.userInputDrafts.get("2:note")).toBe("panel B answer");
  });
});

function dialogueItem(id: string): ThreadStreamItem {
  return { id, kind: "dialogue", role: "assistant", text: id, dialogueKind: "assistantResponse", dialogueState: "completed" };
}

function pendingWebSubmission(
  id: string,
  phase: NonNullable<ChatState["pendingSubmission"]>["phase"] = "cancellable",
): NonNullable<ChatState["pendingSubmission"]> {
  const item = pendingWebSubmissionItem(id, "https://example.com", "summarize");
  if (!item) throw new Error("Expected pending web submission");
  return {
    id,
    item,
    targetThreadId: null,
    phase,
  };
}

function threadScopedResidue(options: { threadId?: string; turnId?: string; draft?: string; itemId?: string } = {}): ChatState {
  const threadId = options.threadId ?? "thread";
  const turnId = options.turnId ?? "turn";
  let state = chatStateFixture({
    activeThread: { id: threadId, goal: goal(threadId) },
    activeTurn: { lifecycle: { kind: "running", turnId } },
    runtime: {
      active: { collaborationMode: "plan" },
      pending: { collaborationMode: setCollaborationModeIntent("plan") },
    },
    threadStream: {
      historyCursor: "cursor",
      loadingHistory: true,
      turnDiffs: new Map([[turnId, "@@"]]),
    },
    requests: {
      approvals: [approval(1)],
      pendingUserInputs: [userInput(2)],
      userInputDrafts: new Map([["2:note", "draft"]]),
    },
    composer: {
      draft: options.draft ?? "previous draft",
      suggestSelected: 1,
      suggestions: [suggestion("/plan")],
      suggestionsDismissedSignature: "dismissed",
    },
    ui: {
      disclosures: {
        approvalDetails: new Set(["1:details"]),
        textDetails: new Set(["previous:details"]),
      },
      threadStreamActionMenu: { forkMenuItemId: "previous" },
      goalEditor: { kind: "editing", threadId, objectiveDraft: "draft", tokenBudgetDraft: null },
    },
  });
  state = withChatStateStableThreadStreamItems(state, [dialogueItem(options.itemId ?? "previous-message")]);
  return state;
}

function expectThreadScopeReset(state: ChatState, options: { items: readonly ThreadStreamItem[] }): void {
  expect(activeTurnId(state.activeTurn)).toBeNull();
  expect(chatStateThreadStreamItems(state)).toEqual(options.items);
  expect(state.threadStream.turnDiffs.size).toBe(0);
  expect(state.threadStream.historyCursor).toBeNull();
  expect(state.threadStream.loadingHistory).toBe(false);
  expect(state.requests.approvals).toEqual([]);
  expect(state.requests.pendingUserInputs).toEqual([]);
  expect(state.requests.userInputDrafts.size).toBe(0);
  expect(state.composer.draft).toBe("");
  expect(state.composer.suggestSelected).toBe(0);
  expect(state.composer.suggestions).toEqual([]);
  expect(state.composer.suggestionsDismissedSignature).toBeNull();
  expect(uiDisclosureCount(state)).toBe(0);
  expect(state.ui.threadStreamActionMenu.forkMenuItemId).toBeNull();
  expect(state.ui.goalEditor.kind).toBe("closed");
}

function suggestion(display: string): ChatState["composer"]["suggestions"][number] {
  return { display, detail: "Plan mode", replacement: display, start: 0, appendSpaceOnInsert: true };
}

function approval(requestId: number): ChatState["requests"]["approvals"][number] {
  return {
    requestId,
    kind: "command",
    turnId: "turn",
    title: "Command approval",
    summary: "Need access\npwd",
    resultSummary: "Need access",
    details: [
      { key: "reason", value: "Need access" },
      { key: "command", value: "pwd" },
      { key: "cwd", value: "/tmp" },
    ],
    actionOptions: null,
  };
}

function userInput(requestId: number): ChatState["requests"]["pendingUserInputs"][number] {
  return {
    requestId,
    params: {
      turnId: "turn",
      questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
    },
  };
}

function goal(threadId: string): ThreadGoal {
  return {
    threadId,
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function uiDisclosureCount(state: ChatState): number {
  const disclosures = state.ui.disclosures;
  return (
    disclosures.details.size +
    disclosures.activityGroups.size +
    disclosures.textDetails.size +
    disclosures.userDialogueExpanded.size +
    disclosures.goalObjectiveExpanded.size +
    disclosures.approvalDetails.size
  );
}

function thread(id: string): Thread {
  return {
    id,
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
  };
}

function resumedThreadAction(threadId: string) {
  return {
    type: "active-thread/resumed" as const,
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: thread(threadId),
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  };
}
