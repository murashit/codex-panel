export type ChatResumeLifecycleState = { kind: "idle" } | { kind: "resuming"; threadId: string | null };
export type ActiveChatResume = Extract<ChatResumeLifecycleState, { kind: "resuming" }>;
type ChatResumeLifecycleEvent = { type: "started"; resume: ActiveChatResume } | { type: "invalidated" };

export class ChatResumeWorkTracker {
  private state: ChatResumeLifecycleState = { kind: "idle" };

  begin(threadId: string | null): ActiveChatResume {
    const resume: ActiveChatResume = { kind: "resuming", threadId };
    this.state = transitionChatResumeLifecycle(this.state, { type: "started", resume });
    return resume;
  }

  invalidate(): void {
    this.state = transitionChatResumeLifecycle(this.state, { type: "invalidated" });
  }

  isStale(resume: ActiveChatResume): boolean {
    return this.state !== resume;
  }

  isCurrent(resume: ActiveChatResume): boolean {
    return this.state === resume;
  }
}

function transitionChatResumeLifecycle(state: ChatResumeLifecycleState, event: ChatResumeLifecycleEvent): ChatResumeLifecycleState {
  switch (event.type) {
    case "started":
      return event.resume;
    case "invalidated":
      return state.kind === "idle" ? state : { kind: "idle" };
  }
}
