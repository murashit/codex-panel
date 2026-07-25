import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppServerClientHandlers, AppServerClientOptions } from "../../../src/app-server/connection/client";
import { withShortLivedAppServerClient } from "../../../src/app-server/connection/short-lived-client";

const clientMocks = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<unknown>>(),
  disconnect: vi.fn<() => void>(),
  options: [] as AppServerClientOptions[],
}));

vi.mock("../../../src/app-server/connection/client", () => ({
  AppServerClient: class {
    constructor(options: AppServerClientOptions) {
      clientMocks.options.push(options);
    }

    connect = clientMocks.connect;
    disconnect = clientMocks.disconnect;
  },
}));

describe("withShortLivedAppServerClient", () => {
  beforeEach(() => {
    clientMocks.connect.mockReset().mockResolvedValue({});
    clientMocks.disconnect.mockReset();
    clientMocks.options.length = 0;
  });

  it("connects, runs the operation, and disconnects in lifecycle order", async () => {
    const lifecycle: string[] = [];
    clientMocks.connect.mockImplementation(async () => {
      lifecycle.push("connect");
    });
    clientMocks.disconnect.mockImplementation(() => {
      lifecycle.push("disconnect");
    });

    await expect(
      withShortLivedAppServerClient("/opt/codex", "/vault", async (client) => {
        lifecycle.push("operation");
        return client;
      }),
    ).resolves.toBeDefined();

    expect(lifecycle).toEqual(["connect", "operation", "disconnect"]);
    expect(clientMocks.options[0]).toMatchObject({ codexPath: "/opt/codex", cwd: "/vault" });
  });

  it.each([
    ["connect", () => clientMocks.connect.mockRejectedValue(new Error("connect failed"))],
    ["operation", () => undefined],
  ])("disconnects when %s fails", async (failure, arrange) => {
    arrange();

    const operation = vi.fn(async () => {
      throw new Error("operation failed");
    });
    await expect(withShortLivedAppServerClient("/opt/codex", "/vault", failure === "connect" ? vi.fn() : operation)).rejects.toThrow(
      `${failure} failed`,
    );

    expect(clientMocks.disconnect).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledTimes(failure === "connect" ? 0 : 1);
  });

  it.each([
    [undefined, "This Codex Panel view does not handle server requests."],
    [
      { serverRequests: { kind: "reject" as const, message: "Background operation cannot answer." } },
      "Background operation cannot answer.",
    ],
  ])("rejects server requests with the configured policy message", async (options, expectedMessage) => {
    await withShortLivedAppServerClient("/opt/codex", "/vault", async () => undefined, options);
    const reject = vi.fn();

    clientHandlers().onServerRequest({} as never, { respond: vi.fn(), reject });

    expect(reject).toHaveBeenCalledWith(-32601, expectedMessage);
  });
});

function clientHandlers(): AppServerClientHandlers {
  const handlers = clientMocks.options[0]?.handlers;
  if (!handlers) throw new Error("Expected a short-lived client to be constructed.");
  return handlers;
}
