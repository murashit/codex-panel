export const THREAD_STREAM_CONTENT_RENDERED_EVENT = "codex-panel:thread-stream-content-rendered";

export function notifyThreadStreamContentRendered(element: HTMLElement): void {
  element.dispatchEvent(new Event(THREAD_STREAM_CONTENT_RENDERED_EVENT, { bubbles: true }));
}
