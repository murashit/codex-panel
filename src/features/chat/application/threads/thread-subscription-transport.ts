export interface ThreadSubscriptionTransport {
  unsubscribeThread(threadId: string): Promise<boolean>;
}
