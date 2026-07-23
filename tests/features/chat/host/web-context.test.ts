import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodexInput } from "../../../../src/domain/chat/input";
import type { ComposerInputSnapshot } from "../../../../src/features/chat/application/composer/input-snapshot";
import { deferred } from "../../../support/async";

const mocks = vi.hoisted(() => ({
  defuddleParse: vi.fn(),
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

vi.mock("defuddle", () => ({
  default: vi.fn().mockImplementation(function MockDefuddle() {
    return { parse: mocks.defuddleParse };
  }),
}));

const { readWebUrl } = await import("../../../../src/features/chat/host/obsidian/web-context.obsidian");

describe("web context reader", () => {
  beforeEach(() => {
    mocks.requestUrl.mockReset();
    mocks.defuddleParse.mockReset();
    mocks.htmlToMarkdown.mockReset();
    mocks.requestUrl.mockResolvedValue({ status: 200, text: "<html><body>Article</body></html>" });
    mocks.defuddleParse.mockReturnValue({ title: "Example", content: "<article>Readable article</article>" });
    mocks.htmlToMarkdown.mockReturnValue("Readable article");
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
        viewWindow: fakeDomWindow,
      },
      "https://example.com/article",
      "  Summarize [[Alpha]] [[Files/Sketch.png]]  ",
      inputSnapshot,
    );

    expect(mocks.requestUrl).toHaveBeenCalledWith({ url: "https://example.com/article", method: "GET", throw: false });
    expect(mocks.htmlToMarkdown).toHaveBeenCalledWith("<article>Readable article</article>");
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

  it.each([400, 500])("rejects HTTP %i responses", async (status) => {
    mocks.requestUrl.mockResolvedValue({ status, text: "Error" });

    await expect(
      readWebUrl(
        {
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: fakeDomWindow,
        },
        "https://example.com/article",
        "",
        {} as ComposerInputSnapshot,
      ),
    ).rejects.toThrow(`Web request failed for https://example.com/article (HTTP ${status}).`);

    expect(mocks.defuddleParse).not.toHaveBeenCalled();
  });

  it("rejects empty converted content", async () => {
    mocks.htmlToMarkdown.mockReturnValue("  \n");

    await expect(
      readWebUrl(
        {
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: fakeDomWindow,
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
          viewWindow: fakeDomWindow,
        },
        "file:///tmp/article.html",
        "",
        {} as ComposerInputSnapshot,
      ),
    ).rejects.toThrow("Unsupported web URL: file:///tmp/article.html");

    expect(mocks.requestUrl).not.toHaveBeenCalled();
  });

  it("rejects URLs containing credentials before fetching", async () => {
    await expect(
      readWebUrl(
        {
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: fakeDomWindow,
        },
        "https://user:secret@example.com/article",
        "",
        {} as ComposerInputSnapshot,
      ),
    ).rejects.toThrow("Unsupported web URL: https://user:secret@example.com/article");

    expect(mocks.requestUrl).not.toHaveBeenCalled();
  });

  it("stops before DOM parsing when the import is cancelled after the response", async () => {
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    await expect(
      readWebUrl(
        {
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: fakeDomWindow,
          isCurrent,
        },
        "https://example.com/article",
        "",
        {} as ComposerInputSnapshot,
      ),
    ).rejects.toThrow("Web import cancelled.");

    expect(mocks.defuddleParse).not.toHaveBeenCalled();
    expect(mocks.htmlToMarkdown).not.toHaveBeenCalled();
  });

  it("stops after conversion when the import is cancelled during processing", async () => {
    const prepareInput = vi.fn(() => ({ text: "", input: [{ type: "text" as const, text: "" }] }));
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);

    await expect(
      readWebUrl({ prepareInput, viewWindow: fakeDomWindow, isCurrent }, "https://example.com/article", "", {} as ComposerInputSnapshot),
    ).rejects.toThrow("Web import cancelled.");

    expect(mocks.htmlToMarkdown).toHaveBeenCalledOnce();
    expect(prepareInput).not.toHaveBeenCalled();
  });

  it("rejects web requests that do not respond before the timeout", async () => {
    vi.useFakeTimers();
    try {
      const response = deferred<never>();
      mocks.requestUrl.mockReturnValue(response.promise);
      const reading = readWebUrl(
        {
          prepareInput: () => ({ text: "", input: [{ type: "text", text: "" }] }),
          viewWindow: fakeDomWindow,
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

class FakeDOMParser {
  parseFromString(): Document {
    return {} as Document;
  }
}

function fakeDomWindow(): Window {
  return {
    DOMParser: FakeDOMParser,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  } as unknown as Window;
}
