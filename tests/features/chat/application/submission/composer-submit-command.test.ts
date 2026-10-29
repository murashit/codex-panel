import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { Thread } from "../../../../../src/domain/threads/model";
import { createThreadReferenceResolver } from "../../../../../src/features/chat/app-server/adapters/thread-reference-resolver";
import { createChatInboundHandler } from "../../../../../src/features/chat/app-server/inbound/handler";
import type { ComposerAttachment } from "../../../../../src/features/chat/application/composer/attachments";
import type { ComposerInputOptions } from "../../../../../src/features/chat/application/composer/input";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import { executeContextSlashCommand } from "../../../../../src/features/chat/application/slash-commands/execute-context";
import { createChatState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  type ComposerSubmitCommandHost,
  submitComposer,
} from "../../../../../src/features/chat/application/submission/composer-submit-command";
import { createTurnSubmissionCommand } from "../../../../../src/features/chat/application/submission/turn-submission-command";
import { createGoalCommands } from "../../../../../src/features/chat/application/threads/goal-commands";
import { createThreadStartCommand } from "../../../../../src/features/chat/application/threads/thread-start-command";
import { canSwitchToThread } from "../../../../../src/features/chat/application/threads/thread-switching";
import { chatTurnBusy } from "../../../../../src/features/chat/application/turns/turn-state";
import { appServerTurnFixture } from "../../../../support/app-server-records";
import { deferred } from "../../../../support/async";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";
import {
  attachmentFixture,
  attachmentSaveResult,
  contextProvider,
  installComposerInputFixtures,
  noteProvider,
  sharedResourcesFixture,
} from "../../support/composer-input-fixture";
import { chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems } from "../../support/thread-stream";
import { pendingWebSubmissionFixture } from "../../support/web-submission";

function thread(id: string): Thread {
  return panelThreadFixture({
    id,
    createdAt: 0,
    updatedAt: 0,
  });
}

const createInput = installComposerInputFixtures();

function createHost(draft: string, options: { subagent?: boolean; input?: Partial<ComposerInputOptions> } = {}) {
  const stateStore =
    options.input?.stateStore ??
    createChatStateStore(
      options.subagent
        ? chatStateWith(createChatState(), { activeThread: { id: "child", provenance: { kind: "subagent", parentThreadId: "parent" } } })
        : createChatState(),
    );
  const fixture = createInput({ sourcePath: () => "snapshot.md", ...options.input, stateStore });
  fixture.input.setDraft(draft);
  // Double the external effects, keeping input consumption and turn settlement real.
  const startTurn = vi.fn().mockResolvedValue({ kind: "completed", value: { turnId: "turn" } });
  const interruptTurn = vi.fn().mockResolvedValue(true);
  const turnPort = { startTurn, interruptTurn, steerTurn: vi.fn().mockResolvedValue({ kind: "completed", value: undefined }) };
  const execute = vi.fn<ComposerSubmitCommandHost["slashCommandExecutor"]["execute"]>().mockResolvedValue(undefined);
  const showLatest = vi.fn();
  const ensureConnected = vi.fn().mockResolvedValue(true);
  const status = { setStatus: vi.fn(), addSystemMessage: vi.fn() };
  const localItemIds = createLocalIdSource();
  const starter = createThreadStartCommand({
    stateStore,
    withThreadActivation: async (operation) => operation(),
    onThreadActivated: vi.fn(),
    hydrateCreatedFork: vi.fn().mockResolvedValue(undefined),
    runtimeSnapshotForState: (state) => runtimeSnapshotForChatState(state, sharedResourcesFixture()),
    recordStartedThread: vi.fn(),
    effects: {
      forkSideChat: vi.fn(),
      forkThread: vi.fn(),
      startThread: vi.fn().mockResolvedValue({ kind: "completed", value: threadActivationFixture(thread("thread")) }),
    },
  });
  const ensureRestoredThreadLoaded = vi.fn().mockResolvedValue(true);
  const host = {
    stateStore,
    localItemIds,
    resolveFileReference: options.input?.noteCandidateProvider?.resolveFileReference ?? (() => null),
    composer: fixture.input,
    slashCommandExecutor: { execute },
    turnSubmissionCommand: createTurnSubmissionCommand({
      stateStore,
      localItemIds,
      turnPort,
      ensureConnected,
      ensureRestoredThreadLoaded: (): Promise<boolean> => host.ensureRestoredThreadLoaded(),
      startThread: starter.startThread,
      applyPendingThreadSettings: vi.fn().mockResolvedValue(true),
      forkReplacement: { beginPublication: vi.fn(), latestTurnId: vi.fn(), archiveSource: vi.fn(), notify: vi.fn() },
      ...status,
    }),
    connection: { ensureConnected },
    turnPort,
    status,
    scroll: { showLatest },
    ensureRestoredThreadLoaded,
  };
  return { ...fixture, host, ensureConnected, execute, interruptTurn, startTurn, showLatest, starter };
}

