import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";

import { createInvalidatedQueryRefreshCoordinator } from "../../../src/app-server/query/invalidated-query-refresh";
import { deferred } from "../../support/async";

interface TestQueries {
  readonly skills: string;
}

describe("InvalidatedQueryRefreshCoordinator", () => {
  it("does not let an ordinary read overtake an invalidation refresh", async () => {
    const invalidated = deferred<string>();
    const ordinaryRead = vi.fn().mockResolvedValue("ordinary");
    const invalidatedRead = vi.fn(() => invalidated.promise);
    const { coordinator } = createCoordinator(ordinaryRead, invalidatedRead);

    const refresh = coordinator.refreshAfterInvalidation("skills");
    await vi.waitFor(() => expect(invalidatedRead).toHaveBeenCalledOnce());
    const read = coordinator.read("skills");

    expect(ordinaryRead).not.toHaveBeenCalled();
    invalidated.resolve("fresh");

    await expect(Promise.all([refresh, read])).resolves.toEqual([undefined, "fresh"]);
    expect(ordinaryRead).not.toHaveBeenCalled();
  });

  it("waits for a new refresh registered while an earlier refresh settles", async () => {
    const first = deferred<string>();
    const next = deferred<string>();
    const invalidatedRead = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => next.promise);
    const ordinaryRead = vi.fn().mockResolvedValue("ordinary");
    const { coordinator } = createCoordinator(ordinaryRead, invalidatedRead);

    const firstRefresh = coordinator.refreshAfterInvalidation("skills");
    await vi.waitFor(() => expect(invalidatedRead).toHaveBeenCalledOnce());
    const nextRefresh = firstRefresh.then(() => coordinator.refreshAfterInvalidation("skills"));
    const read = coordinator.read("skills");
    const readSettled = vi.fn();
    void read.then(readSettled);
    first.resolve("first");
    await vi.waitFor(() => expect(invalidatedRead).toHaveBeenCalledTimes(2));

    expect(readSettled).not.toHaveBeenCalled();
    expect(ordinaryRead).not.toHaveBeenCalled();
    next.resolve("latest");

    await expect(Promise.all([nextRefresh, read])).resolves.toEqual([undefined, "latest"]);
    expect(ordinaryRead).not.toHaveBeenCalled();
  });

  it("runs one trailing refresh for notifications received during an active refresh", async () => {
    const first = deferred<string>();
    const trailing = deferred<string>();
    const invalidatedRead = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => trailing.promise);
    const { client, coordinator } = createCoordinator(vi.fn().mockResolvedValue("ordinary"), invalidatedRead);

    const older = coordinator.refreshAfterInvalidation("skills");
    await vi.waitFor(() => expect(invalidatedRead).toHaveBeenCalledOnce());
    const newer = coordinator.refreshAfterInvalidation("skills");
    first.resolve("superseded");
    await vi.waitFor(() => expect(invalidatedRead).toHaveBeenCalledTimes(2));
    trailing.resolve("latest");

    await expect(Promise.all([older, newer])).resolves.toEqual([undefined, undefined]);
    expect(client.getQueryData(["skills"])).toBe("latest");
    expect(invalidatedRead).toHaveBeenCalledTimes(2);
  });

  it("continues to the latest generation after a superseded refresh fails", async () => {
    const first = deferred<string>();
    const trailing = deferred<string>();
    const invalidatedRead = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => trailing.promise);
    const { client, coordinator } = createCoordinator(vi.fn().mockResolvedValue("ordinary"), invalidatedRead);

    const older = coordinator.refreshAfterInvalidation("skills");
    await vi.waitFor(() => expect(invalidatedRead).toHaveBeenCalledOnce());
    const newer = coordinator.refreshAfterInvalidation("skills");
    first.reject(new Error("superseded failure"));
    await vi.waitFor(() => expect(invalidatedRead).toHaveBeenCalledTimes(2));
    trailing.resolve("latest");

    await expect(Promise.all([older, newer])).resolves.toEqual([undefined, undefined]);
    expect(client.getQueryData(["skills"])).toBe("latest");
  });

  it("reports a refresh failure when no newer invalidation supersedes it", async () => {
    const invalidatedRead = vi.fn().mockRejectedValue(new Error("offline"));
    const { coordinator } = createCoordinator(vi.fn().mockResolvedValue("ordinary"), invalidatedRead);

    await expect(coordinator.refreshAfterInvalidation("skills")).rejects.toThrow("offline");
    await expect(coordinator.read("skills")).resolves.toBe("ordinary");
  });
});

function createCoordinator(ordinaryRead: () => Promise<string>, invalidatedRead: () => Promise<string>) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const coordinator = createInvalidatedQueryRefreshCoordinator<TestQueries>({
    client,
    queryOptions: (_id, cause) => ({
      queryKey: ["skills"],
      queryFn: cause === "refresh" ? invalidatedRead : ordinaryRead,
    }),
  });
  return { client, coordinator };
}
