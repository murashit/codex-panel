export const STATUS_COMPACTION_REQUESTED = "Compaction requested.";
export const STATUS_ROLLBACK_STARTING = "Rolling back latest turn...";
export const STATUS_ROLLBACK_COMPLETE = "Rolled back latest turn.";
export const STATUS_ROLLBACK_FAILED = "Rollback failed.";
export const STATUS_THREAD_READY_TO_RESUME = "Thread ready to resume.";

export function noActiveThreadToCompactMessage(): string {
  return "No active thread to compact.";
}

export function noActiveThreadToForkMessage(): string {
  return "No active thread to fork.";
}

export function noActiveThreadToRollbackMessage(): string {
  return "No active thread to roll back.";
}

export function finishBeforeSwitchingThreadsMessage(): string {
  return "Finish or interrupt the current turn before switching threads.";
}

export function finishBeforeArchivingThreadsMessage(): string {
  return "Finish or interrupt the current turn before archiving threads.";
}

export function finishBeforeForkingThreadsMessage(): string {
  return "Finish or interrupt the current turn before forking threads.";
}

export function selectedTurnNotFoundForForkMessage(): string {
  return "Could not find the selected turn to fork.";
}

export function forkNameCopyFailedMessage(threadId: string, message: string): string {
  return `Forked thread ${threadId}, but could not copy the source thread name: ${message}`;
}

export function archivedSourceOpenForkFailedMessage(sourceThreadId: string, forkedThreadId: string, message: string): string {
  return `Archived thread ${sourceThreadId}, but could not open forked thread ${forkedThreadId}: ${message}`;
}

export function openForkInNewPanelFailedMessage(forkedThreadId: string, message: string): string {
  return `Forked thread ${forkedThreadId}, but could not open it in a new panel: ${message}`;
}

export function interruptBeforeRollbackMessage(): string {
  return "Interrupt the current turn before rolling back.";
}

export function noCompletedTurnToRollbackMessage(): string {
  return "No completed turn to roll back.";
}

export function rollbackCompletedMessage(): string {
  return "Rolled back the latest turn. Local file changes were not reverted.";
}

export function resumedThreadMessage(threadId: string): string {
  return `Resumed thread ${threadId}`;
}

export function emptyGoalObjectiveMessage(): string {
  return "Goal objective cannot be empty.";
}
