// @vitest-environment jsdom

import * as obsidian from "obsidian";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { CodexInput } from "../../../../../src/domain/turns/input";
import type { ComposerInputSnapshot } from "../../../../../src/features/chat/application/composer/input-snapshot";
import { readWebUrl } from "../../../../../src/features/chat/host/obsidian/web-context.obsidian";
import { deferred } from "../../../../support/async";

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
    const inputSnapshot = { sourcePath: "source.md" } as ComposerInputSnapshot;
    const messageInput = [
      { type: "text" as const, text: "Summarize [[Notes/Alpha.md]] [[Files/Sketch.png]]" },
      { type: "fileReference" as const, name: "Alpha", path: "Notes/Alpha.md" },
      { type: "additionalContext" as const, key: "codex_panel_obsidian_context", kind: "untrusted" as const, value: "selection" },
      { type: "fileReference" as const, name: "Sketch.png", path: "Files/Sketch.png" },
      { type: "localImage" as const, path: "Files/Sketch.png" },
    ] satisfies CodexInput;
    const prepareInput = vi.fn(() => ({
      text: "Summarize [[Notes/Alpha.md]] [[Files/Sketch.png]]",
      input: messageInput,
    }));

    const result = await readWebUrl(
      {
        prepareInput,
        viewWindow: () => window,
      },
      "https://example.com/article",
      "  Summarize [[Alpha]] [[Files/Sketch.png]]  ",
      inputSnapshot,
    );

    expect(requestUrl).toHaveBeenCalledWith({ url: "https://example.com/article", method: "GET", throw: false });
    expect(htmlToMarkdown).toHaveBeenCalledWith(expect.stringContaining("Readable article"));
    expect(prepareInput).toHaveBeenCalledWith("Summarize [[Alpha]] [[Files/Sketch.png]]", inputSnapshot);
    expect(result).toEqual({
      text: "https://example.com/article Summarize [[Notes/Alpha.md]] [[Files/Sketch.png]]",
      input: [
        { type: "text", text: "https://example.com/article Summarize [[Notes/Alpha.md]] [[Files/Sketch.png]]" },
        {
          type: "additionalContext",
          key: "codex_panel_web_context",
          kind: "untrusted",
          value: "Web page context for the current user input:\nSource: https://example.com/article\nTitle: Example\n\nReadable article",
        },
        { type: "fileReference", name: "Alpha", path: "Notes/Alpha.md" },
        { type: "additionalContext", key: "codex_panel_obsidian_context", kind: "untrusted", value: "selection" },
        { type: "fileReference", name: "Sketch.png", path: "Files/Sketch.png" },
        { type: "localImage", path: "Files/Sketch.png" },
      ],
    });
  });

  it("rejects HTTP error responses", async () => {
    requestUrl.mockResolvedValue({ headers: {}, json: {}, arrayBuffer: new ArrayBuffer(0), status: 400, text: "Error" });

    await expect(
      readWebUrl(
        {
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: () => window,
        },
        "https://example.com/article",
        "",
        {} as ComposerInputSnapshot,
      ),
    ).rejects.toThrow("Web request failed for https://example.com/article (HTTP 400).");

    expect(htmlToMarkdown).not.toHaveBeenCalled();
  });

  it("rejects empty converted content", async () => {
    htmlToMarkdown.mockReturnValue("  \n");

    await expect(
      readWebUrl(
        {
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: () => window,
        },
        "https://example.com/article",
        "",
        {} as ComposerInputSnapshot,
      ),
    ).rejects.toThrow("No readable web content found for https://example.com/article");
  });

  it("rejects non-HTTP URLs before fetching", async () => {
    await expect(
      readWebUrl(
        {
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: () => window,
        },
        "file:///tmp/article.html",
        "",
        {} as ComposerInputSnapshot,
      ),
    ).rejects.toThrow("Unsupported web URL: file:///tmp/article.html");

    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("rejects URLs containing credentials before fetching", async () => {
    await expect(
      readWebUrl(
        {
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: () => window,
        },
        "https://user:secret@example.com/article",
        "",
        {} as ComposerInputSnapshot,
      ),
    ).rejects.toThrow("Unsupported web URL: https://user:secret@example.com/article");

    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("discards the response when the import is cancelled", async () => {
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    await expect(
      readWebUrl(
        {
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: () => window,
          isCurrent,
        },
        "https://example.com/article",
        "",
        {} as ComposerInputSnapshot,
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
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: () => window,
          requestTimeoutMs: 10,
        },
        "https://example.com/article",
        "",
        {} as ComposerInputSnapshot,
      );
      const rejected = expect(reading).rejects.toThrow("Web request timed out for https://example.com/article.");

      await vi.advanceTimersByTimeAsync(10);

      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
