import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { ThreadTitleContext } from "../../../../../src/domain/threads/title-generation-model";
import { messageStreamItems } from "../../../../../src/features/chat/application/state/message-stream";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  type AutoTitleCoordinator,
  type AutoTitleCoordinatorHost,
  createAutoTitleCoordinator,
} from "../../../../../src/features/chat/application/threads/auto-title-coordinator";
import { threadTitleContextFromMessageStreamItems } from "../../../../../src/features/chat/application/threads/title-context";
import { createThreadOperations } from "../../../../../src/features/threads/workflows/thread-operations";
import { createThreadTitleService } from "../../../../../src/features/threads/workflows/thread-title-service";
import { DEFAULT_SETTINGS } from "../../../../../src/settings/model";
import { deferred } from "../../../../support/async";

describe("AutoTitleCoordinator", () => {
  it("prefers visible turn items over completed turn summaries for active streamed turns", async () => {
    const renameThreadRequest = vi.fn().mockResolvedValue({});
    const generateThreadTitle = vi.fn().mockResolvedValue("Visible context title");
    const { coordinator, stateStore } = coordinatorFixture({
      currentClient: () => fakeClient({ renameThreadRequest }),
      generateThreadTitle,
    });
    stateStore.dispatch({
      type: "message-stream/items-replaced",
      items: [
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "Visible streamed request.", turnId: "turn" },
        {
          id: "a1",
          kind: "message",
          messageKind: "assistantResponse",
          role: "assistant",
          text: "Visible streamed response.",
          messageState: "completed",
          turnId: "turn",
        },
      ],
    });

    coordinator.maybeAutoTitleThread("thread", "turn", {
      userText: "Completed payload request.",
      assistantText: "Completed payload response.",
    });
    await flushPromises();

    expect(generateThreadTitle).toHaveBeenCalledWith({
      userRequest: "Visible streamed request.",
      assistantResponse: "Visible streamed response.",
    });
    expect(renameThreadRequest).toHaveBeenCalledWith({ threadId: "thread", name: "Visible context title" });
  });

  it("uses visible turn items when completed turn summaries are unavailable", async () => {
    const renameThreadRequest = vi.fn().mockResolvedValue({});
    const generateThreadTitle = vi.fn().mockResolvedValue("Visible context title");
    const { coordinator, stateStore } = coordinatorFixture({
      currentClient: () => fakeClient({ renameThreadRequest }),
      generateThreadTitle,
    });
    stateStore.dispatch({
      type: "message-stream/items-replaced",
      items: [
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "Please diagnose auto naming.", turnId: "turn" },
        {
          id: "a1",
          kind: "message",
          messageKind: "assistantResponse",
          role: "assistant",
          text: "I found the regression.",
          messageState: "completed",
          turnId: "turn",
        },
      ],
    });

    coordinator.maybeAutoTitleThread("thread", "turn", null);
    await flushPromises();

    expect(generateThreadTitle).toHaveBeenCalledWith({
      userRequest: "Please diagnose auto naming.",
      assistantResponse: "I found the regression.",
    });
    expect(renameThreadRequest).toHaveBeenCalledWith({ threadId: "thread", name: "Visible context title" });
  });

  it("does not apply a completed auto-title after the thread leaves the list", async () => {
    const generatedTitle = deferred<string | null>();
    const renameThreadRequest = vi.fn().mockResolvedValue({});
    const { coordinator, stateStore, notifyThreadRenamed } = coordinatorFixture({
      currentClient: () => fakeClient({ renameThreadRequest }),
      generateThreadTitle: vi.fn(() => generatedTitle.promise),
    });

    coordinator.maybeAutoTitleThread("thread", "turn", { userText: "Please name this.", assistantText: "Done." });
    await flushPromises();

    stateStore.dispatch({ type: "thread-list/applied", threads: [] });
    generatedTitle.resolve("Generated title");
    await flushPromises();

    expect(renameThreadRequest).not.toHaveBeenCalled();
    expect(notifyThreadRenamed).not.toHaveBeenCalled();
  });

  it("does not overwrite a manual name when auto-title save finishes later", async () => {
    const savedName = deferred<object>();
    const renameThreadRequest = vi.fn(() => savedName.promise);
    const { coordinator, stateStore, notifyThreadRenamed } = coordinatorFixture({
      currentClient: () => fakeClient({ renameThreadRequest }),
      generateThreadTitle: vi.fn().mockResolvedValue("Generated title"),
    });

    coordinator.maybeAutoTitleThread("thread", "turn", { userText: "Please name this.", assistantText: "Done." });
    await flushPromises();
    expect(renameThreadRequest).toHaveBeenCalledWith({ threadId: "thread", name: "Generated title" });

    stateStore.dispatch({ type: "thread-list/applied", threads: [{ ...threadFixture("thread"), name: "Manual title" }] });
    savedName.resolve({});
    await flushPromises();

    expect(stateStore.getState().threadList.listedThreads[0]?.name).toBe("Manual title");
    expect(notifyThreadRenamed).not.toHaveBeenCalled();
  });
});

