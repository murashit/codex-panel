export interface ComposerSelection {
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly direction: "forward" | "backward" | "none";
}

export function collapsedComposerSelection(value: string, cursor: number): ComposerSelection {
  return { value, start: cursor, end: cursor, direction: "none" };
}
