import { type App, FileSystemAdapter } from "obsidian";
import { describe, expect, it } from "vitest";

import { getVaultPath } from "../src/plugin-vault.obsidian";

describe("plugin vault", () => {
  it("requires a desktop filesystem vault path", () => {
    const adapter = Object.create(FileSystemAdapter.prototype) as FileSystemAdapter;
    Object.defineProperty(adapter, "getBasePath", { value: () => "/vault" });

    expect(getVaultPath({ vault: { adapter } } as unknown as App)).toBe("/vault");
    expect(() => getVaultPath({ vault: { adapter: {} } } as unknown as App)).toThrow(
      "This plugin requires a desktop vault with a local basePath.",
    );
  });
});
