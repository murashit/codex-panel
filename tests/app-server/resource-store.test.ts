import { describe, expect, it, vi } from "vitest";

import type { AppServerQueryClientRunner } from "../../src/app-server/query/cache";
import { AppServerResourceStore, StaleAppServerResourceContextError } from "../../src/app-server/query/resource-store";

describe("AppServerResourceStore", () => {
  it("uses its required runtime-owned client runner", async () => {
    const runWithClient = vi.fn(async (operation) =>
      operation({
        request: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      } as never),
    );
    const store = createStore({ runWithClient });

    await expect(store.fetchActiveThreads()).resolves.toEqual([]);

    expect(runWithClient).toHaveBeenCalledOnce();
  });

  it("rejects new work after disposal", async () => {
    const store = createStore({
      runWithClient: vi.fn(() => Promise.resolve([])) as AppServerQueryClientRunner["runWithClient"],
    });

    store.dispose();
    store.dispose();

    expect(() => store.fetchModels()).toThrow(StaleAppServerResourceContextError);
  });

  it("rejects a completion after its runtime-owned store is disposed", async () => {
    let resolveFetch: (models: readonly []) => void = () => undefined;
    const pending = new Promise<readonly []>((resolve) => {
      resolveFetch = resolve;
    });
    const store = createStore({
      runWithClient: vi.fn(() => pending) as AppServerQueryClientRunner["runWithClient"],
    });

    const fetch = store.fetchModels();
    store.dispose();
    resolveFetch([]);

    await expect(fetch).rejects.toBeInstanceOf(StaleAppServerResourceContextError);
  });

  it("does not notify observers after disposal", async () => {
    let resolveFetch: (models: readonly []) => void = () => undefined;
    const pending = new Promise<readonly []>((resolve) => {
      resolveFetch = resolve;
    });
    const store = createStore({
      runWithClient: vi.fn(() => pending) as AppServerQueryClientRunner["runWithClient"],
    });
    const listener = vi.fn();
    store.observeModelsResult(listener, { emitCurrent: false });

    const fetch = store.fetchModels();
    listener.mockClear();
    store.dispose();
    resolveFetch([]);
    await expect(fetch).rejects.toBeInstanceOf(StaleAppServerResourceContextError);

    expect(listener).not.toHaveBeenCalled();
  });
});

function createStore(clientRunner: AppServerQueryClientRunner): AppServerResourceStore {
  return new AppServerResourceStore({
    context: { codexPath: "codex", vaultPath: "/vault" },
    clientRunner,
  });
}
