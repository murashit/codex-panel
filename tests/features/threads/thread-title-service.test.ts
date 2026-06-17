import { describe, expect, it, vi } from "vitest";

import { THREAD_TITLE_CONTEXT_UNAVAILABLE_MESSAGE, type ThreadTitleContext } from "../../../src/domain/threads/title-generation-model";
import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import {
  createThreadTitleService,
  type ThreadTitleService,
  type ThreadTitleServiceHost,
} from "../../../src/features/threads/thread-title-service";

describe("ThreadTitleService", () => {
  it("generates a title from visible context without saving it", async () => {
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const service = titleService({
      visibleContext: () => titleContext("visible request", "visible response"),
      generateThreadTitle,
    });

    await expect(service.generateTitle("thread")).resolves.toBe("Generated title");

    expect(generateThreadTitle).toHaveBeenCalledWith(titleContext("visible request", "visible response"));
  });

  it("throws the existing unavailable-context error when no context can be resolved", async () => {
    const service = titleService();

    await expect(service.generateTitle("thread")).rejects.toThrow(THREAD_TITLE_CONTEXT_UNAVAILABLE_MESSAGE);
  });

  it("prefers visible completed-turn context over completed summaries", () => {
    const service = titleService({
      visibleCompletedTurnContext: () => titleContext("visible turn", "visible answer"),
    });

    expect(service.completedTurnContext("turn", { userText: "summary turn", assistantText: "summary answer" })).toEqual(
      titleContext("visible turn", "visible answer"),
    );
  });

  it("falls back from visible completed-turn context to completed summaries", () => {
    const service = titleService({
      visibleCompletedTurnContext: () => null,
    });

    expect(service.completedTurnContext("turn", { userText: "summary turn", assistantText: "summary answer" })).toEqual(
      titleContext("summary turn", "summary answer"),
    );
  });
});

function titleService(options: Partial<ThreadTitleServiceHost> = {}): ThreadTitleService {
  return createThreadTitleService({
    codexPath: () => "codex",
    vaultPath: "/vault",
    threadNamingModel: () => DEFAULT_SETTINGS.threadNamingModel,
    threadNamingEffort: () => DEFAULT_SETTINGS.threadNamingEffort,
    clientAccess: {
      withClient: vi.fn().mockResolvedValue(null),
    },
    ...options,
  });
}

function titleContext(userRequest: string, assistantResponse: string): ThreadTitleContext {
  return { userRequest, assistantResponse };
}