function coordinatorFixture(
  overrides: { currentClient?: () => AppServerClient; generateThreadTitle?: (context: ThreadTitleContext) => Promise<string | null> } = {},
): AutoTitleCoordinatorHost & {
  coordinator: AutoTitleCoordinator;
  notifyThreadRenamed: ReturnType<typeof vi.fn>;
} {
  const stateStore = createChatStateStore();
  stateStore.dispatch({ type: "thread-list/applied", threads: [threadFixture("thread")] });
  const currentClient = overrides.currentClient ?? (() => fakeClient());
  const notifyThreadRenamed = vi.fn();
  const threadOperations = createThreadOperations({
    clientAccess: {
      withClient: async (operation) => operation(currentClient()),
    },
    archiveExport: {
      settings: () => DEFAULT_SETTINGS,
      enabled: () => false,
      vaultPath: "/vault",
      vaultConfigDir: ".obsidian",
    },
    archiveDestination: () => ({
      normalizePath: (path) => path,
      exists: vi.fn().mockResolvedValue(false),
      createFolder: vi.fn().mockResolvedValue(undefined),
      createMarkdownFile: vi.fn().mockResolvedValue(undefined),
    }),
    catalog: {
      apply: (event) => {
        if (event.type === "thread-renamed") notifyThreadRenamed(event.threadId, event.name);
      },
    },
    notice: vi.fn(),
  });
  const titleService = createThreadTitleService({
    codexPath: () => "codex",
    vaultPath: "/vault",
    threadNamingModel: () => DEFAULT_SETTINGS.threadNamingModel,
    threadNamingEffort: () => DEFAULT_SETTINGS.threadNamingEffort,
    clientAccess: {
      withClient: async (operation) => operation(currentClient()),
    },
    visibleCompletedTurnContext: (turnId) =>
      threadTitleContextFromMessageStreamItems(turnId, messageStreamItems(stateStore.getState().messageStream)),
    generateThreadTitle: overrides.generateThreadTitle ?? vi.fn().mockResolvedValue("Generated title"),
  });
  const host = {
    stateStore,
    completedTurnTitleContext: (turnId: string, completedSummary) => titleService.completedTurnContext(turnId, completedSummary),
    generateTitleFromContext: (context) => titleService.generate(context),
    renameGeneratedTitle: (threadId: string, value: string, options: { shouldPublish: () => boolean }) =>
      threadOperations.renameThread(threadId, value, options),
  } satisfies AutoTitleCoordinatorHost;
  return { ...host, notifyThreadRenamed, coordinator: createAutoTitleCoordinator(host) };
}

function fakeClient(options: { renameThreadRequest?: ReturnType<typeof vi.fn> } = {}): AppServerClient {
  const renameThreadRequest = options.renameThreadRequest ?? vi.fn().mockResolvedValue({});
  return {
    request: vi.fn((method: string, params: { threadId: string; name: string }) => {
      if (method !== "thread/name/set") throw new Error(`Unexpected app-server request: ${method}`);
      return (renameThreadRequest as unknown as (params: { threadId: string; name: string }) => Promise<unknown>)(params);
    }),
  } as unknown as AppServerClient;
}

function threadFixture(id: string): Thread {
  return {
    id,
    preview: "Thread preview",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
