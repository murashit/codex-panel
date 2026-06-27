export function focusToolbarRenameInput(input: HTMLInputElement | null): void {
  if (!input) return;
  if (input.ownerDocument.activeElement === input) return;
  input.focus();
  input.select();
}
