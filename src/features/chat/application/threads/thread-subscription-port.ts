export interface ThreadSubscriptionPort {
  unsubscribeThread(threadId: string): Promise<boolean>;
}
