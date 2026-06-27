export function listenDomEvent<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): () => void;
export function listenDomEvent<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): () => void;
export function listenDomEvent<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): () => void;
export function listenDomEvent(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): () => void;
export function listenDomEvent(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): () => void {
  target.addEventListener(type, listener, options);
  return () => {
    target.removeEventListener(type, listener, options);
  };
}

export function disposeDomListeners(...dispose: readonly (() => void)[]): () => void {
  return () => {
    for (const item of dispose) item();
  };
}

export function listenOutsideDomEvent<K extends keyof DocumentEventMap>(
  root: HTMLElement,
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): () => void {
  const domWindow = root.ownerDocument.defaultView as (Window & { Node: typeof Node }) | null;
  return listenDomEvent(
    root.ownerDocument,
    type,
    (event) => {
      const target = event.target;
      const targetNode = domWindow && target instanceof domWindow.Node ? target : null;
      if (targetNode && root.contains(targetNode)) return;
      listener(event);
    },
    options,
  );
}

export function listenDomEscapeKey(target: Document, listener: (event: KeyboardEvent) => void): () => void {
  return listenDomEvent(target, "keydown", (event) => {
    if (event.key === "Escape") listener(event);
  });
}
