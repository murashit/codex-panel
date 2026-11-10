import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import { vaultFileLinkTarget } from "../../../../../src/features/chat/host/thread-stream/vault-file-links.obsidian";
import { markdownFileFixture as tFile } from "../../../../support/vault-file";

describe("markdown file links", () => {
  it("opens existing vault files with normalized paths and retained fragments", () => {
    const app = appFixture(["docs/Guide.md", "docs/R&D+notes.md"]);

    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Vault/docs/Guide.md:12#Heading")).toBe("docs/Guide.md#Heading");
    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "docs/Guide.md")).toBe("docs/Guide.md");
    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "docs/R%26D%2Bnotes.md#Costs%3A%202026")).toBe("docs/R&D+notes.md#Costs: 2026");
  });

  it("does not open missing files, folders, or configured Obsidian files", () => {
    const app = appFixture(["vault-config/plugins/foo/main.js", "docs/A#B.md", "docs/A.md"]);

    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Vault/docs/Missing.md")).toBeNull();
    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "docs")).toBeNull();
    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Vault/vault-config/plugins/foo/main.js")).toBeNull();
    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "docs/A%23B.md")).toBeNull();
  });
});

function appFixture(paths: string[]): App {
  const files = new Map<string, unknown>(paths.map((path) => [path, tFile(path)]));
  files.set("docs", { path: "docs", children: [] });
  return {
    vault: {
      configDir: "vault-config",
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    },
  } as unknown as App;
}