describe("submitComposer", () => {
  it("consumes the draft before restored-thread loading and sends that input after a newer edit", async () => {
    const restored = deferred<boolean>();
    const { host, input, startTurn } = createHost("first message");
    host.ensureRestoredThreadLoaded.mockImplementation(() => restored.promise);
    const submitting = submitComposer(host);
    expect(input.draft).toBe("");
    expect(input.isSubmissionPreparing()).toBe(true);
    expect(startTurn).not.toHaveBeenCalled();
    input.setDraft("next message");
    restored.resolve(true);
    await submitting;
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ input: [{ type: "text", text: "first message" }] }));
    expect(input.draft).toBe("next message");
    expect(input.isSubmissionPreparing()).toBe(false);
  });

  it("restores consumed input when a web submission appears during thread loading", async () => {
    const restored = deferred<boolean>();
    const { host, input, startTurn, stateStore } = createHost("first message");
    host.ensureRestoredThreadLoaded.mockImplementation(() => restored.promise);
    const submitting = submitComposer(host);
    expect(input.draft).toBe("");
    stateStore.dispatch({ type: "web-submission/pending", submission: pendingWebSubmissionFixture(null) });
    restored.resolve(true);
    await submitting;
    expect(startTurn).not.toHaveBeenCalled();
    expect(input.draft).toBe("first message");
    expect(input.isSubmissionPreparing()).toBe(false);
  });

  it("does not restore a consumed draft into another panel after thread loading", async () => {
    const restored = deferred<boolean>();
    const { host, input, startTurn, stateStore } = createHost("first message");
    host.ensureRestoredThreadLoaded.mockImplementation(() => restored.promise);
    const submitting = submitComposer(host);
    resumeActiveThread(stateStore, "other");
    input.setDraft("other draft");
    restored.resolve(true);
    await submitting;
    expect(startTurn).not.toHaveBeenCalled();
    expect(input.draft).toBe("other draft");
    expect(input.isSubmissionPreparing()).toBe(false);
  });

  it("does not cancel or restore a committed web submission", async () => {
    const { host, execute, stateStore } = createHost("");
    const pending = pendingWebSubmissionFixture(null, { phase: "committed" });
    stateStore.dispatch({ type: "web-submission/pending", submission: pending });
    await submitComposer(host);
    expect(stateStore.getState().pendingSubmission).toEqual(pending);
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks composer submission from subagent threads without losing the draft", async () => {
    const { host, input, execute, startTurn } = createHost("hello", { subagent: true });
    await submitComposer(host);
    expect(execute).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
    expect(input.draft).toBe("hello");
    expect(host.status.addSystemMessage).toHaveBeenCalledWith("Messages are unavailable in agent threads. Start a new chat to continue.");
  });

  it("shows the latest message before sending plain text and consumes accepted input", async () => {
    const { host, input, startTurn, showLatest } = createHost("hello");
    await submitComposer(host);
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ input: [{ type: "text", text: "hello" }] }));
    expect(showLatest).toHaveBeenCalledOnce();
    expect(showLatest.mock.invocationCallOrder[0]).toBeLessThan(startTurn.mock.invocationCallOrder[0] ?? 0);
    expect(input.draft).toBe("");
    expect(input.isSubmissionPreparing()).toBe(false);
  });

  it.each(["before /status", "/status!", "/unknown"])("sends %s as text instead of executing a slash command", async (draft) => {
    const { host, execute, startTurn } = createHost(draft);
    await submitComposer(host);
    expect(execute).not.toHaveBeenCalled();
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ input: [{ type: "text", text: draft }] }));
  });

  it("accepts a slash command with surrounding composer whitespace", async () => {
    const { host, input, execute, startTurn } = createHost("  /status  ");
    await submitComposer(host);
    expect(execute).toHaveBeenCalledWith("status", "", expect.objectContaining({ sourcePath: "snapshot.md" }), expect.anything());
    expect(startTurn).not.toHaveBeenCalled();
    expect(input.draft).toBe("");
  });

  it.each(["[[Alpha]]", "/plan [[Alpha]]"])("releases the claim and restores %s when input preparation fails", async (draft) => {
    const { host, input, execute, startTurn } = createHost(draft, {
      input: {
        noteCandidateProvider: noteProvider({
          resolveFileReference: () => {
            throw new Error("note resolution failed");
          },
        }),
      },
    });
    execute.mockResolvedValue({ sendText: "[[Alpha]]" });
    await expect(submitComposer(host)).rejects.toThrow("note resolution failed");
    expect(input.draft).toBe(draft);
    expect(input.isSubmissionPreparing()).toBe(false);
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("prepares /plan with claim-time context after connection and restores the draft on turn failure", async () => {
    let activeNote = { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" };
    const { host, input, ensureConnected, execute, startTurn } = createHost("/plan Summarize", {
      input: { referenceActiveNoteOnSend: () => true, contextReferenceProvider: contextProvider(() => ({ activeNote, selection: null })) },
    });
    const connection = deferred<boolean>();
    ensureConnected.mockImplementation(() => connection.promise);
    execute.mockResolvedValue({ sendText: "Summarize" });
    startTurn.mockRejectedValue(new Error("turn failed"));
    const sending = submitComposer(host);
    await vi.waitFor(() => expect(ensureConnected).toHaveBeenCalled());
    activeNote = { name: "Beta", path: "notes/Beta.md", linktext: "Beta" };
    input.setDraft("Next message");
    connection.resolve(true);
    await sending;
    expect(execute).toHaveBeenCalledWith(
      "plan",
      "Summarize",
      expect.objectContaining({
        sourcePath: "snapshot.md",
        contextReferences: { activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" }, selection: null },
      }),
      { isCurrent: expect.any(Function), adoptPanelTarget: expect.any(Function) },
    );
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [
          { type: "text", text: "Summarize" },
          { type: "fileReference", name: "<active>", path: "notes/Alpha.md" },
          {
            type: "additionalContext",
            key: "codex_panel_obsidian_context",
            kind: "untrusted",
            value: "Obsidian references for the current user input:\n- <active> -> notes/Alpha.md",
          },
        ],
      }),
    );
    expect(input.draft).toBe("/plan Summarize\n\nNext message");
    expect(input.isSubmissionPreparing()).toBe(false);
    expect(host.status.addSystemMessage).toHaveBeenCalledExactlyOnceWith("turn failed");
  });

  it("passes prepared slash input through to the turn without preparing it again", async () => {
    const { host, execute, startTurn } = createHost("/refer Other [[Note]]");
    execute.mockResolvedValue({ sendInput: { text: "[[Note]]", input: [{ type: "text", text: "referenced input" }] } });
    await submitComposer(host);
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ input: [{ type: "text", text: "referenced input" }] }));
  });

  it("restores the original slash draft when prepared web input cannot start a turn", async () => {
    const { host, input, execute, startTurn, stateStore } = createHost("/web https://example.com [[Note]]");
    const prepared = [
      { type: "text" as const, text: "https://example.com/ [[Note]]" },
      { type: "additionalContext" as const, key: "codex_panel_web_context", kind: "untrusted" as const, value: "Readable article" },
      { type: "fileReference" as const, name: "Note", path: "Note.md" },
    ];
    execute.mockResolvedValue({ sendInput: { text: "https://example.com/ [[Note]]", input: prepared } });
    startTurn.mockResolvedValue({ kind: "not-started" });
    await submitComposer(host);
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ input: prepared }));
    expect(input.draft).toBe("/web https://example.com [[Note]]");
    expect(input.isSubmissionPreparing()).toBe(false);
    expect(stateStore.getState().pendingSubmission).toBeNull();
  });

  it("shows a pending web message during fetch and retains its identity through the turn", async () => {
    const { host, input, execute, startTurn, showLatest, stateStore } = createHost("/web https://example.com summarize");
    const fetch = deferred<{ sendInput: { text: string; input: [{ type: "text"; text: string }] } }>();
    execute.mockImplementation(() => fetch.promise);
    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const pending = stateStore.getState().pendingSubmission?.item;
    expect(pending).toMatchObject({
      kind: "dialogue",
      text: "https://example.com/ summarize",
      contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      provenance: { source: "localUser", channel: "preflight" },
    });
    expect(showLatest).toHaveBeenCalledOnce();
    expect(startTurn).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    fetch.resolve({ sendInput: { text: "https://example.com/ summarize", input: [{ type: "text", text: "prepared" }] } });
    await submitting;
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ input: [{ type: "text", text: "prepared" }] }));
    expect(chatStateThreadStreamItems(stateStore.getState())).toContainEqual(
      expect.objectContaining({ id: pending?.id, text: "https://example.com/ summarize" }),
    );
    expect(input.draft).toBe("");
    expect(stateStore.getState().pendingSubmission).toBeNull();
  });

  it.each(["success", "failure"])("restores a cancelled web draft once and ignores late fetch %s", async (outcome) => {
    const draft = "  /web https://example.com summarize  ";
    const { host, input, execute, startTurn, stateStore, fetch } = webFetchHost(draft);
    const first = submitComposer(host);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await submitComposer(host);
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(input.draft).toBe(draft);
    expect(input.isSubmissionPreparing()).toBe(false);
    if (outcome === "success") fetch.resolve({ sendText: "https://example.com/ summarize" });
    else fetch.reject(new Error("offline"));
    await first;
    expect(input.draft).toBe(draft);
    expect(startTurn).not.toHaveBeenCalled();
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
  });

  it.each([true, false])("ignores late connection result %s after explicit web cancellation", async (connected) => {
    const draft = "/web https://example.com summarize";
    const { host, input, ensureConnected, execute, stateStore } = createHost(draft);
    const connecting = deferred<boolean>();
    ensureConnected.mockImplementation(() => connecting.promise);
    const first = submitComposer(host);
    await vi.waitFor(() => expect(stateStore.getState().pendingSubmission).not.toBeNull());
    await submitComposer(host);
    expect(input.draft).toBe(draft);
    connecting.resolve(connected);
    await first;
    expect(execute).not.toHaveBeenCalled();
    expect(input.draft).toBe(draft);
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not create pending UI for a web URL containing credentials", async () => {
    const { host, execute, stateStore } = createHost("/web https://user:secret@example.com/article summarize");
    const reading = deferred<undefined>();
    execute.mockImplementation(() => reading.promise);
    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(stateStore.getState().pendingSubmission).toBeNull();
    reading.resolve(undefined);
    await submitting;
  });

  it.each(["success", "failure"])("does not publish or restore stale web fetch %s after changing threads", async (outcome) => {
    const { host, input, execute, startTurn, stateStore, fetch } = webFetchHost("/web https://example.com summarize");
    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    resumeActiveThread(stateStore, "other");
    input.setDraft("Other draft");
    if (outcome === "success") fetch.resolve({ sendText: "https://example.com/ summarize" });
    else fetch.reject(new Error("offline"));
    await submitting;
    expect(input.draft).toBe("Other draft");
    expect(startTurn).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
  });

  it("recovers the exact web draft and attachments when work settles after the connection scope clears", async () => {
    const attachment = attachmentFixture("diagram");
    const prefix = "  /web https://example.com summarize  ";
    const { host, input, execute, startTurn, stateStore, prepareInput } = createHost(prefix, {
      input: { attachmentHandler: { saveFiles: async () => attachmentSaveResult([attachment]) } },
    });
    input.transferAttachments([new File(["image"], "diagram.png")]);
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));
    const original = `${prefix}\n![[Codex Attachments/diagram.png]]`;
    expect(input.draft).toBe(original);
    const fetch = deferred<{ sendText: string }>();
    execute.mockImplementation(() => fetch.promise);
    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "connection/scoped-cleared" });
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(input.draft).toBe("");
    input.setDraft("Next draft");
    fetch.resolve({ sendText: "late response" });
    await submitting;
    expect(input.draft).toBe(`${original}\n\nNext draft`);
    expect(input.captureInputSnapshot().attachments).toEqual([attachment]);
    expect(prepareInput(input.draft).input).toContainEqual({ type: "localImage", path: "Codex Attachments/diagram.png" });
    expect(input.isSubmissionPreparing()).toBe(false);
    expect(startTurn).not.toHaveBeenCalled();
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
  });

  it.each(["/model example-model", "/web https://example.com summarize"])("restores %s when connection setup fails", async (draft) => {
    const { host, input, ensureConnected, execute, stateStore } = createHost(draft);
    ensureConnected.mockResolvedValue(false);
    await submitComposer(host);
    expect(execute).not.toHaveBeenCalled();
    expect(input.draft).toBe(draft);
    expect(input.isSubmissionPreparing()).toBe(false);
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().pendingSubmission).toBeNull();
  });

  it("does not execute an old slash intent after leaving and returning during connection", async () => {
    const { host, input, ensureConnected, execute, stateStore } = createHost("");
    const connection = deferred<boolean>();
    ensureConnected.mockImplementation(() => connection.promise);
    resumeActiveThread(stateStore, "first");
    input.setDraft("/model example-model");
    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(ensureConnected).toHaveBeenCalledOnce());
    resumeActiveThread(stateStore, "other");
    resumeActiveThread(stateStore, "first");
    input.setDraft("Returned draft");
    connection.resolve(true);
    await submitting;
    expect(execute).not.toHaveBeenCalled();
    expect(input.draft).toBe("Returned draft");
  });

  it("publishes a slash command replacement before the draft typed during execution", async () => {
    const { host, input, execute, startTurn, showLatest } = createHost("/goal edit");
    const execution = deferred<{ composerDraft: string }>();
    execute.mockImplementation(() => execution.promise);
    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    input.setDraft("Next draft");
    execution.resolve({ composerDraft: "/goal set Current objective" });
    await submitting;
    expect(input.draft).toBe("/goal set Current objective\n\nNext draft");
    expect(input.isSubmissionPreparing()).toBe(false);
    expect(showLatest).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("restores slash text and reports current executor errors", async () => {
    const draft = "/web https://obsidian.md/help/plugins/web-viewer Can you read this?";
    const { host, input, execute, startTurn, showLatest } = createHost(draft);
    execute.mockRejectedValue(new Error("No readable content found for https://obsidian.md/help/plugins/web-viewer"));
    await submitComposer(host);
    expect(input.draft).toBe(draft);
    expect(input.isSubmissionPreparing()).toBe(false);
    expect(host.status.addSystemMessage).toHaveBeenCalledExactlyOnceWith(
      "No readable content found for https://obsidian.md/help/plugins/web-viewer",
    );
    expect(showLatest).toHaveBeenCalledOnce();
    expect(startTurn).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(host.stateStore.getState())).toEqual([]);
  });

  it.each([
    ["empty", "failed"],
    ["existing", "failed"],
    ["existing", "saved"],
  ] as const)("preserves the next draft and inline editor after a slash goal save from an %s panel (%s)", async (panel, outcome) => {
    const { host, input, stateStore, starter, execute } = createHost("");
    if (panel === "existing") resumeActiveThread(stateStore, "thread");
    const saving = deferred<{ kind: "completed"; value: undefined }>();
    const setThreadGoal = vi.fn(() => saving.promise);
    const goals = createGoalCommands({
      stateStore,
      startThread: starter.startThread,
      effects: { setThreadGoal, clearThreadGoal: vi.fn() },
      goalQueries: { snapshot: () => null },
      ensureConnected: host.connection.ensureConnected,
      ensureRestoredThreadLoaded: host.ensureRestoredThreadLoaded,
      addSystemMessage: host.status.addSystemMessage,
    });
    goals.startEditing(panel === "existing" ? "thread" : null, "Inline draft", null);
    input.setDraft("/goal set Ship this");
    execute.mockImplementation((_command, args, inputSnapshot, submission) =>
      executeContextSlashCommand("goal", args, {
        activeThreadId: panel === "existing" ? "thread" : null,
        listedThreads: [],
        inputSnapshot,
        submission,
        goals,
        referThread: vi.fn(),
        readWebUrl: vi.fn(),
        addSystemMessage: host.status.addSystemMessage,
        addStructuredSystemMessage: vi.fn(),
      }),
    );
    const pending = submitComposer(host);
    await vi.waitFor(() =>
      expect(setThreadGoal).toHaveBeenCalledWith("thread", { objective: "Ship this", status: "active", tokenBudget: null }),
    );
    input.setDraft("Next input");
    if (outcome === "saved") saving.resolve({ kind: "completed", value: undefined });
    else saving.reject(new Error("save failed"));
    await pending;
    expect(input.draft).toBe("Next input");
    expect(input.isSubmissionPreparing()).toBe(false);
    expect(stateStore.getState().ui.goalEditor).toMatchObject({ kind: "editing", objectiveDraft: "Inline draft" });
  });

  it.each(["rpc-error", "empty-history", "stale-target"] as const)(
    "preserves unsent reference input after %s without publishing into another thread",
    async (failure) => {
      const attachments: ComposerAttachment[] = [{ kind: "file", name: "attachment", path: "attachment.md", marker: "[[attachment.md]]" }];
      const prefix = "/refer Other Consider this background and these constraints in detail";
      const { host, input, stateStore, execute, startTurn } = createHost(prefix, {
        input: { attachmentHandler: { saveFiles: async () => attachmentSaveResult(attachments) } },
      });
      input.transferAttachments([new File(["data"], "attachment.md")]);
      await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));
      const original = `${prefix}\n[[attachment.md]]`;
      expect(input.draft).toBe(original);
      const response = deferred<{ data: []; nextCursor: null }>();
      const request = vi.fn(() => response.promise);
      const referThread = createThreadReferenceResolver({
        currentClient: () => ({ request }) as unknown as AppServerClient,
        resolveFileReference: host.resolveFileReference,
        setStatus: host.status.setStatus,
      });
      execute.mockImplementation((_command, args, inputSnapshot, submission) =>
        executeContextSlashCommand("refer", args, {
          activeThreadId: null,
          listedThreads: [panelThreadFixture({ id: "other", name: "Other" })],
          inputSnapshot,
          submission,
          referThread,
          readWebUrl: vi.fn(),
          goals: { activeGoal: vi.fn(), setObjective: vi.fn(), setStatus: vi.fn(), clear: vi.fn() },
          addSystemMessage: host.status.addSystemMessage,
          addStructuredSystemMessage: vi.fn(),
        }),
      );
      const pending = submitComposer(host);
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
      if (failure === "stale-target") resumeActiveThread(stateStore, "another");
      input.setDraft("next message");
      if (failure === "empty-history") response.resolve({ data: [], nextCursor: null });
      else response.reject(new Error("history unavailable"));
      await pending;
      expect(startTurn).not.toHaveBeenCalled();
      expect(input.draft).toBe(failure === "stale-target" ? "next message" : `${original}\n\nnext message`);
      expect(input.captureInputSnapshot().attachments).toEqual(failure === "stale-target" ? [] : attachments);
      expect(host.status.addSystemMessage.mock.calls).toEqual(
        failure === "stale-target"
          ? []
          : [[failure === "empty-history" ? "Referenced thread has no readable turns." : "history unavailable"]],
      );
    },
  );

  it("keeps an adopted target-changing slash command committed without restoring it over the next draft", async () => {
    const { host, input, stateStore, execute } = createHost("/resume next");
    execute.mockImplementation(async (_command, _args, _snapshot, submission) => {
      input.setDraft("next message");
      submission.adoptPanelTarget("next");
      resumeActiveThread(stateStore, "next");
      return undefined;
    });
    await submitComposer(host);
    expect(input.draft).toBe("next message");
    expect(input.isSubmissionPreparing()).toBe(false);
  });

  it.each(["persistent", "ordinary", "side-chat"] as const)(
    "keeps an interrupted %s turn busy until matching completion permits switching",
    async (mode) => {
      const { host, interruptTurn, showLatest, stateStore } = createHost("");
      stateStore.dispatch({
        ...threadActivationFixture(thread("thread")),
        type: "active-thread/resumed",
        lifetime:
          mode === "persistent"
            ? { kind: "persistent" }
            : mode === "ordinary"
              ? { kind: "ephemeral", mode }
              : { kind: "ephemeral", mode, sourceThreadId: "source", sourceThreadTitle: null },
      });
      stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });

      await submitComposer(host);

      expect(showLatest).not.toHaveBeenCalled();
      expect(interruptTurn).toHaveBeenCalledWith("thread", "turn");
      expect(host.status.setStatus).toHaveBeenCalledWith("Interrupt requested.");
      expect(chatTurnBusy(stateStore.getState().activeTurn)).toBe(true);
      expect(canSwitchToThread(stateStore.getState(), "next-thread")).toBe(false);

      const inbound = createChatInboundHandler(
        stateStore,
        {
          maybeNameThread: vi.fn(),
          respondToServerRequest: vi.fn(() => true),
          rejectServerRequest: vi.fn(() => true),
          executeDynamicTool: vi.fn(),
        },
        host.localItemIds,
      );
      const completion = (turnId: string) =>
        inbound.handleNotification({
          method: "turn/completed",
          params: {
            threadId: "thread",
            turn: appServerTurnFixture({
              id: turnId,
              status: "interrupted",
              startedAt: 1,
              completedAt: 2,
              durationMs: 1,
              itemsView: "summary",
              items: [],
            }),
          },
        });

      completion("previous-turn");
      expect(chatTurnBusy(stateStore.getState().activeTurn)).toBe(true);
      expect(canSwitchToThread(stateStore.getState(), "next-thread")).toBe(false);

      completion("turn");
      expect(chatTurnBusy(stateStore.getState().activeTurn)).toBe(false);
      expect(canSwitchToThread(stateStore.getState(), "next-thread")).toBe(true);
      expect(stateStore.getState().connection.statusText).toBe("Turn interrupted.");
    },
  );

  it("interrupts a running turn even when the thread rejects direct input", async () => {
    const { host, input, interruptTurn, startTurn, stateStore } = createHost("unsent draft");
    stateStore.dispatch({
      ...threadActivationFixture(thread("thread")),
      type: "active-thread/resumed",
      canAcceptDirectInput: false,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });

    input.setDraft("unsent draft");
    await submitComposer(host);

    expect(input.draft).toBe("unsent draft");
    expect(interruptTurn).toHaveBeenCalledWith("thread", "turn");
    expect(startTurn).not.toHaveBeenCalled();
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
  });
});

function webFetchHost(draft: string) {
  const fixture = createHost(draft);
  const fetch = deferred<{ sendText: string }>();
  fixture.execute.mockImplementation(() => fetch.promise);
  return { ...fixture, fetch };
}

function resumeActiveThread(stateStore: ReturnType<typeof createChatStateStore>, id: string): void {
  stateStore.dispatch({
    ...threadActivationFixture(thread(id)),
    type: "active-thread/resumed",
  });
}
