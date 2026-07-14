import Defuddle from "defuddle";
import { htmlToMarkdown, requestUrl } from "obsidian";

import type { CodexInput } from "../../../../domain/chat/input";
import { codexTextInputWithAttachments } from "../../../../domain/chat/input";
import type { ComposerInputSnapshot } from "../../application/composer/input-snapshot";
import { WEB_CONTEXT_KEY } from "../../domain/thread-stream/format/context-attachments";

export interface WebUrlInput {
  text: string;
  input: CodexInput;
}

interface WebContextReaderOptions {
  prepareInput: (text: string, snapshot: ComposerInputSnapshot) => { text: string; input: CodexInput };
  viewWindow: () => Window | null;
}

type DomParserWindow = Window & { DOMParser: typeof DOMParser };

export function createWebContextReader(options: WebContextReaderOptions) {
  return {
    readUrl: (url: string, message: string, inputSnapshot: ComposerInputSnapshot): Promise<WebUrlInput> =>
      readUrlToInput(options, url, message, inputSnapshot),
  };
}

async function readUrlToInput(
  options: WebContextReaderOptions,
  url: string,
  message: string,
  inputSnapshot: ComposerInputSnapshot,
): Promise<WebUrlInput> {
  const parsedUrl = normalizedHttpUrl(url);
  if (!parsedUrl) throw new Error(`Unsupported web URL: ${url}`);

  const page = await fetchWebPage(options, parsedUrl);
  const content = htmlToMarkdown(page.content).trim();
  if (!content) throw new Error(`No readable web content found for ${parsedUrl}`);

  const messageInput = options.prepareInput(message.trim(), inputSnapshot);
  const text = [parsedUrl, messageInput.text].filter(Boolean).join(" ");
  const context = webContextValue(parsedUrl, page.title, content);
  return {
    text,
    input: codexTextInputWithAttachments(text, [
      ...messageInput.input,
      { type: "additionalContext", key: WEB_CONTEXT_KEY, kind: "untrusted", value: context },
    ]),
  };
}

async function fetchWebPage(options: WebContextReaderOptions, url: string): Promise<{ title: string; content: string }> {
  const response = await requestUrl({ url, method: "GET", throw: false });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Web request failed for ${url} (HTTP ${String(response.status)}).`);
  }
  const viewWindow = options.viewWindow() as DomParserWindow | null;
  const Parser = viewWindow?.DOMParser ?? DOMParser;
  const document = new Parser().parseFromString(response.text, "text/html");
  const result = new Defuddle(document, { url, useAsync: false }).parse();
  return { title: result.title, content: result.content };
}

function webContextValue(url: string, title: string, content: string): string {
  return [
    "Web page context for the current user input:",
    `Source: ${url}`,
    ...(title.trim() ? [`Title: ${title.trim()}`] : []),
    "",
    content,
  ].join("\n");
}

function normalizedHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
