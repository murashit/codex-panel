import { describe, expect, it, vi } from "vitest";

import { OwnerLifetime } from "../../../src/shared/async/owner-lifetime";

describe("OwnerLifetime", () => {
  it("invalidates the owned signal on dispose and rotates it on reactivation", () => {
    const lifetime = new OwnerLifetime();
    const first = lifetime.signal();
    const onAbort = vi.fn();
    first.addEventListener("abort", onAbort);

    expect(lifetime.isActive()).toBe(true);
    expect(lifetime.isCurrent(first)).toBe(true);
    expect(lifetime.isCurrent(new AbortController().signal)).toBe(false);

    lifetime.dispose();

    expect(onAbort).toHaveBeenCalledOnce();
    expect(first.aborted).toBe(true);
    expect(lifetime.isActive()).toBe(false);
    expect(lifetime.isCurrent(first)).toBe(false);

    lifetime.activate();
    const second = lifetime.signal();

    expect(second).not.toBe(first);
    expect(second.aborted).toBe(false);
    expect(lifetime.isCurrent(first)).toBe(false);
    expect(lifetime.isCurrent(second)).toBe(true);
  });

  it("keeps repeated activation and disposal idempotent", () => {
    const lifetime = new OwnerLifetime();
    const initial = lifetime.signal();

    lifetime.activate();
    expect(lifetime.signal()).toBe(initial);

    lifetime.dispose();
    lifetime.dispose();
    lifetime.activate();
    const reactivated = lifetime.signal();
    lifetime.activate();

    expect(lifetime.signal()).toBe(reactivated);
    expect(lifetime.isCurrent(new AbortController().signal)).toBe(false);
  });
});
