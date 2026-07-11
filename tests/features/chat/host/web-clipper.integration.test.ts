// @vitest-environment jsdom

import type { Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { ComposerInputSnapshot } from "../../../../src/features/chat/application/composer/input-snapshot";

const mocks = vi.hoisted(() => ({
  requestUrl: vi.fn(),
}));

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  return {
    ...actual,
    requestUrl: mocks.requestUrl,
  };
});

const { TFile } = await import("obsidian");
const { createVaultWebClipper } = await import("../../../../src/features/chat/host/obsidian/web-clipper.obsidian");

describe("vault web clipper parser integration", () => {
  it("extracts article HTML with Defuddle and saves it as Markdown", async () => {
    mocks.requestUrl.mockResolvedValue({
      text: `<!doctype html>
        <html>
          <head><title>Integration Article</title></head>
          <body>
            <nav>Navigation that should not be clipped</nav>
            <main>
              <article>
                <h1>Parser contract heading</h1>
                <p>This readable paragraph exercises the real Defuddle full browser bundle.</p>
                <p>A second paragraph makes the article content unambiguous.</p>
              </article>
            </main>
          </body>
        </html>`,
    });
    const { vault, createdContent } = memoryVault();

    const result = await createVaultWebClipper({
      vault,
      settings: () => ({ clipFolder: "Clips", clipFilenameTemplate: "{{title}}.md", clipTags: "" }),
      prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
      viewWindow: () => window,
      now: () => new Date("2026-07-10T00:00:00.000Z"),
    }).clipUrl("https://example.com/article", "", {} as ComposerInputSnapshot);

    const markdown = createdContent.get("Clips/Integration Article.md");
    expect(markdown).toContain("## Parser contract heading");
    expect(markdown).toContain("This readable paragraph exercises the real Defuddle full browser bundle.");
    expect(markdown).not.toContain("<article");
    expect(markdown).not.toContain("Navigation that should not be clipped");
    expect(result?.text).toBe("[[Clips/Integration Article.md]]");
  });

  it("preserves full-parser Markdown features required by the clip contract", async () => {
    mocks.requestUrl.mockResolvedValue({
      text: `<!doctype html><html><head><title>Rich Article</title></head><body><article>
        <h1>Rich heading</h1><p>Formula <math><mi>x</mi></math></p>
        <p>See the note<sup><a href="#fn-1">1</a></sup>.</p>
        <blockquote class="callout"><p>Obsidian callout</p></blockquote>
        <pre><code>const value = 1;</code></pre>
        <ol><li id="fn-1">Footnote detail</li></ol>
      </article></body></html>`,
    });
    const { vault, createdContent } = memoryVault();

    await createVaultWebClipper({
      vault,
      settings: () => ({ clipFolder: "Clips", clipFilenameTemplate: "{{title}}.md", clipTags: "" }),
      prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
      viewWindow: () => window,
      now: () => new Date("2026-07-10T00:00:00.000Z"),
    }).clipUrl("https://example.com/rich", "", {} as ComposerInputSnapshot);

    const markdown = createdContent.get("Clips/Rich Article.md") ?? "";
    expect(markdown).toContain("Rich heading");
    expect(markdown).toMatch(/\$|\\frac|math/);
    expect(markdown).toContain("Footnote detail");
    expect(markdown).toContain("```\nconst value = 1;\n```");
  });
});

function memoryVault(): { vault: Vault; createdContent: Map<string, string> } {
  const files = new Map<string, InstanceType<typeof TFile>>();
  const createdContent = new Map<string, string>();
  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
    createFolder: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockImplementation(async (path: string, content: string) => {
      const File = TFile as unknown as new (path: string) => InstanceType<typeof TFile>;
      files.set(path, new File(path));
      createdContent.set(path, content);
    }),
  };
  return { vault: vault as unknown as Vault, createdContent };
}
