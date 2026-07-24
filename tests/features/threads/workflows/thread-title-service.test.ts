import { describe, expect, it, vi } from "vitest";

import type { ThreadTitleContext } from "../../../../src/domain/threads/title-generation-model";
import {
  createThreadTitleService,
  type ThreadTitleService,
  type ThreadTitleServiceHost,
} from "../../../../src/features/threads/workflows/thread-title-service";

describe("ThreadTitleService", () => {
  it("resolves visible context once and generates from the prepared context", async () => {
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const withClient = vi.fn().mockRejectedValue(new Error("should not read persisted context"));
    const service = titleService({
      visibleContext: () => titleContext("visible request", "visible response"),
      port: {
        persistedContext: withClient,
        generateTitle: generateThreadTitle,
      },
    });

    const context = await service.resolveContext("thread");
    expect(context).toEqual(titleContext("visible request", "visible response"));
    if (!context) throw new Error("Expected visible title context.");
    await expect(service.generate(context)).resolves.toBe("Generated title");

    expect(withClient).not.toHaveBeenCalled();
    expect(generateThreadTitle).toHaveBeenCalledWith(titleContext("visible request", "visible response"), expect.any(AbortSignal));
  });

  it("reports unavailable context without turning it into a generation error", async () => {
    const service = titleService();

    await expect(service.resolveContext("thread")).resolves.toBeNull();
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

  it("cancels stale title work and starts later work with a fresh signal", async () => {
    let resolveOldTitle!: (title: string | null) => void;
    const generateTitle = vi
      .fn()
      .mockImplementationOnce(
        (_context: ThreadTitleContext, _signal: AbortSignal) =>
          new Promise<string | null>((resolve) => {
            resolveOldTitle = resolve;
          }),
      )
      .mockResolvedValueOnce("Fresh title");
    const service = titleService({
      visibleContext: () => titleContext("request", "response"),
      port: {
        persistedContext: vi.fn().mockResolvedValue(null),
        generateTitle,
      },
    });

    const context = titleContext("request", "response");
    const staleTitle = service.generate(context);
    await Promise.resolve();
    const staleSignal = generateTitle.mock.calls[0]?.[1];
    service.invalidate();

    expect(staleSignal?.aborted).toBe(true);
    await expect(service.generate(context)).resolves.toBe("Fresh title");
    resolveOldTitle("Stale title");
    await expect(staleTitle).rejects.toThrow("Thread title generation cancelled.");
  });
});

function titleService(options: Partial<ThreadTitleServiceHost> = {}): ThreadTitleService {
  return createThreadTitleService({
    port: {
      persistedContext: vi.fn().mockResolvedValue(null),
      generateTitle: vi.fn().mockResolvedValue(null),
    },
    ...options,
  });
}

function titleContext(userRequest: string, assistantResponse: string): ThreadTitleContext {
  return { userRequest, assistantResponse };
}
