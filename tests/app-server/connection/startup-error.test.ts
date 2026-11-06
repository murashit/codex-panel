import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../../../src/app-server/connection/client";

// Real spawn failures distinguish missing cwd from missing executable; fake errno alone cannot.
describe("app-server startup paths", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "panel-startup-"));
    vi.stubGlobal("window", { setTimeout, clearTimeout });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["executable", "cwd", "cwd-file", "relative-executable"] as const)(
    "explains a missing %s using the actual spawn failure",
    async (missing) => {
      const file = join(directory, "file");
      if (missing === "cwd-file") await writeFile(file, "not a directory");
      const client = new AppServerClient({
        codexPath:
          missing === "relative-executable"
            ? `missing-${basename(directory)}`
            : missing === "executable"
              ? join(directory, "missing-codex")
              : process.execPath,
        cwd:
          missing === "executable" || missing === "relative-executable"
            ? directory
            : missing === "cwd-file"
              ? file
              : join(directory, "missing-vault"),
        initializeParams: { clientInfo: { name: "test", title: "Test", version: "0" }, capabilities: null },
        handlers: { onNotification() {}, onServerRequest() {}, onLog() {}, onExit() {} },
      });
      try {
        await expect(client.connect()).rejects.toThrow(
          missing === "relative-executable"
            ? "Codex could not find a required file or folder."
            : missing === "executable"
              ? "The Codex executable was not found."
              : "The vault folder is unavailable.",
        );
        expect(client.isConnected()).toBe(false);
      } finally {
        client.disconnect();
      }
    },
  );
});
