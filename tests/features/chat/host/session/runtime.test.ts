import { chatMetadataCacheFixture, chatVaultFixture, chatWorkspaceFixture } from "../../../../support/chat-obsidian";
import { disconnectedChatLeaseFixture, threadGoalQueriesFixture, threadReplacementPublicationFixture } from "../../support/host-contracts";
// @vitest-environment jsdom

import { Component } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { AppServerClient, AppServerServerRequestResponder } from "../../../../../src/app-server/connection/client";
import type { ConnectionManagerHandlers } from "../../../../../src/app-server/connection/connection-manager";
import { AppServerContextConnection } from "../../../../../src/app-server/connection/context-connection";
import type { ServerNotification } from "../../../../../src/app-server/connection/rpc-messages";
import type { ServerInitialization } from "../../../../../src/domain/runtime/metadata";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { Thread } from "../../../../../src/domain/threads/model";
import { prepareComposerInput } from "../../../../../src/features/chat/application/composer/prepared-input";
import { activeThreadId } from "../../../../../src/features/chat/application/state/model";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { selectChatPanelComposer } from "../../../../../src/features/chat/host/composer/view-projection";
import type { ChatPanelEnvironment, CodexChatHost } from "../../../../../src/features/chat/host/contracts";
import { createChatPanelSessionRuntime } from "../../../../../src/features/chat/host/session/runtime";
import { createChatThreadStreamScrollBinding } from "../../../../../src/features/chat/host/thread-stream/scroll-binding";
import type { ArchiveThreadResult } from "../../../../../src/features/threads/workflows/ports";
import { createThreadAutoTitleWork } from "../../../../../src/features/threads/workflows/thread-auto-title-work";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../../../../src/settings/preferences";
import { DeferredTask } from "../../../../../src/shared/async/deferred-task";
import { createKeyedOperationCoordinator } from "../../../../../src/shared/async/keyed-operation-coordinator";
import {
  appServerAgentMessageFixture,
  appServerCompletedTurnFixture,
  appServerUserMessageFixture,
} from "../../../../support/app-server-records";
import { deferred, waitForAsyncWork } from "../../../../support/async";
import { installObsidianDomShims } from "../../../../support/dom";
import { modelMetadataFixture } from "../../../../support/model-metadata";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { runtimeConfigFixture } from "../../../../support/runtime-config";
import { createServerDiagnostics } from "../../../../support/runtime-diagnostics";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { threadMutationCommandsMock } from "../../../../support/thread-mutations";
import { chatPanelSettingsAccess } from "../../support/settings";
import { chatComposerSharedValuesFixture } from "../../support/shared-display-values";

installObsidianDomShims();

const emptySharedResources = chatComposerSharedValuesFixture();

