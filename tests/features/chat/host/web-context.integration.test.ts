// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { ComposerInputSnapshot } from "../../../../src/features/chat/application/composer/input-snapshot";

const mocks = vi.hoisted(() => ({
  htmlToMarkdown: vi.fn(),
  requestUrl: vi.fn(),
}));

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  return {
    ...actual,
    htmlToMarkdown: mocks.htmlToMarkdown,
    requestUrl: mocks.requestUrl,
  };
});

const { createWebContextReader } = await import("../../../../src/features/chat/host/obsidian/web-context.obsidian");

describe("web context parser integration", () => {
  it("extracts article HTML with the Defuddle core bundle before Markdown conversion", async () => {
    mocks.requestUrl.mockResolvedValue({
      status: 200,
      text: `<!doctype html>
        <html>
          <head><title>Integration Article</title></head>
          <body>
            <nav>Navigation that should not be included</nav>
            <main>
              <article>
                <h1>Parser contract heading</h1>
                <p>This readable paragraph exercises the real Defuddle core browser bundle.</p>
                <p>A second paragraph makes the article content unambiguous.</p>
              </article>
            </main>
          </body>
        </html>`,
    });
    mocks.htmlToMarkdown.mockReturnValue("## Parser contract heading\n\nReadable article");

    const result = await createWebContextReader({
      prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
      viewWindow: () => window,
    }).readUrl("https://example.com/article", "", {} as ComposerInputSnapshot);

    const extractedHtml = mocks.htmlToMarkdown.mock.calls[0]?.[0] as string;
    expect(extractedHtml).toContain("This readable paragraph exercises the real Defuddle core browser bundle.");
    expect(extractedHtml).not.toContain("Navigation that should not be included");
    expect(result.text).toBe("https://example.com/article");
    expect(result.input).toContainEqual({
      type: "additionalContext",
      key: "codex_panel_web_context",
      kind: "untrusted",
      value:
        "Web page context for the current user input:\nSource: https://example.com/article\nTitle: Integration Article\n\n## Parser contract heading\n\nReadable article",
    });
  });
});
