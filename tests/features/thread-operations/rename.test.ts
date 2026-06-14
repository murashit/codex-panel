import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/connection/client";
import { renameThreadOnAppServer, threadRenameFromValue } from "../../../src/features/thread-operations/rename";

describe("thread rename operation", () => {
  it("normalizes thread names before saving them", async () => {
    const setThreadName = vi.fn().mockResolvedValue({});
    const client = fakeClient({ setThreadName });

    const rename = threadRenameFromValue("  Renamed   thread  ");

    expect(rename).toEqual({ name: "Renamed thread" });
    if (!rename) throw new Error("Expected normalized rename");
    await expect(renameThreadOnAppServer(client, "thread", rename)).resolves.toEqual({ name: "Renamed thread" });

    expect(setThreadName).toHaveBeenCalledWith("thread", "Renamed thread");
  });

  it("exposes normalized rename construction for surface guards", () => {
    expect(threadRenameFromValue("  Saved   title  ")).toEqual({ name: "Saved title" });
    expect(threadRenameFromValue("  ")).toBeNull();
  });
});

function fakeClient(options: { setThreadName: ReturnType<typeof vi.fn> }): AppServerClient {
  return {
    setThreadName: options.setThreadName,
  } as unknown as AppServerClient;
}
