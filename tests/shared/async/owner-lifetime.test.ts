import { describe, expect, it, vi } from "vitest";

import { OwnerLifetime } from "../../../src/shared/async/owner-lifetime";

describe("OwnerLifetime", () => {
  it("keeps activation and disposal idempotent while invalidating and rotating the owned signal", () => {
    const lifetime = new OwnerLifetime();
    const first = lifetime.signal();
    const onAbort = vi.fn();
    first.addEventListener("abort", onAbort);

    expect(lifetime.isActive()).toBe(true);
    expect(lifetime.isCurrent(first)).toBe(true);
    expect(lifetime.isCurrent(new AbortController().signal)).toBe(false);

    lifetime.activate();
    expect(lifetime.signal()).toBe(first);

    lifetime.dispose();

    expect(onAbort).toHaveBeenCalledOnce();
    expect(first.aborted).toBe(true);
    expect(lifetime.isActive()).toBe(false);
    expect(lifetime.isCurrent(first)).toBe(false);

    lifetime.dispose();
    expect(onAbort).toHaveBeenCalledOnce();

    lifetime.activate();
    const second = lifetime.signal();

    expect(second).not.toBe(first);
    expect(second.aborted).toBe(false);
    expect(lifetime.isActive()).toBe(true);
    expect(lifetime.isCurrent(first)).toBe(false);
    expect(lifetime.isCurrent(second)).toBe(true);
    lifetime.activate();

    expect(lifetime.signal()).toBe(second);
    expect(lifetime.isCurrent(new AbortController().signal)).toBe(false);
  });
});
