import Defuddle from "defuddle";
import { htmlToMarkdown, type RequestUrlResponse, requestUrl } from "obsidian";

import type { CodexInput } from "../../../../domain/turns/input";
import { codexTextInputWithAttachments } from "../../../../domain/turns/input";
import type { ComposerInputSnapshot } from "../../application/composer/input-snapshot";
import { normalizedHttpUrl } from "../../application/submission/web-submission";
import { WEB_CONTEXT_KEY } from "../../domain/thread-stream/format/context-attachments";

export interface WebUrlInput {
  text: string;
  input: CodexInput;
}

interface WebContextReaderOptions {
  prepareInput: (text: string, snapshot: ComposerInputSnapshot) => { text: string; input: CodexInput };
  viewWindow: () => Window | null;
  requestTimeoutMs?: number;
  isCurrent?: () => boolean;
}

type DomParserWindow = Window & { DOMParser: typeof DOMParser };

export async function readWebUrl(
  options: WebContextReaderOptions,
  url: string,
  message: string,
  inputSnapshot: ComposerInputSnapshot,
): Promise<WebUrlInput> {
  const parsedUrl = normalizedHttpUrl(url);
  if (!parsedUrl) throw new Error(`Unsupported web URL: ${url}`);
  assertCurrentWebImport(options);

  const page = await fetchWebPage(options, parsedUrl);
  const content = htmlToMarkdown(page.content).trim();
  assertCurrentWebImport(options);
  if (!content) throw new Error(`No readable web content found for ${parsedUrl}`);

  const messageInput = options.prepareInput(message.trim(), inputSnapshot);
  const text = [parsedUrl, messageInput.text].filter(Boolean).join(" ");
  const context = webContextValue(parsedUrl, page.title, content);
  return {
    text,
    input: codexTextInputWithAttachments(text, [
      { type: "additionalContext", key: WEB_CONTEXT_KEY, kind: "untrusted", value: context },
      ...messageInput.input,
    ]),
  };
}

async function fetchWebPage(options: WebContextReaderOptions, url: string): Promise<{ title: string; content: string }> {
  const response = await requestWebPage(options, url, options.requestTimeoutMs ?? 30_000);
  assertCurrentWebImport(options);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Web request failed for ${url} (HTTP ${String(response.status)}).`);
  }
  const viewWindow = options.viewWindow() as DomParserWindow | null;
  const Parser = viewWindow?.DOMParser ?? DOMParser;
  const document = new Parser().parseFromString(response.text, "text/html");
  const result = new Defuddle(document, { url, useAsync: false }).parse();
  return { title: result.title, content: result.content };
}

function assertCurrentWebImport(options: WebContextReaderOptions): void {
  if (options.isCurrent?.() === false) throw new Error("Web import cancelled.");
}

function requestWebPage(options: WebContextReaderOptions, url: string, timeoutMs: number): Promise<RequestUrlResponse> {
  const timerHost = options.viewWindow();
  if (!timerHost) throw new Error(`Web request unavailable for ${url}.`);
  return new Promise((resolve, reject) => {
    const timeout = timerHost.setTimeout(() => {
      reject(new Error(`Web request timed out for ${url}.`));
    }, timeoutMs);
    void requestUrl({ url, method: "GET", throw: false }).then(
      (response) => {
        timerHost.clearTimeout(timeout);
        resolve(response);
      },
      (error: unknown) => {
        timerHost.clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
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