describe("chat panel session runtime", () => {
  let panelRoot: HTMLElement;

  beforeEach(() => {
    panelRoot = document.body.createDiv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("resolves chat wikilinks independently of the active note", async () => {
    const workspace = chatWorkspaceFixture();
    workspace.getActiveFile = vi.fn(() => ({ path: "topics/Source.md" })) as never;
    const app = { workspace, vault: chatVaultFixture(), metadataCache: chatMetadataCacheFixture() };
    const { runtime } = sessionRuntimeFixture({ environment: { obsidian: { app: app as never } } });
    const resolve = vi.fn(() => ({ name: "Target", path: "Target.md" }));
    const snapshot = runtime.composer.input.captureInputSnapshot();
    const prepared = prepareComposerInput("[[Target]]", snapshot, resolve);
    expect(resolve).toHaveBeenCalledWith("Target");
    expect(prepared.input).toContainEqual({ type: "fileReference", name: "Target", path: "Target.md" });
    await runtime.dispose(() => {});
  });

  it.each(["pin", "archive-result", "slash-archive", "slash-rename", "fork", "slash-fork"] as const)(
    "delivers delayed %s failures only to the initiating conversation",
    async (operation) => {
      const origin = threadFixture({ id: "source-with-history" });
      for (const destination of ["current", "another", "returned"] as const) {
        const pending = deferred<never>();
        const archiveResult = deferred<ArchiveThreadResult>();
        const mutation = vi.fn(() => pending.promise);
        const archiveMutation = vi.fn<ChatPanelEnvironment["plugin"]["threadMutations"]["archiveThread"]>(() =>
          operation === "archive-result" ? archiveResult.promise : pending.promise,
        );
        const client = { request: vi.fn().mockResolvedValue({}) } as unknown as AppServerClient;
        const contextConnection = contextConnectionHarness({ currentClient: () => client });
        const { runtime, stateStore } = sessionRuntimeFixture({
          environment: {
            plugin: {
              appServerConnection: contextConnection.connection,
              workspace: { openForkDraft: mutation },
              threadCatalog: { activeThreadsSnapshot: () => [origin] },
              threadMutations: threadMutationCommandsMock({
                setThreadPinned: mutation,
                archiveThread: archiveMutation,
                renameThread: mutation,
              }),
            },
          },
        });
        await runtime.connection.coordinator.ensureConnected();
        stateStore.dispatch({
          type: "active-thread/resumed",
          ...threadActivationFixture(origin),
          items: [{ id: "prompt", kind: "dialogue", dialogueKind: "user", role: "user", text: "Old prompt", turnId: "turn" }],
        });
        let submission: Promise<void> | undefined;
        if (operation === "pin") runtime.shell.parts.toolbar.actions.threads.setPinned(origin.id, true);
        else if (operation === "archive-result") runtime.shell.parts.toolbar.actions.threads.archive.confirm(origin.id, false);
        else if (operation === "fork") runtime.shell.parts.threadStream.context.actions.forkThreadFromTurn(origin.id, "turn", false);
        else {
          runtime.composer.input.setDraft(
            operation === "slash-archive" ? "/archive thread" : operation === "slash-fork" ? "/fork" : "/rename thread New name",
          );
          submission = runtime.turn.submissionCommands.composerSubmit.submit();
        }
        await waitForAsyncWork(() => expect(operation.includes("archive") ? archiveMutation : mutation).toHaveBeenCalledOnce());
        if (destination !== "current") {
          stateStore.dispatch({ type: "active-thread/resumed", ...threadActivationFixture(threadFixture({ id: "another" })) });
          if (destination === "returned") {
            stateStore.dispatch({ type: "active-thread/resumed", ...threadActivationFixture(origin) });
          }
        }
        runtime.composer.input.setDraft("Keep this draft");
        if (operation === "archive-result") archiveResult.resolve({ kind: "failed", message: "Storage unavailable", exportedPath: null });
        else pending.reject(new Error("Storage unavailable"));
        await submission;
        if (operation !== "archive-result") await pending.promise.catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const text = stateStore
          .getState()
          .threadStream.stableItems.flatMap((item) => ("text" in item ? [item.text] : []))
          .join("\n");
        expect(text.includes("Storage unavailable"), `${operation}: ${destination}`).toBe(destination === "current");
        expect(runtime.composer.input.draft).toBe("Keep this draft");
        expect(activeThreadId(stateStore.getState())).toBe(destination === "another" ? "another" : origin.id);
        expect(archiveMutation).toHaveBeenCalledTimes(operation.includes("archive") ? 1 : 0);
        expect(archiveMutation.mock.calls[0]?.[1]?.saveMarkdown).toBe(operation === "archive-result" ? false : undefined);
        await runtime.dispose(() => undefined);
      }
    },
  );

  it("invalidates thread activation and history through the runtime action", async () => {
    const connecting = deferred<ServerInitialization>();
    const request = vi.fn();
    const client = { request } as unknown as AppServerClient;
    const contextConnection = contextConnectionHarness({ initialization: connecting.promise, currentClient: () => client });
    const { runtime, stateStore } = sessionRuntimeFixture({
      environment: { plugin: { appServerConnection: contextConnection.connection } },
    });
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread-1", fallbackTitle: null });
    const restoring = runtime.thread.ensureRestoredThreadLoaded();
    await waitForAsyncWork(() => expect(contextConnection.connect).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "thread-stream/history-loading-set", loading: true });

    runtime.commands.invalidateThreadWork();
    connecting.resolve(serverInitializationFixture());

    await expect(restoring).resolves.toBe(false);
    expect(stateStore.getState().threadStream.loadingHistory).toBe(false);
    expect(request).not.toHaveBeenCalled();
    await runtime.dispose(() => undefined);
  });

  it.each(["active-thread", "connection", "runtime"] as const)(
    "cancels manual naming through %s invalidation and allows fresh work",
    async (scope) => {
      const context = { userRequest: "Request", assistantResponse: "Answer" };
      const oldTitle = deferred<string>();
      const generateTitle = vi
        .fn<ChatPanelEnvironment["plugin"]["threadTitlePort"]["generateTitle"]>()
        .mockReturnValueOnce(oldTitle.promise)
        .mockResolvedValueOnce("Fresh title");
      const { runtime, stateStore } = sessionRuntimeFixture({
        environment: {
          plugin: {
            threadTitlePort: { persistedContext: vi.fn().mockResolvedValue(context), generateTitle },
            threadCatalog: { activeThreadsSnapshot: () => [threadFixture()] },
          },
        },
      });
      const rename = runtime.shell.parts.toolbar.actions.threads.rename;
      rename.start("thread");
      await waitForAsyncWork(() => expect(stateStore.getState().ui.rename).toMatchObject({ autoName: { kind: "ready" } }));
      rename.updateDraft("thread", "Keep my draft");
      rename.autoName("thread");
      await waitForAsyncWork(() => expect(generateTitle).toHaveBeenCalledOnce());

      if (scope === "active-thread") runtime.thread.identity.clearActiveThreadIdentity();
      else if (scope === "connection") runtime.connection.coordinator.handleExit();
      else runtime.commands.invalidateThreadWork();

      expect(generateTitle.mock.calls[0]?.[1].aborted).toBe(true);
      // Clearing the active identity also resets its UI; cancellation itself does not.
      expect(stateStore.getState().ui.rename).toEqual(
        scope === "active-thread"
          ? { kind: "idle" }
          : { kind: "editing", threadId: "thread", draft: "Keep my draft", autoName: { kind: "ready", context } },
      );
      if (scope === "active-thread") rename.start("thread");
      await waitForAsyncWork(() => expect(stateStore.getState().ui.rename).toMatchObject({ autoName: { kind: "ready" } }));
      rename.autoName("thread");
      await waitForAsyncWork(() => expect(stateStore.getState().ui.rename).toMatchObject({ kind: "editing", draft: "Fresh title" }));
      oldTitle.reject(new Error("Cancelled generation"));
      await Promise.resolve();
      await Promise.resolve();
      expect(stateStore.getState().ui.rename).toMatchObject({ draft: "Fresh title" });
      expect(
        stateStore.getState().threadStream.stableItems.some((item) => "text" in item && item.text.includes("Cancelled generation")),
      ).toBe(false);
      await runtime.dispose(() => undefined);
    },
  );

  it("lets shared first-turn naming finish after the panel clears its active thread", async () => {
    const generatedTitle = deferred<string | null>();
    const generateTitle = vi.fn(() => generatedTitle.promise);
    const renameThread = vi.fn().mockResolvedValue(true);
    const sharedTitleWork = createThreadAutoTitleWork({
      titlePort: { persistedContext: vi.fn().mockResolvedValue(null), generateTitle },
      mutations: { renameThread },
    });
    const client = { request: vi.fn().mockResolvedValue({}) } as unknown as AppServerClient;
    const contextConnection = contextConnectionHarness({ currentClient: () => client });
    const { runtime, stateStore } = sessionRuntimeFixture({
      environment: { plugin: { appServerConnection: contextConnection.connection, threadAutoTitleWork: sharedTitleWork } },
    });
    await runtime.connection.coordinator.ensureConnected();
    stateStore.dispatch({ type: "active-thread/created", ...threadActivationFixture(threadFixture()) });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    contextConnection.notify({
      method: "turn/completed",
      params: {
        threadId: "thread",
        turn: appServerCompletedTurnFixture([
          appServerUserMessageFixture("user", "Capture this context."),
          appServerAgentMessageFixture("answer", "Continue after the panel moves on."),
        ]),
      },
    });
    await waitForAsyncWork(() => expect(generateTitle).toHaveBeenCalledOnce());

    runtime.thread.identity.clearActiveThreadIdentity();
    generatedTitle.resolve("Shared runtime title");

    await waitForAsyncWork(() =>
      expect(renameThread).toHaveBeenCalledWith("thread", "Shared runtime title", { shouldStart: expect.any(Function) }),
    );
    await runtime.dispose(() => undefined);
    sharedTitleWork.dispose();
  });

  it("resets objective expansion only when a goal presentation changes", () => {
    let publishGoalChange: ((threadId: string, previous: ThreadGoal | null, next: ThreadGoal | null) => void) | undefined;
    const observeChanges = vi.fn((listener: NonNullable<typeof publishGoalChange>) => {
      publishGoalChange = listener;
      return () => undefined;
    });
    const { stateStore } = sessionRuntimeFixture({
      environment: { plugin: { threadGoalQueries: { ...threadGoalQueriesFixture(), observeChanges } } },
    });
    stateStore.dispatch({
      ...threadActivationFixture(threadFixture({ id: "thread-1" })),
      type: "active-thread/resumed",
    });
    stateStore.dispatch({ type: "ui/disclosure-set", bucket: "goalObjectiveExpanded", id: "thread-1", open: true });
    const initial = goalFixture({ objective: "Initial" });
    expect(observeChanges).toHaveBeenCalledOnce();
    expect(publishGoalChange).toBeTypeOf("function");

    publishGoalChange?.("thread-other", null, { ...initial, threadId: "thread-other", objective: "Other" });
    expect(stateStore.getState().ui.disclosures.goalObjectiveExpanded.has("thread-1")).toBe(true);
    expect(stateStore.getState().threadStream.stableItems).toEqual([]);

    publishGoalChange?.("thread-1", initial, { ...initial, tokensUsed: 1 });
    expect(stateStore.getState().ui.disclosures.goalObjectiveExpanded.has("thread-1")).toBe(true);

    publishGoalChange?.("thread-1", initial, { ...initial, objective: "Replacement" });
    expect(stateStore.getState().ui.disclosures.goalObjectiveExpanded.has("thread-1")).toBe(false);
  });

  it("does not connect for a submission after the panel starts closing", async () => {
    const request = vi.fn();
    const client = { request } as unknown as AppServerClient;
    const contextConnection = contextConnectionHarness({ currentClient: () => client });
    const { runtime } = sessionRuntimeFixture({
      getClosing: () => true,
      environment: { plugin: { appServerConnection: contextConnection.connection } },
    });
    runtime.composer.input.setDraft("hello");

    await runtime.turn.submissionCommands.composerSubmit.submit();

    expect(contextConnection.connect).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(runtime.composer.input.draft).toBe("hello");
    expect(runtime.composer.input.isSubmissionPreparing()).toBe(false);
  });

  it("does not submit when the panel starts closing during connection", async () => {
    let closing = false;
    let currentClient: AppServerClient | null = null;
    const connecting = deferred<ServerInitialization>();
    const request = vi.fn();
    const client = { request } as unknown as AppServerClient;
    const contextConnection = contextConnectionHarness({
      initialization: connecting.promise,
      currentClient: () => currentClient,
    });
    const { runtime } = sessionRuntimeFixture({
      getClosing: () => closing,
      environment: { plugin: { appServerConnection: contextConnection.connection } },
    });
    runtime.composer.input.setDraft("hello");

    const submission = runtime.turn.submissionCommands.composerSubmit.submit();
    await vi.waitFor(() => expect(contextConnection.connect).toHaveBeenCalledOnce());
    closing = true;
    currentClient = client;
    connecting.resolve(serverInitializationFixture());
    await submission;

    expect(request).not.toHaveBeenCalled();
    expect(runtime.composer.input.draft).toBe("hello");
    expect(runtime.composer.input.isSubmissionPreparing()).toBe(false);
  });

  it("retains a submission when initialization settles without a current client", async () => {
    const contextConnection = contextConnectionHarness({ currentClient: () => null });
    const { runtime, stateStore } = sessionRuntimeFixture({
      environment: { plugin: { appServerConnection: contextConnection.connection } },
    });
    runtime.composer.input.setDraft("hello");

    await runtime.turn.submissionCommands.composerSubmit.submit();

    expect(contextConnection.connect).toHaveBeenCalledOnce();
    expect(stateStore.getState().panelThread).toEqual({ kind: "empty" });
    expect(runtime.composer.input.draft).toBe("hello");
    expect(runtime.composer.input.isSubmissionPreparing()).toBe(false);
  });

  it("wires reconnect cleanup through the runtime toolbar action", async () => {
    const { runtime, stateStore } = sessionRuntimeFixture();
    stateStore.dispatch({
      ...threadActivationFixture(threadFixture({ id: "thread-1", preview: "Active" })),
      type: "active-thread/resumed",
    });
    vi.spyOn(runtime.connection.coordinator, "ensureConnected").mockResolvedValue(undefined);
    vi.spyOn(runtime.connection.manager, "isConnected").mockReturnValue(true);
    const resumeThread = vi.spyOn(runtime.thread.activation, "resumeThread").mockResolvedValue({
      hydrate: vi.fn().mockResolvedValue(true),
    });

    runtime.shell.parts.toolbar.actions.status.connect();

    await waitForAsyncWork(() => {
      expect(resumeThread).toHaveBeenCalledWith("thread-1");
    });
    expect(stateStore.getState().connection.statusText).toBe("Reconnecting...");
  });

  it("keeps a Side Chat /reconnect submission adopted across the runtime target reset", async () => {
    const { runtime, stateStore } = sessionRuntimeFixture();
    stateStore.dispatch({
      ...threadActivationFixture(threadFixture({ id: "side-thread", preview: "Side chat" })),
      type: "active-thread/resumed",
      lifetime: { kind: "ephemeral", mode: "side-chat", sourceThreadId: "source-thread", sourceThreadTitle: "Source" },
    });
    const reconnecting = deferred<void>();
    const ensureConnected = vi.spyOn(runtime.connection.coordinator, "ensureConnected").mockReturnValue(reconnecting.promise);
    runtime.composer.input.setDraft("/reconnect");

    const reconnectSubmission = runtime.turn.submissionCommands.composerSubmit.submit();
    await waitForAsyncWork(() => {
      expect(ensureConnected).toHaveBeenCalledOnce();
    });

    expect(stateStore.getState().panelThread).toEqual({ kind: "empty" });
    expect(runtime.composer.input.isSubmissionPreparing()).toBe(true);

    runtime.composer.input.setDraft("next message");
    await runtime.turn.submissionCommands.composerSubmit.submit();

    expect(runtime.composer.input.draft).toBe("next message");
    expect(ensureConnected).toHaveBeenCalledOnce();

    reconnecting.resolve(undefined);
    await reconnectSubmission;

    expect(runtime.composer.input.isSubmissionPreparing()).toBe(false);
    expect(runtime.composer.input.draft).toBe("next message");
  });

  it("disposes scheduled, subscribed, composer, scroll, and connection resources", async () => {
    vi.useFakeTimers();
    const unsubscribeThreads = vi.fn();
    const unsubscribeMetadata = vi.fn();
    const { runtime, stateStore, appServerWarmup, threadStreamScrollBinding } = sessionRuntimeFixture({
      environment: {
        plugin: {
          threadCatalog: { observeActiveThreadsResult: vi.fn(() => unsubscribeThreads) },
          appServerQueries: {
            observeMetadataResource: vi.fn(() => unsubscribeMetadata),
          },
        },
      },
    });
    stateStore.dispatch({ type: "thread-stream/history-loading-set", loading: true });
    runtime.observers.threadCatalog.subscribe();
    const warmup = vi.fn();
    appServerWarmup.schedule(warmup);
    const dispatchScrollCommand = vi.fn();
    threadStreamScrollBinding.mountScrollPort({ dispatchScrollCommand });
    const composer = document.body.createEl("textarea");
    runtime.composer.controller
      .renderState(selectChatPanelComposer(stateStore.getState(), emptySharedResources), { submit: vi.fn() })
      .onComposer(composer);
    composer.focus();
    expect(runtime.composer.controller.hasFocus()).toBe(true);
    const disconnect = vi.spyOn(runtime.connection.manager, "disconnect");
    const unmount = vi.fn();

    const disposal = runtime.dispose(unmount);

    expect(stateStore.getState().threadStream.loadingHistory).toBe(false);
    expect(unmount).toHaveBeenCalledOnce();

    await disposal;

    expect(disconnect).toHaveBeenCalledOnce();
    expect(unsubscribeThreads).toHaveBeenCalled();
    expect(unsubscribeMetadata).toHaveBeenCalled();
    expect(runtime.composer.controller.hasFocus()).toBe(false);
    threadStreamScrollBinding.showLatest();
    expect(dispatchScrollCommand).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(warmup).not.toHaveBeenCalled();
  });

  it("preserves composer runtime choices as intents for the next conversation", async () => {
    const config = runtimeConfigFixture({ model: "gpt-known", reasoningEffort: "low", approvalsReviewer: "user", serviceTier: null });
    const models = [
      modelMetadataFixture("gpt-known", {
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "" },
          { reasoningEffort: "high", description: "" },
        ],
        defaultReasoningEffort: "low",
        serviceTiers: [{ id: "priority", name: "Fast" }],
      }),
    ];
    const client = { request: vi.fn().mockResolvedValue({}) } as unknown as AppServerClient;
    const context = contextConnectionHarness({ currentClient: () => client });
    const { runtime, stateStore } = sessionRuntimeFixture({
      environment: {
        plugin: {
          appServerConnection: context.connection,
          appServerQueries: { metadataSnapshot: (id) => (id === "runtimeConfig" ? config : id === "models" ? models : null) as never },
        },
      },
    });
    await runtime.connection.coordinator.ensureConnected();
    const presentation = runtime.composer.controller.renderState(
      selectChatPanelComposer(stateStore.getState(), chatComposerSharedValuesFixture({ runtimeConfig: config, models })),
      { submit: vi.fn() },
    );
    const high = presentation.meta.effortChoices.find((choice) => choice.label === "high");
    if (!high) throw new Error("Expected high reasoning effort to be offered");
    high.onClick();
    presentation.callbacks.onTogglePlan();
    presentation.callbacks.onToggleAutoReview();
    presentation.callbacks.onToggleFast();
    await waitForAsyncWork(() => {
      expect(stateStore.getState().runtime.pending).toMatchObject({
        reasoningEffort: { kind: "set", value: "high" },
        collaborationMode: { kind: "set", value: "plan" },
        approvalsReviewer: { kind: "set", value: "auto_review" },
        fastMode: { kind: "set", value: "enabled" },
      });
    });
    await runtime.dispose(() => undefined);
  });

  it.each(["success", "failure"] as const)(
    "retires old model choices before accepting settings in a reopened session (%s)",
    async (outcome) => {
      const update = deferred<unknown>();
      const queue = createKeyedOperationCoordinator<string>({ whenBusy: "queue" });
      const request = vi.fn((method: string, _params?: unknown) =>
        method === "thread/settings/update" ? update.promise : Promise.resolve({}),
      );
      const settingsCalls = () => request.mock.calls.filter(([method]) => method === "thread/settings/update");
      const client = { request } as unknown as AppServerClient;
      const context = contextConnectionHarness({ currentClient: () => client });
      const environment = { plugin: { appServerConnection: context.connection, runtimeSettingsCommitQueue: queue } };
      const first = sessionRuntimeFixture({ environment });
      await first.runtime.connection.coordinator.ensureConnected();
      first.stateStore.dispatch({ ...threadActivationFixture(threadFixture()), type: "active-thread/resumed" });
      const selectModel = (panel: typeof first, model: string) => {
        const availableModels = ["old", "queued", "new"].map((id) => modelMetadataFixture(id));
        const presentation = panel.runtime.composer.controller.renderState(
          selectChatPanelComposer(panel.stateStore.getState(), chatComposerSharedValuesFixture({ models: availableModels })),
          { submit: vi.fn() },
        );
        const choice = presentation.meta.modelChoices.find((choice) => choice.label === model);
        if (!choice) throw new Error(`Missing model choice: ${model}`);
        choice.onClick();
      };
      selectModel(first, "old");
      await vi.waitFor(() => expect(settingsCalls()).toHaveLength(1));
      selectModel(first, "queued");
      await first.runtime.dispose(vi.fn());
      const reopened = sessionRuntimeFixture({ environment });
      await reopened.runtime.connection.coordinator.ensureConnected();
      reopened.stateStore.dispatch({ ...threadActivationFixture(threadFixture()), type: "active-thread/resumed" });
      request.mockResolvedValue({});
      selectModel(reopened, "new");
      await vi.waitFor(() => expect(settingsCalls()).toHaveLength(2));
      if (outcome === "success") update.resolve({});
      else update.reject(new Error("old failure"));
      await update.promise.catch(() => undefined);
      expect(settingsCalls()).toEqual([
        ["thread/settings/update", { threadId: "thread", model: "old" }],
        ["thread/settings/update", { threadId: "thread", model: "new" }],
      ]);
      expect(first.stateStore.getState().runtime.active.model).toBeNull();
      await reopened.runtime.dispose(vi.fn());
    },
  );

  it("invalidates an inline rename before releasing the panel runtime", async () => {
    const renamed = deferred<boolean>();
    const renameThread = vi.fn<ReturnType<typeof threadMutationCommandsMock>["renameThread"]>(() => renamed.promise);
    const { runtime, stateStore } = sessionRuntimeFixture({
      environment: {
        plugin: {
          threadCatalog: { activeThreadsSnapshot: vi.fn(() => [threadFixture({ id: "thread", name: "Current" })]) },
          threadMutations: threadMutationCommandsMock({ renameThread }),
        },
      },
    });

    runtime.shell.parts.toolbar.actions.threads.rename.start("thread");
    runtime.shell.parts.toolbar.actions.threads.rename.save("thread", "Queued title");
    await vi.waitFor(() => expect(renameThread).toHaveBeenCalledOnce());
    const shouldStart = renameThread.mock.calls[0]?.[2]?.shouldStart;
    if (!shouldStart) throw new Error("Expected inline rename validity to be forwarded");
    expect(shouldStart()).toBe(true);

    await runtime.dispose(vi.fn());

    expect(shouldStart()).toBe(false);
    expect(stateStore.getState().ui.rename.kind).toBe("idle");
    renamed.resolve(false);
    await Promise.resolve();
  });

  it("releases an ephemeral root subscription without interrupting work or stopping another panel", async () => {
    const request = vi.fn((method: string) => {
      if (method === "config/read") return Promise.resolve({ config: {} });
      if (method === "thread/fork") return Promise.resolve({ thread: threadFixture({ id: "side-thread" }) });
      return Promise.resolve({});
    });
    const client = { request } as unknown as AppServerClient;
    const managerState: { handlers: ConnectionManagerHandlers | null } = { handlers: null };
    const disconnectSharedProcess = vi.fn();
    const contextConnection = new AppServerContextConnection(
      "codex",
      "/vault",
      {} as never,
      { onNotification: () => false, onSubscriptionError: vi.fn(), onExit: vi.fn() },
      {
        connect: vi.fn(async (handlers: ConnectionManagerHandlers) => {
          managerState.handlers ??= handlers;
          return serverInitializationFixture();
        }),
        currentClient: () => client,
        disconnect: disconnectSharedProcess,
      },
    );
    const { runtime, stateStore } = sessionRuntimeFixture({
      environment: { plugin: { appServerConnection: contextConnection } },
    });
    await runtime.connection.coordinator.ensureConnected();
    const otherPanelRequest = vi.fn(() => true);
    const otherLease = contextConnection.createLease();
    await otherLease.connect({
      onNotification: vi.fn(),
      onServerRequest: otherPanelRequest,
      onLog: vi.fn(),
      onExit: vi.fn(),
    });
    const created = await client.request("thread/fork", { threadId: "source-thread" });
    runtime.connection.manager.recordThreadSubscription(created.thread.id, client);
    stateStore.dispatch({
      ...threadActivationFixture(threadFixture({ id: "side-thread", preview: "Side chat" })),
      type: "active-thread/resumed",
      lifetime: { kind: "ephemeral", mode: "side-chat", sourceThreadId: "source-thread", sourceThreadTitle: "Source" },
    });
    stateStore.dispatch({ type: "turn/started", threadId: "side-thread", turnId: "turn-1" });
    const releasePanelLease = vi.spyOn(runtime.connection.manager, "disconnect");

    const disposal = runtime.dispose(vi.fn());
    await disposal;
    expect(request.mock.calls.some(([method]) => method === "turn/interrupt")).toBe(false);
    expect(releasePanelLease).toHaveBeenCalledOnce();

    const responder = { respond: vi.fn(), reject: vi.fn() } as unknown as AppServerServerRequestResponder;
    const handlers = managerState.handlers;
    if (!handlers) throw new Error("Expected shared connection handlers.");
    handlers.onServerRequest(
      {
        id: 7,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "side-thread",
          turnId: "turn-1",
          itemId: "input-1",
          questions: [],
          isBlocking: true,
          autoResolutionMs: null,
        },
      },
      responder,
    );
    expect(otherPanelRequest).toHaveBeenCalledOnce();
    expect(responder.reject).not.toHaveBeenCalled();

    await waitForAsyncWork(() =>
      expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "side-thread" }, expect.anything()),
    );
    expect(otherLease.currentClient()).toBe(client);
    expect(disconnectSharedProcess).not.toHaveBeenCalled();
  });

  it("releases the presentation lease even when UI teardown throws", async () => {
    const { runtime } = sessionRuntimeFixture();
    const releasePanelLease = vi.spyOn(runtime.connection.manager, "disconnect");
    const teardownError = new Error("unmount failed");

    await expect(
      runtime.dispose(() => {
        throw teardownError;
      }),
    ).rejects.toBe(teardownError);

    expect(releasePanelLease).toHaveBeenCalledOnce();
  });

  function sessionRuntimeFixture(options: { environment?: PartialChatPanelEnvironment; getClosing?: () => boolean } = {}): {
    runtime: ReturnType<typeof createChatPanelSessionRuntime>;
    stateStore: ChatStateStore;
    appServerWarmup: DeferredTask;
    threadStreamScrollBinding: ReturnType<typeof createChatThreadStreamScrollBinding>;
  } {
    const stateStore = createChatStateStore();
    const appServerWarmup = new DeferredTask(() => window, 0);
    const threadStreamScrollBinding = createChatThreadStreamScrollBinding();
    const environment = chatPanelEnvironmentFixture(options.environment);
    const runtime = createChatPanelSessionRuntime({
      environment,
      stateStore,
      appServerWarmup,
      threadStreamScrollBinding,
      getClosing: options.getClosing ?? (() => false),
      applyForkDraft: vi.fn().mockResolvedValue(undefined),
      cancelForkDraft: vi.fn(),
    });
    return { runtime, stateStore, appServerWarmup, threadStreamScrollBinding };
  }

  interface PartialChatPanelEnvironment {
    obsidian?: Partial<ChatPanelEnvironment["obsidian"]>;
    plugin?: {
      appServerConnection?: ChatPanelEnvironment["plugin"]["appServerConnection"];
      workspace?: Partial<ChatPanelEnvironment["plugin"]["workspace"]>;
      threadCatalog?: Partial<ChatPanelEnvironment["plugin"]["threadCatalog"]>;
      threadFacts?: Partial<ChatPanelEnvironment["plugin"]["threadFacts"]>;
      appServerQueries?: Partial<ChatPanelEnvironment["plugin"]["appServerQueries"]>;
      toolInventoryQueries?: ChatPanelEnvironment["plugin"]["toolInventoryQueries"];
      threadGoalQueries?: ChatPanelEnvironment["plugin"]["threadGoalQueries"];
      threadMutations?: ChatPanelEnvironment["plugin"]["threadMutations"];
      threadTitlePort?: ChatPanelEnvironment["plugin"]["threadTitlePort"];
      threadAutoTitleWork?: ChatPanelEnvironment["plugin"]["threadAutoTitleWork"];
      settings?: ChatPanelEnvironment["plugin"]["settings"];
      appServerContext?: ChatPanelEnvironment["plugin"]["appServerContext"];
      runtimeSettingsCommitQueue?: ChatPanelEnvironment["plugin"]["runtimeSettingsCommitQueue"];
    };
    view?: Partial<ChatPanelEnvironment["view"]>;
  }

  function chatPanelEnvironmentFixture(overrides: PartialChatPanelEnvironment = {}): ChatPanelEnvironment {
    const threadCatalog = threadCatalogFixture(overrides.plugin?.threadCatalog);
    const appServerQueries = appServerQueriesFixture(overrides.plugin?.appServerQueries);
    const settingsSource: CodexPanelSettings = {
      ...DEFAULT_SETTINGS,
      codexPath: "codex",
      sendShortcut: "enter",
    };
    const owner = new Component();
    owner.load();
    onTestFinished(() => {
      owner.unload();
    });
    return {
      obsidian: {
        app: {
          workspace: chatWorkspaceFixture(),
          vault: chatVaultFixture(),
          metadataCache: chatMetadataCacheFixture(),
        } as never,
        owner,
        viewId: "codex-test-view",
        registerEvent: vi.fn(),
        registerPointerDown: vi.fn(),
        requestWorkspaceLayoutSave: vi.fn(),
        isForeground: vi.fn(() => true),
        ...overrides.obsidian,
      },
      plugin: {
        appServerConnection: overrides.plugin?.appServerConnection ?? contextConnectionFixture(),
        appServerContext: overrides.plugin?.appServerContext ?? { codexPath: "codex", vaultPath: "/vault" },
        threadTitlePort: overrides.plugin?.threadTitlePort ?? {
          persistedContext: vi.fn().mockResolvedValue(null),
          generateTitle: vi.fn().mockResolvedValue(null),
        },
        threadAutoTitleWork: overrides.plugin?.threadAutoTitleWork ?? { submit: vi.fn() },
        settings: overrides.plugin?.settings ?? chatPanelSettingsAccess(settingsSource),
        workspace: {
          returnFromForkDraft: vi.fn().mockResolvedValue(true),
          openForkDraft: vi.fn(),
          openThreadInNewView: vi.fn().mockResolvedValue(undefined),
          openThreadInAvailableView: overrides.plugin?.workspace?.openThreadInAvailableView ?? vi.fn().mockResolvedValue(undefined),
          openTurnDiff: vi.fn().mockResolvedValue(undefined),
          notifyPanelActivityChanged: vi.fn(),
          ...overrides.plugin?.workspace,
          openThreadFromPanel: overrides.plugin?.workspace?.openThreadFromPanel ?? vi.fn().mockResolvedValue(undefined),
        },
        appServerQueries,
        toolInventoryQueries: overrides.plugin?.toolInventoryQueries ?? toolInventoryQueriesFixture(),
        threadGoalQueries: overrides.plugin?.threadGoalQueries ?? threadGoalQueriesFixture(),
        threadCatalog,
        threadFacts: {
          apply: overrides.plugin?.threadFacts?.apply ?? vi.fn(),
          applyBatch: overrides.plugin?.threadFacts?.applyBatch ?? vi.fn(),
        },
        threadReplacementPublication: threadReplacementPublicationFixture(),
        threadMutations: overrides.plugin?.threadMutations ?? threadMutationCommandsMock(),
        runtimeSettingsCommitQueue: overrides.plugin?.runtimeSettingsCommitQueue ?? createKeyedOperationCoordinator({ whenBusy: "queue" }),
      },
      view: {
        panelRoot: () => panelRoot,
        viewWindow: () => window,
        refreshTabHeader: vi.fn(),
        ...overrides.view,
      },
    };
  }

  function contextConnectionFixture(): CodexChatHost["appServerConnection"] {
    return {
      createLease: disconnectedChatLeaseFixture,
      withClient: vi.fn().mockRejectedValue(new Error("No app-server client connected.")),
    };
  }

  function contextConnectionHarness(options: {
    currentClient: () => AppServerClient | null;
    initialization?: Promise<ServerInitialization>;
  }) {
    let handlers: ConnectionManagerHandlers | null = null;
    const connect = vi.fn((next: ConnectionManagerHandlers) => {
      handlers = next;
      return options.initialization ?? Promise.resolve(serverInitializationFixture());
    });
    const connection = new AppServerContextConnection(
      "codex",
      "/vault",
      {} as never,
      { onNotification: () => false, onSubscriptionError: vi.fn(), onExit: vi.fn() },
      {
        connect,
        currentClient: options.currentClient,
        disconnect: vi.fn(),
      },
    );
    return {
      connection,
      connect,
      notify(notification: ServerNotification) {
        if (!handlers) throw new Error("Expected connected app-server handlers.");
        handlers.onNotification(notification);
      },
    };
  }

  function serverInitializationFixture(): ServerInitialization {
    return {
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "macos",
      userAgent: "codex-test",
    };
  }

  function threadCatalogFixture(
    overrides: Partial<ChatPanelEnvironment["plugin"]["threadCatalog"]> = {},
  ): ChatPanelEnvironment["plugin"]["threadCatalog"] {
    return {
      hasMoreActiveThreads: vi.fn(() => false),
      loadMoreActiveThreads: vi.fn().mockResolvedValue(undefined),
      fetchActiveThreads: vi.fn().mockResolvedValue([]),
      refreshActiveThreads: vi.fn().mockResolvedValue(undefined),
      activeThreadsSnapshot: vi.fn(() => null),
      recentActiveThreadsSnapshot: vi.fn(() => null),
      observeActiveThreadsResult: vi.fn(() => () => undefined),
      ...overrides,
    };
  }

  function appServerQueriesFixture(
    overrides: Partial<ChatPanelEnvironment["plugin"]["appServerQueries"]> = {},
  ): ChatPanelEnvironment["plugin"]["appServerQueries"] {
    return {
      metadataSnapshot: vi.fn(() => null),
      metadataDiagnosticsSnapshot: vi.fn(() => createServerDiagnostics()),
      ensureAppServerMetadata: vi.fn().mockResolvedValue(undefined),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(undefined),
      observeMetadataResource: vi.fn(() => () => undefined),
      ...overrides,
    };
  }

  function toolInventoryQueriesFixture(): ChatPanelEnvironment["plugin"]["toolInventoryQueries"] {
    return {
      snapshot: vi.fn(() => null),
      observe: vi.fn((_threadId, listener) => {
        listener(null);
        return () => undefined;
      }),
      ensure: vi.fn().mockResolvedValue(null),
      refresh: vi.fn().mockResolvedValue(null),
    };
  }

  function threadFixture(overrides: Partial<Thread> = {}): Thread {
    return panelThreadFixture({
      id: "thread",
      ...overrides,
    });
  }

  function goalFixture(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
    return {
      threadId: "thread-1",
      objective: "Goal",
      status: "active",
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      ...overrides,
    };
  }
});
