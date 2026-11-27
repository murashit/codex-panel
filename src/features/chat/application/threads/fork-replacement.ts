import { errorMessage } from "../../../../domain/text/error-message";
import type { BeginThreadReplacement } from "../../../../domain/threads/catalog";
import type { ForkReplacement } from "./fork-draft";

export interface ForkReplacementEffects {
  beginPublication: BeginThreadReplacement;
  latestTurnId(threadId: string): Promise<string | null>;
  archiveSource(threadId: string, saveMarkdown: boolean): Promise<boolean>;
  notify(message: string): void;
}

export async function archiveForkSource(effects: ForkReplacementEffects, replacement: ForkReplacement): Promise<boolean> {
  try {
    if ((await effects.latestTurnId(replacement.sourceThreadId)) !== replacement.sourceLatestTurnId) {
      effects.notify("The fork was started. The source changed since you prepared it, so it was left unarchived.");
      return false;
    }
    const archived = await effects.archiveSource(replacement.sourceThreadId, replacement.saveMarkdown);
    if (!archived) effects.notify("The fork was started, but the source could not be archived.");
    return archived;
  } catch (error) {
    effects.notify(`The fork was started, but the source could not be archived: ${errorMessage(error)}`);
    return false;
  }
}
