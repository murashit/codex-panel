export function observeElementResize(element: HTMLElement, onResize: () => void): () => void {
  const ResizeObserverCtor = (element.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  if (!ResizeObserverCtor) return () => undefined;
  const observer = new ResizeObserverCtor(onResize);
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
}
