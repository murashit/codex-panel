export type OrdinaryComposerAction = "send" | "steer" | "interrupt";

// Import cancellation and slash-command execution are handled by their workflows.
export function ordinaryComposerAction(input: {
  canInterrupt: boolean;
  hasDraft: boolean;
  directInputBlocked: boolean;
}): OrdinaryComposerAction {
  if (!input.canInterrupt) return "send";
  return input.hasDraft && !input.directInputBlocked ? "steer" : "interrupt";
}
