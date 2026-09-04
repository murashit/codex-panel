import type { Thread } from "./model";
import { threadCommandDisplayTitle } from "./title";

const CODEX_THREAD_LINK_PREFIX = "codex://threads/";
const MAX_THREAD_ID_LENGTH = 160;

function codexThreadHref(threadId: string): string {
  return `${CODEX_THREAD_LINK_PREFIX}${encodeURIComponent(threadId)}`;
}

export function codexThreadIdFromHref(href: string): string | null {
  if (!href.startsWith(CODEX_THREAD_LINK_PREFIX)) return null;
  const encoded = href.slice(CODEX_THREAD_LINK_PREFIX.length);
  if (!encoded || encoded.includes("/") || encoded.includes("?") || encoded.includes("#")) return null;
  try {
    const threadId = decodeURIComponent(encoded);
    return threadId.length <= MAX_THREAD_ID_LENGTH ? threadId : null;
  } catch {
    return null;
  }
}

export function threadReferenceMarkdown(thread: Thread): string {
  return `[${markdownLinkLabel(threadCommandDisplayTitle(thread))}](${codexThreadHref(thread.id)})`;
}

function markdownLinkLabel(value: string): string {
  return value.replace(/[\\[\]]/g, "\\$&");
}
