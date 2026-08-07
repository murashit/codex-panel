import type { ServerNotification } from "../../../app-server/connection/rpc-messages";
import { normalizeExplicitThreadName } from "../../../domain/threads/model";
import type { ThreadFact } from "../workflows/thread-facts";

export function threadFactFromLifecycleNotification(notification: ServerNotification): ThreadFact | null {
  switch (notification.method) {
    case "thread/archived":
      return { type: "thread-archived", threadId: notification.params.threadId };
    case "thread/deleted":
      return { type: "thread-deleted", threadId: notification.params.threadId };
    case "thread/unarchived":
      return { type: "thread-unarchived", threadId: notification.params.threadId };
    case "thread/name/updated":
      return {
        type: "thread-renamed",
        threadId: notification.params.threadId,
        name: normalizeExplicitThreadName(notification.params.threadName),
      };
    default:
      return null;
  }
}
