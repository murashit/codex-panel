import type { ChatState } from "../state/model";
import { canSwitchToThread } from "./thread-switching";

export interface ActiveChatResume {
  readonly threadId: string | null;
}

export class ChatResumeWorkTracker {
  private current: ActiveChatResume | null = null;

  begin(threadId: string | null): ActiveChatResume {
    const resume = { threadId };
    this.current = resume;
    return resume;
  }

  canCommit(resume: ActiveChatResume, state: ChatState): boolean {
    return this.isCurrent(resume) && canSwitchToThread(state, resume.threadId);
  }

  invalidate(): void {
    this.current = null;
  }

  isCurrent(resume: ActiveChatResume): boolean {
    return this.current === resume;
  }
}
