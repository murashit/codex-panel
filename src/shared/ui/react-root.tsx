import type { ReactNode } from "preact/compat";
import { flushSync } from "preact/compat";
import { createRoot } from "preact/compat/client";

type Root = ReturnType<typeof createRoot>;

const roots = new WeakMap<HTMLElement, Root>();
const guardedContainers = new WeakSet<HTMLElement>();
const internalMutationContainers = new WeakSet<HTMLElement>();

export function renderReactRoot(container: HTMLElement, node: ReactNode): void {
  const root = rootForContainer(container);
  internalMutationContainers.add(container);
  try {
    flushSync(() => {
      root.render(node);
    });
  } finally {
    internalMutationContainers.delete(container);
  }
}

export function unmountReactRoot(container: HTMLElement | null): void {
  if (!container) return;
  const root = roots.get(container);
  if (!root) return;
  internalMutationContainers.add(container);
  try {
    flushSync(() => {
      root.unmount();
    });
  } finally {
    internalMutationContainers.delete(container);
    roots.delete(container);
  }
}

function rootForContainer(container: HTMLElement): Root {
  const existing = roots.get(container);
  if (existing) return existing;
  guardExternalEmpty(container);
  const root = createRoot(container);
  roots.set(container, root);
  return root;
}

function guardExternalEmpty(container: HTMLElement): void {
  if (guardedContainers.has(container)) return;
  guardedContainers.add(container);
  const replaceChildren = container.replaceChildren.bind(container);
  container.replaceChildren = (...nodes) => {
    if (!internalMutationContainers.has(container)) {
      unmountReactRoot(container);
    }
    replaceChildren(...nodes);
  };
}
