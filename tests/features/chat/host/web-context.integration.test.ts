// @vitest-environment jsdom

import * as obsidian from "obsidian";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import type { ComposerInputSnapshot } from "../../../../src/features/chat/application/composer/input-snapshot";
import { readWebUrl } from "../../../../src/features/chat/host/obsidian/web-context.obsidian";

let requestUrl: MockInstance<typeof obsidian.requestUrl>;
let htmlToMarkdown: MockInstance<typeof obsidian.htmlToMarkdown>;

beforeEach(() => {
  requestUrl = vi.spyOn(obsidian, "requestUrl");
  htmlToMarkdown = vi.spyOn(obsidian, "htmlToMarkdown");
});
afterEach(() => vi.restoreAllMocks());

describe("web context parser integration", () => {
  it("extracts article HTML with the Defuddle core bundle before Markdown conversion", async () => {
    requestUrl.mockResolvedValue({
      headers: {},
      json: {},
      arrayBuffer: new ArrayBuffer(0),
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
    htmlToMarkdown.mockReturnValue("## Parser contract heading\n\nReadable article");

    const result = await readWebUrl(
      {
        prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
        viewWindow: () => window,
      },
      "https://example.com/article",
      "",
      {} as ComposerInputSnapshot,
    );

    const extractedHtml = htmlToMarkdown.mock.calls[0]?.[0] as string;
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
