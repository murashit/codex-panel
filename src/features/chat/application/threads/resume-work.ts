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

  invalidate(): void {
    this.current = null;
  }

  isCurrent(resume: ActiveChatResume): boolean {
    return this.current === resume;
  }
}
