// @vitest-environment jsdom

import * as obsidian from "obsidian";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { readWebUrl } from "../../../../../src/features/chat/host/obsidian/web-context.obsidian";
import { deferred } from "../../../../support/async";
import { emptyComposerInputSnapshot } from "../../support/composer-input";

let requestUrl: MockInstance<typeof obsidian.requestUrl>;
let htmlToMarkdown: MockInstance<typeof obsidian.htmlToMarkdown>;

beforeEach(() => {
  requestUrl = vi.spyOn(obsidian, "requestUrl");
  htmlToMarkdown = vi.spyOn(obsidian, "htmlToMarkdown");
});
afterEach(() => vi.restoreAllMocks());

describe("web context reader", () => {
  beforeEach(() => {
    requestUrl.mockResolvedValue({
      headers: {},
      json: {},
      arrayBuffer: new ArrayBuffer(0),
      status: 200,
      text: "<html><head><title>Example</title></head><body><article><p>Readable article</p></article></body></html>",
    });
    htmlToMarkdown.mockReturnValue("Readable article");
  });

  it("attaches fetched Markdown as untrusted context while preserving prepared message input", async () => {
    const inputSnapshot = {
      ...emptyComposerInputSnapshot(),
      sourcePath: "source.md",
      attachments: [{ kind: "image" as const, name: "Sketch.png", path: "Files/Sketch.png", marker: "[[Files/Sketch.png]]" }],
    };
    const resolveFileReference = vi.fn((target: string) => (target === "Alpha" ? { name: "Alpha", path: "Notes/Alpha.md" } : null));

    const result = await readWebUrl(
      {
        resolveFileReference,
        viewWindow: () => window,
      },
      "https://example.com/article",
      "  Summarize [[Alpha]] [[Files/Sketch.png]]  ",
      inputSnapshot,
    );

    expect(requestUrl).toHaveBeenCalledWith({ url: "https://example.com/article", method: "GET", throw: false });
    expect(htmlToMarkdown).toHaveBeenCalledWith(expect.stringContaining("Readable article"));
    expect(resolveFileReference).toHaveBeenCalledWith("Alpha", "source.md");
    expect(result).toEqual({
      text: "https://example.com/article Summarize [[Alpha]] [[Files/Sketch.png]]",
      input: [
        { type: "text", text: "https://example.com/article Summarize [[Alpha]] [[Files/Sketch.png]]" },
        {
          type: "additionalContext",
          key: "codex_panel_web_context",
          kind: "untrusted",
          value: "Web page context for the current user input:\nSource: https://example.com/article\nTitle: Example\n\nReadable article",
        },
        { type: "fileReference", name: "Alpha", path: "Notes/Alpha.md" },
        {
          type: "additionalContext",
          key: "codex_panel_obsidian_context",
          kind: "untrusted",
          value: "Obsidian references for the current user input:\n- [[Alpha]] -> Notes/Alpha.md",
        },
        { type: "fileReference", name: "Sketch.png", path: "Files/Sketch.png" },
        { type: "localImage", path: "Files/Sketch.png" },
      ],
    });
  });

  it("rejects HTTP error responses", async () => {
    requestUrl.mockResolvedValue({ headers: {}, json: {}, arrayBuffer: new ArrayBuffer(0), status: 400, text: "Error" });

    await expect(readArticle()).rejects.toThrow("Web request failed for https://example.com/article (HTTP 400).");

    expect(htmlToMarkdown).not.toHaveBeenCalled();
  });

  it("rejects empty converted content", async () => {
    htmlToMarkdown.mockReturnValue("  \n");

    await expect(readArticle()).rejects.toThrow("No readable web content found for https://example.com/article");
  });

  it("rejects non-HTTP URLs before fetching", async () => {
    await expect(
      readWebUrl(
        {
          resolveFileReference: () => null,
          viewWindow: () => window,
        },
        "file:///tmp/article.html",
        "",
        emptyComposerInputSnapshot(),
      ),
    ).rejects.toThrow("Unsupported web URL: file:///tmp/article.html");

    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("rejects URLs containing credentials before fetching", async () => {
    await expect(
      readWebUrl(
        {
          resolveFileReference: () => null,
          viewWindow: () => window,
        },
        "https://user:secret@example.com/article",
        "",
        emptyComposerInputSnapshot(),
      ),
    ).rejects.toThrow("Unsupported web URL: https://user:secret@example.com/article");

    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("discards the response when the import is cancelled", async () => {
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    await expect(
      readWebUrl(
        {
          resolveFileReference: () => null,
          viewWindow: () => window,
          isCurrent,
        },
        "https://example.com/article",
        "",
        emptyComposerInputSnapshot(),
      ),
    ).rejects.toThrow("Web import cancelled.");

    expect(htmlToMarkdown).not.toHaveBeenCalled();
  });

  it("rejects web requests that do not respond before the timeout", async () => {
    vi.useFakeTimers();
    try {
      const response = deferred<never>();
      requestUrl.mockReturnValue(
        Object.assign(response.promise, { arrayBuffer: response.promise, json: response.promise, text: response.promise }),
      );
      const reading = readWebUrl(
        {
          resolveFileReference: () => null,
          viewWindow: () => window,
          requestTimeoutMs: 10,
        },
        "https://example.com/article",
        "",
        emptyComposerInputSnapshot(),
      );
      await Promise.all([
        expect(reading).rejects.toThrow("Web request timed out for https://example.com/article."),
        vi.advanceTimersByTimeAsync(10),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

function readArticle() {
  return readWebUrl(
    { resolveFileReference: () => null, viewWindow: () => window },
    "https://example.com/article",
    "",
    emptyComposerInputSnapshot(),
  );
}
