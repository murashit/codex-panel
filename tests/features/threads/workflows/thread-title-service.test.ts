import { describe, expect, it, vi } from "vitest";

import type { ThreadTitleContext } from "../../../../src/domain/threads/title-generation-model";
import {
  createThreadTitleService,
  type ThreadTitleService,
  type ThreadTitleServiceHost,
} from "../../../../src/features/threads/workflows/thread-title-service";
import { deferred } from "../../../support/async";

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

  it("falls back to persisted context when no visible context exists", async () => {
    const persisted = titleContext("persisted request", "persisted response");
    const persistedContext = vi.fn().mockResolvedValue(persisted);
    const service = titleService({ port: { persistedContext, generateTitle: vi.fn() } });

    await expect(service.resolveContext("thread")).resolves.toEqual(persisted);
    expect(persistedContext).toHaveBeenCalledWith("thread");
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

  it("returns no completed-turn context when neither source is available", () => {
    expect(titleService().completedTurnContext("turn", null)).toBeNull();
  });

  it("rejects generation immediately when the caller signal is already aborted", async () => {
    const generateTitle = vi.fn().mockResolvedValue("Generated title");
    const service = titleService({ port: { persistedContext: vi.fn(), generateTitle } });
    const controller = new AbortController();
    controller.abort();

    await expect(service.generate(titleContext("request", "response"), controller.signal)).rejects.toThrow();
    expect(generateTitle).not.toHaveBeenCalled();
  });

  it("propagates cancellation from an active caller signal", async () => {
    const generation = deferred<string | null>();
    const generateTitle = vi.fn().mockReturnValue(generation.promise);
    const service = titleService({ port: { persistedContext: vi.fn(), generateTitle } });
    const controller = new AbortController();

    const pending = service.generate(titleContext("request", "response"), controller.signal);
    await vi.waitFor(() => expect(generateTitle).toHaveBeenCalledOnce());
    const linkedSignal = generateTitle.mock.calls[0]?.[1] as AbortSignal;
    controller.abort();

    expect(linkedSignal.aborted).toBe(true);
    generation.resolve("Generated title");
    await expect(pending).rejects.toThrow();
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
    await expect(staleTitle).rejects.toThrow();
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
