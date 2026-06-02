import { render, type ComponentChild as UiNode } from "preact";

const roots = new WeakSet<HTMLElement>();
const guardedContainers = new WeakSet<HTMLElement>();
const internalMutationContainers = new WeakSet<HTMLElement>();

export function renderUiRoot(container: HTMLElement, node: UiNode): void {
  prepareRootContainer(container);
  internalMutationContainers.add(container);
  try {
    render(node, container);
  } finally {
    internalMutationContainers.delete(container);
  }
}

export function unmountUiRoot(container: HTMLElement | null): void {
  if (!container) return;
  if (!roots.has(container)) return;
  internalMutationContainers.add(container);
  try {
    render(null, container);
  } finally {
    internalMutationContainers.delete(container);
    roots.delete(container);
  }
}

function prepareRootContainer(container: HTMLElement): void {
  if (roots.has(container)) return;
  guardExternalEmpty(container);
  roots.add(container);
}

function guardExternalEmpty(container: HTMLElement): void {
  if (guardedContainers.has(container)) return;
  guardedContainers.add(container);
  const replaceChildren = container.replaceChildren.bind(container);
  container.replaceChildren = (...nodes) => {
    if (!internalMutationContainers.has(container)) {
      unmountUiRoot(container);
    }
    replaceChildren(...nodes);
  };
}
