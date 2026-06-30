import { describe, expect, it } from "vitest";

import { ConnectionWorkTracker } from "../../../../../src/features/chat/application/connection/connection-work";

describe("ConnectionWorkTracker", () => {
  it("tracks active connection work by identity", () => {
    const tracker = new ConnectionWorkTracker();
    const connection = tracker.begin();
    const stale = { kind: "connecting" as const, promise: Promise.resolve() };

    expect(tracker.active()).toBe(connection);
    expect(tracker.isStale(connection)).toBe(false);
    expect(tracker.isStale(stale)).toBe(true);

    const promise = Promise.resolve();
    connection.promise = promise;
    tracker.finish(connection, Promise.resolve());
    expect(tracker.active()).toBe(connection);
    tracker.finish(connection, promise);
    expect(tracker.active()).toBeNull();
  });

  it("keeps stale connection completions from clearing the active connection", () => {
    const firstPromise = Promise.resolve();
    const secondPromise = Promise.resolve();
    const tracker = new ConnectionWorkTracker();
    const first = tracker.begin();
    first.promise = firstPromise;
    const second = tracker.begin();
    second.promise = secondPromise;

    tracker.finish(first, firstPromise);
    expect(tracker.active()).toBe(second);
    tracker.finish(second, firstPromise);
    expect(tracker.active()).toBe(second);
    tracker.finish(second, secondPromise);
    expect(tracker.active()).toBeNull();
  });
});
