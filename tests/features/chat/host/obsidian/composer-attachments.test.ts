// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createVaultComposerAttachmentHandler } from "../../../../../src/features/chat/host/obsidian/composer-attachments.obsidian";

describe("vault composer attachments", () => {
  it("returns committed attachments when a later file fails and continues saving the remaining files", async () => {
    const vault = vaultFixture();
    const handler = createVaultComposerAttachmentHandler({ app: { vault } as never, attachmentFolder: () => "Files" });
    const failed = new File(["unreadable"], "broken.txt");
    const read = vi.spyOn(failed, "arrayBuffer").mockRejectedValue(new Error("File read failed"));
    try {
      const result = await handler.saveFiles([new File(["first"], "first.txt"), failed, new File(["last"], "last.txt")]);
      expect(result).toEqual({
        attachments: [
          { kind: "file", name: "first", path: "Files/first.txt", marker: "[[Files/first.txt]]" },
          { kind: "file", name: "last", path: "Files/last.txt", marker: "[[Files/last.txt]]" },
        ],
        failures: [{ name: "broken.txt", message: "File read failed" }],
      });
      expect(vault.createBinary.mock.calls.map(([path]) => path)).toEqual(["Files/first.txt", "Files/last.txt"]);
    } finally {
      read.mockRestore();
    }
  });

  it("saves unnamed pasted images with a generated filename and Obsidian embed marker", async () => {
    const vault = vaultFixture();
    const handler = createVaultComposerAttachmentHandler({
      app: { vault } as never,
      attachmentFolder: () => "Codex Attachments",
      now: () => new Date("2026-06-28T15:30:12"),
    });

    const { attachments, failures } = await handler.saveFiles([new File(["image"], "", { type: "image/png" })]);

    expect(vault.createFolder).toHaveBeenCalledWith("Codex Attachments");
    expect(vault.createBinary).toHaveBeenCalledWith("Codex Attachments/codex-panel-20260628-153012.png", expect.any(ArrayBuffer));
    expect(failures).toEqual([]);
    expect(attachments).toEqual([
      {
        kind: "image",
        name: "codex-panel-20260628-153012",
        path: "Codex Attachments/codex-panel-20260628-153012.png",
        marker: "![[Codex Attachments/codex-panel-20260628-153012.png]]",
      },
    ]);
  });

  it("keeps known filenames and starts numeric collision suffixes at 2", async () => {
    const vault = vaultFixture(["Files/Paper.pdf"]);
    const handler = createVaultComposerAttachmentHandler({
      app: { vault } as never,
      attachmentFolder: () => "Files",
    });

    const { attachments, failures } = await handler.saveFiles([new File(["pdf"], "Paper.pdf", { type: "application/pdf" })]);

    expect(vault.createBinary).toHaveBeenCalledWith("Files/Paper 2.pdf", expect.any(ArrayBuffer));
    expect(failures).toEqual([]);
    expect(attachments).toEqual([
      {
        kind: "file",
        name: "Paper 2",
        path: "Files/Paper 2.pdf",
        marker: "[[Files/Paper 2.pdf]]",
      },
    ]);
  });

  it("rejects relative attachment folder segments before sanitizing", async () => {
    const handler = createVaultComposerAttachmentHandler({
      app: { vault: vaultFixture() } as never,
      attachmentFolder: () => "../Files",
    });

    await expect(handler.saveFiles([new File(["pdf"], "Paper.pdf", { type: "application/pdf" })])).rejects.toThrow(
      "Attachment folder cannot contain relative path segments.",
    );
  });
});

function vaultFixture(existingPaths: readonly string[] = []) {
  const existing = new Set(existingPaths);
  return {
    getAbstractFileByPath: vi.fn((path: string) => (existing.has(path) ? {} : null)),
    createFolder: vi.fn(async (path: string) => {
      existing.add(path);
    }),
    createBinary: vi.fn(async (path: string) => {
      existing.add(path);
    }),
  };
}
