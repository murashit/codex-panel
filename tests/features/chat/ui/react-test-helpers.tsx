import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

export interface ReactTestRoot {
  render(node: ReactNode): void;
  unmount(): void;
}

export function createReactTestRoot(container: HTMLElement): ReactTestRoot {
  const root = createRoot(container);
  return {
    render(node) {
      act(() => {
        root.render(node);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}
