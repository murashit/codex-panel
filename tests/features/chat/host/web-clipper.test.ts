import type { Vault } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexInput } from "../../../../src/domain/chat/input";
import type { ComposerInputSnapshot } from "../../../../src/features/chat/application/composer/input-snapshot";

const mocks = vi.hoisted(() => ({
  defuddleParse: vi.fn(),
  requestUrl: vi.fn(),
}));

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  return {
    ...actual,
    requestUrl: mocks.requestUrl,
  };
});

vi.mock("defuddle/full", () => ({
  default: vi.fn().mockImplementation(function MockDefuddle() {
    return { parse: mocks.defuddleParse };
  }),
}));

const { TFile } = await import("obsidian");
const { createVaultWebClipper } = await import("../../../../src/features/chat/host/obsidian/web-clipper.obsidian");

describe("vault web clipper", () => {
  beforeEach(() => {
    mocks.requestUrl.mockResolvedValue({ text: "<html><body>Article</body></html>" });
    mocks.defuddleParse.mockReturnValue({
      title: "Example",
      contentMarkdown: "Readable article",
      content: "Readable article",
      site: "Example Site",
      domain: "example.com",
    });
  });

  it("preserves composer-prepared message context alongside the clipped note mention", async () => {
    const vault = memoryVault();
    const inputSnapshot = { sourcePath: "source.md" } as ComposerInputSnapshot;
    const messageInput = [
      { type: "text" as const, text: "Summarize [[Notes/Alpha.md]] [[Files/Sketch.png]]" },
      { type: "mention" as const, name: "Alpha", path: "Notes/Alpha.md" },
      { type: "additionalContext" as const, key: "codex_panel_obsidian_context", kind: "untrusted" as const, value: "selection" },
      { type: "mention" as const, name: "Sketch.png", path: "Files/Sketch.png" },
      { type: "localImage" as const, path: "Files/Sketch.png" },
    ] satisfies CodexInput;
    const prepareInput = vi.fn(() => ({
      text: "Summarize [[Notes/Alpha.md]] [[Files/Sketch.png]]",
      input: messageInput,
    }));

    const result = await createVaultWebClipper({
      vault,
      settings: () => ({ clipFolder: "Codex Clippings", clipFilenameTemplate: "{{title}}.md", clipTags: "" }),
      prepareInput,
      viewWindow: () => ({ DOMParser: FakeDOMParser }) as unknown as Window,
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    }).clipUrl("https://example.com/article", "  Summarize [[Alpha]] [[Files/Sketch.png]]  ", inputSnapshot);

    expect(prepareInput).toHaveBeenCalledWith("Summarize [[Alpha]] [[Files/Sketch.png]]", inputSnapshot);
    expect(result).toEqual({
      text: "[[Codex Clippings/Example.md]] Summarize [[Notes/Alpha.md]] [[Files/Sketch.png]]",
      input: [
        { type: "text", text: "[[Codex Clippings/Example.md]] Summarize [[Notes/Alpha.md]] [[Files/Sketch.png]]" },
        { type: "mention", name: "Example", path: "Codex Clippings/Example.md" },
        { type: "mention", name: "Alpha", path: "Notes/Alpha.md" },
        { type: "additionalContext", key: "codex_panel_obsidian_context", kind: "untrusted", value: "selection" },
        { type: "mention", name: "Sketch.png", path: "Files/Sketch.png" },
        { type: "localImage", path: "Files/Sketch.png" },
      ],
    });
  });
});

class FakeDOMParser {
  parseFromString(): Document {
    return {} as Document;
  }
}

function memoryVault(): Vault {
  const files = new Map<string, InstanceType<typeof TFile>>();
  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
    createFolder: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockImplementation(async (path: string) => {
      const File = TFile as unknown as new (path: string) => InstanceType<typeof TFile>;
      files.set(path, new File(path));
    }),
  };
  return vault as unknown as Vault;
}
