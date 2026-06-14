import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { AutoTitleController } from "../../../../src/features/chat/application/threads/auto-title-controller";
import type { Thread } from "../../../../src/domain/threads/model";
import { DEFAULT_SETTINGS } from "../../../../src/settings/model";
import { deferred } from "../../../support/async";

describe("AutoTitleController", () => {
  it("prefers visible turn items over completed turn summaries for active streamed turns", async () => {
    const setThreadName = vi.fn().mockResolvedValue({});
    const generateThreadTitle = vi.fn().mockResolvedValue("Visible context title");
    const { controller, stateStore } = controllerFixture({
      currentClient: () => fakeClient({ setThreadName }),
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

    controller.maybeAutoTitleThread("thread", "turn", {
      userText: "Completed payload request.",
      assistantText: "Completed payload response.",
    });
    await flushPromises();

    expect(generateThreadTitle).toHaveBeenCalledWith({
      userRequest: "Visible streamed request.",
      assistantResponse: "Visible streamed response.",
    });
    expect(setThreadName).toHaveBeenCalledWith("thread", "Visible context title");
  });

  it("uses visible turn items when completed turn summaries are unavailable", async () => {
    const setThreadName = vi.fn().mockResolvedValue({});
    const generateThreadTitle = vi.fn().mockResolvedValue("Visible context title");
    const { controller, stateStore } = controllerFixture({
      currentClient: () => fakeClient({ setThreadName }),
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

    controller.maybeAutoTitleThread("thread", "turn", null);
    await flushPromises();

    expect(generateThreadTitle).toHaveBeenCalledWith({
      userRequest: "Please diagnose auto naming.",
      assistantResponse: "I found the regression.",
    });
    expect(setThreadName).toHaveBeenCalledWith("thread", "Visible context title");
  });

  it("does not apply a completed auto-title after the thread leaves the list", async () => {
    const generatedTitle = deferred<string | null>();
    const setThreadName = vi.fn().mockResolvedValue({});
    const { controller, stateStore, notifyThreadRenamed } = controllerFixture({
      currentClient: () => fakeClient({ setThreadName }),
      generateThreadTitle: vi.fn(() => generatedTitle.promise),
    });

    controller.maybeAutoTitleThread("thread", "turn", { userText: "Please name this.", assistantText: "Done." });
    await flushPromises();

    stateStore.dispatch({ type: "thread-list/applied", threads: [] });
    generatedTitle.resolve("Generated title");
    await flushPromises();

    expect(setThreadName).not.toHaveBeenCalled();
    expect(notifyThreadRenamed).not.toHaveBeenCalled();
  });

  it("does not overwrite a manual name when auto-title save finishes later", async () => {
    const savedName = deferred<object>();
    const setThreadName = vi.fn(() => savedName.promise);
    const { controller, stateStore, notifyThreadRenamed } = controllerFixture({
      currentClient: () => fakeClient({ setThreadName }),
      generateThreadTitle: vi.fn().mockResolvedValue("Generated title"),
    });

    controller.maybeAutoTitleThread("thread", "turn", { userText: "Please name this.", assistantText: "Done." });
    await flushPromises();
    expect(setThreadName).toHaveBeenCalledWith("thread", "Generated title");

    stateStore.dispatch({ type: "thread-list/applied", threads: [{ ...threadFixture("thread"), name: "Manual title" }] });
    savedName.resolve({});
    await flushPromises();

    expect(stateStore.getState().threadList.listedThreads[0]?.name).toBe("Manual title");
    expect(notifyThreadRenamed).not.toHaveBeenCalled();
  });
});

function controllerFixture(
  overrides: Partial<ConstructorParameters<typeof AutoTitleController>[0]> = {},
): ConstructorParameters<typeof AutoTitleController>[0] & { controller: AutoTitleController } {
  const stateStore = createChatStateStore();
  stateStore.dispatch({ type: "thread-list/applied", threads: [threadFixture("thread")] });
  const host = {
    stateStore,
    vaultPath: "/vault",
    settings: () => DEFAULT_SETTINGS,
    currentClient: () => fakeClient(),
    notifyThreadRenamed: vi.fn(),
    ...overrides,
  } satisfies ConstructorParameters<typeof AutoTitleController>[0];
  return { ...host, controller: new AutoTitleController(host) };
}

function fakeClient(options: { setThreadName?: ReturnType<typeof vi.fn> } = {}): AppServerClient {
  return {
    setThreadName: options.setThreadName ?? vi.fn().mockResolvedValue({}),
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
}
