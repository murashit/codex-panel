export const MESSAGE_CONTENT_RENDERED_EVENT = "codex-panel:message-content-rendered";

export function notifyMessageContentRendered(element: HTMLElement): void {
  element.dispatchEvent(new Event(MESSAGE_CONTENT_RENDERED_EVENT, { bubbles: true }));
}
