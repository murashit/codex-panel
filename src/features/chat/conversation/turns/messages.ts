import type { Thread } from "../../../../domain/threads/model";
import { REFERENCED_THREAD_TURN_LIMIT } from "../../../../domain/threads/reference";
import { shortThreadId } from "../../../../utils";

export const STATUS_TURN_RUNNING = "Turn running...";
export const STATUS_INTERRUPT_REQUESTED = "Interrupt requested.";
export const STATUS_STEERED_CURRENT_TURN = "Steered current turn.";

export function turnCompletedStatus(status: string): string {
  return `Turn ${status}.`;
}

export function currentTurnNotSteerableMessage(): string {
  return "Current turn is not steerable yet.";
}

export function currentThreadReferenceMessage(): string {
  return "Use the current thread directly instead of referencing it.";
}

export function referencedThreadStatus(thread: Thread, includedTurns: number): string {
  return `Referencing ${shortThreadId(thread.id)} (${String(includedTurns)}/${String(REFERENCED_THREAD_TURN_LIMIT)} turns).`;
}

export function referencedThreadUnreadableMessage(): string {
  return "Referenced thread has no readable conversation turns.";
}
