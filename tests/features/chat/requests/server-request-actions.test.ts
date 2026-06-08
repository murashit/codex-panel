import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/client";
import { createServerRequestActions } from "../../../../src/features/chat/requests/server-request-actions";

describe("createServerRequestActions", () => {
  it("responds through the current app-server client", () => {
    const respondToServerRequest = vi.fn();
    const responder = createServerRequestActions({
      currentClient: () => ({ respondToServerRequest }) as unknown as AppServerClient,
    });

    expect(responder.respond(7, { ok: true })).toBe(true);

    expect(respondToServerRequest).toHaveBeenCalledWith(7, { ok: true });
  });

  it("rejects through the current app-server client", () => {
    const rejectServerRequest = vi.fn();
    const responder = createServerRequestActions({
      currentClient: () => ({ rejectServerRequest }) as unknown as AppServerClient,
    });

    expect(responder.reject(7, -32000, "No")).toBe(true);

    expect(rejectServerRequest).toHaveBeenCalledWith(7, -32000, "No");
  });

  it("reports failure when there is no client or the client throws", () => {
    expect(createServerRequestActions({ currentClient: () => null }).respond(7, null)).toBe(false);
    expect(
      createServerRequestActions({
        currentClient: () =>
          ({
            rejectServerRequest: () => {
              throw new Error("closed");
            },
          }) as unknown as AppServerClient,
      }).reject(7, -32000, "No"),
    ).toBe(false);
  });
});
