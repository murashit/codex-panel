import Defuddle from "defuddle/full";
import { requestUrl, TFile, type Vault } from "obsidian";

import type { CodexInput } from "../../../../domain/chat/input";
import { codexTextInputWithAttachments } from "../../../../domain/chat/input";
import type { CodexPanelSettings } from "../../../../settings/model";
import { createObsidianVaultMarkdownDestination } from "../../../../shared/obsidian/vault-write-destination.obsidian";
import type { ComposerInputSnapshot } from "../../application/composer/input-snapshot";
import { saveWebClipMarkdown } from "../../application/web-clipping/web-clip";
import { displayNameForFile } from "./vault-note-links.obsidian";

export interface WebClipInput {
  text: string;
  input: CodexInput;
}

interface VaultWebClipperOptions {
  vault: Vault;
  settings: () => Pick<CodexPanelSettings, "clipFolder" | "clipFilenameTemplate" | "clipTags">;
  prepareInput: (text: string, snapshot: ComposerInputSnapshot) => { text: string; input: CodexInput };
  viewWindow: () => Window | null;
  now?: () => Date;
}

interface DefuddleResult {
  title: string;
  content: string;
  site?: string | null;
  domain?: string | null;
}

type DomParserWindow = Window & { DOMParser: typeof DOMParser };

export function createVaultWebClipper(options: VaultWebClipperOptions) {
  return {
    clipUrl: (url: string, message: string, inputSnapshot: ComposerInputSnapshot): Promise<WebClipInput | null> =>
      clipUrlToInput(options, url, message, inputSnapshot),
  };
}

async function clipUrlToInput(
  options: VaultWebClipperOptions,
  url: string,
  message: string,
  inputSnapshot: ComposerInputSnapshot,
): Promise<WebClipInput | null> {
  const parsedUrl = normalizedHttpUrl(url);
  if (!parsedUrl) throw new Error(`Unsupported clip URL: ${url}`);

  const result = await defuddleUrl(options, parsedUrl);
  const content = result.content.trim();
  if (!content) throw new Error(`No readable content found for ${parsedUrl}`);

  const destination = createObsidianVaultMarkdownDestination(options.vault);
  const page = {
    url: parsedUrl,
    title: result.title,
    content,
    ...(result.site !== undefined ? { site: result.site } : {}),
    ...(result.domain !== undefined ? { domain: result.domain } : {}),
  };
  const saved = await saveWebClipMarkdown(page, options.settings(), destination, options.now?.() ?? new Date());
  const file = options.vault.getAbstractFileByPath(saved.path);
  const name = file instanceof TFile ? displayNameForFile(file) : saved.path;
  const messageInput = options.prepareInput(message.trim(), inputSnapshot);
  const text = [saved.wikilink, messageInput.text].filter(Boolean).join(" ");
  return {
    text,
    input: codexTextInputWithAttachments(text, [{ type: "mention", name, path: saved.path }, ...messageInput.input]),
  };
}

async function defuddleUrl(options: VaultWebClipperOptions, url: string): Promise<DefuddleResult> {
  const response = await requestUrl({ url, method: "GET" });
  const html = response.text;
  const viewWindow = options.viewWindow() as DomParserWindow | null;
  const Parser = viewWindow?.DOMParser ?? DOMParser;
  const document = new Parser().parseFromString(html, "text/html");
  const result = new Defuddle(document, { url, markdown: true, useAsync: false }).parse();
  return {
    title: result.title,
    content: result.contentMarkdown ?? result.content,
    site: result.site,
    domain: result.domain,
  };
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
