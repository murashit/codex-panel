import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import { rejectServerRequest, respondToServerRequest } from "../../../../../src/features/chat/protocol/server-requests/responder";

describe("server request responder", () => {
  it("responds through the current app-server client", () => {
    const respond = vi.fn();
    const host = {
      currentClient: () => ({ respondToServerRequest: respond }) as unknown as AppServerClient,
    };

    expect(respondToServerRequest(host, 7, { ok: true })).toBe(true);

    expect(respond).toHaveBeenCalledWith(7, { ok: true });
  });

  it("rejects through the current app-server client", () => {
    const reject = vi.fn();
    const host = {
      currentClient: () => ({ rejectServerRequest: reject }) as unknown as AppServerClient,
    };

    expect(rejectServerRequest(host, 7, -32000, "No")).toBe(true);

    expect(reject).toHaveBeenCalledWith(7, -32000, "No");
  });

  it("reports failure when there is no client or the client throws", () => {
    expect(respondToServerRequest({ currentClient: () => null }, 7, null)).toBe(false);
    expect(
      rejectServerRequest(
        {
          currentClient: () =>
            ({
              rejectServerRequest: () => {
                throw new Error("closed");
              },
            }) as unknown as AppServerClient,
        },
        7,
        -32000,
        "No",
      ),
    ).toBe(false);
  });
});
