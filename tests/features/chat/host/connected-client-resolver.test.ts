import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import { createConnectedClientResolver } from "../../../../src/features/chat/host/session/connected-client-resolver";

describe("createConnectedClientResolver", () => {
  it("connects before resolving the current client", async () => {
    const client = {} as AppServerClient;
    const currentClient = vi.fn(() => client);
    const ensureConnected = vi.fn().mockResolvedValue(undefined);
    const resolver = createConnectedClientResolver(currentClient);
    resolver.bindEnsureConnected(ensureConnected);

    await expect(resolver.resolve()).resolves.toBe(client);
    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(currentClient).toHaveBeenCalledOnce();
  });

  it("rejects use before the connection actions are bound", async () => {
    const resolver = createConnectedClientResolver(() => null);

    await expect(resolver.resolve()).rejects.toThrow("connection actions are not initialized");
  });

  it("rejects rebinding the connection actions", () => {
    const resolver = createConnectedClientResolver(() => null);
    resolver.bindEnsureConnected(vi.fn().mockResolvedValue(undefined));

    expect(() => resolver.bindEnsureConnected(vi.fn().mockResolvedValue(undefined))).toThrow("connection actions are already initialized");
  });
});
