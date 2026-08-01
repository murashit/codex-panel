// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../../../../../src/domain/threads/model";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { ChatResumeWorkTracker } from "../../../../../src/features/chat/application/threads/resume-work";
import { createThreadGoalCoordinator } from "../../../../../src/features/chat/application/threads/thread-goal-coordinator";
import { createSessionThreadFoundation } from "../../../../../src/features/chat/host/session/thread";
import { createThreadAutoTitleWork } from "../../../../../src/features/threads/workflows/thread-auto-title-work";
import { DEFAULT_SETTINGS } from "../../../../../src/settings/model";
import { createKeyedOperationCoordinator } from "../../../../../src/shared/runtime/keyed-operation-coordinator";
import { deferred } from "../../../../support/async";
import { chatPanelSettingsAccess } from "../../support/settings";

describe("chat thread foundation auto-title handoff", () => {
  it("lets shared first-turn title work finish after the initiating panel invalidates its active thread", async () => {
    const generatedTitle = deferred<string | null>();
    const generateTitle = vi.fn(() => generatedTitle.promise);
    const renameThread = vi.fn().mockResolvedValue(undefined);
    const stateStore = createChatStateStore();
    const sharedTitleWork = createThreadAutoTitleWork({
      titlePort: {
        persistedContext: vi.fn().mockResolvedValue(null),
        generateTitle,
      },
      mutationPort: { renameThread },
      nameMutations: createKeyedOperationCoordinator({ whenBusy: "queue" }),
      facts: { apply: vi.fn(), applyBatch: vi.fn() },
    });
    const foundation = createSessionThreadFoundation(
      {
        stateStore,
        resumeWork: new ChatResumeWorkTracker(),
        threadStreamScrollBinding: { showLatest: vi.fn() },
        getClosing: () => false,
        environment: {
          obsidian: {
            app: { vault: { configDir: ".obsidian" } },
            archiveDestination: vi.fn(),
          },
          plugin: {
            appServerContext: { codexPath: "codex", vaultPath: "/vault" },
            settings: chatPanelSettingsAccess(DEFAULT_SETTINGS),
            threadTitlePort: {
              persistedContext: vi.fn().mockResolvedValue(null),
              generateTitle: vi.fn(),
            },
            threadAutoTitleWork: sharedTitleWork,
            threadNameMutations: createKeyedOperationCoordinator({ whenBusy: "queue" }),
            threadFacts: { apply: vi.fn(), applyBatch: vi.fn() },
            threadGoalCoordinator: createThreadGoalCoordinator(),
            threadCatalog: {
              activeThreadsSnapshot: () => [threadFixture()],
            },
          },
        },
      } as never,
      {
        appServer: {
          clientAccess: { withClient: vi.fn() },
          threadGoalRead: { readThreadGoal: vi.fn().mockResolvedValue(null) },
        },
        localItemIds: createLocalIdSource(),
        status: { set: vi.fn(), addSystemMessage: vi.fn() },
      } as never,
    );

    foundation.autoTitleCoordinator.maybeAutoTitleThread("thread", "turn", {
      userText: "Capture this context.",
      assistantText: "Continue after the panel moves on.",
    });
    await vi.waitFor(() => expect(generateTitle).toHaveBeenCalledOnce());

    foundation.invalidateActiveThreadWork();
    generatedTitle.resolve("Shared runtime title");
    await vi.waitFor(() => expect(renameThread).toHaveBeenCalledWith("thread", "Shared runtime title"));
  });
});

function threadFixture(): Thread {
  return {
    id: "thread",
    preview: "Thread preview",
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    createdAt: 1,
    updatedAt: 1,
  };
}
