import type { AppServerClient } from "../../../../app-server/client";

type RespondRequestId = Parameters<AppServerClient["respondToServerRequest"]>[0];
type RejectRequestId = Parameters<AppServerClient["rejectServerRequest"]>[0];

export interface ServerRequestResponderHost {
  currentClient: () => AppServerClient | null;
}

export function respondToServerRequest(host: ServerRequestResponderHost, requestId: RespondRequestId, result: unknown): boolean {
  try {
    const client = host.currentClient();
    client?.respondToServerRequest(requestId, result);
    return Boolean(client);
  } catch {
    return false;
  }
}

export function rejectServerRequest(host: ServerRequestResponderHost, requestId: RejectRequestId, code: number, message: string): boolean {
  try {
    const client = host.currentClient();
    client?.rejectServerRequest(requestId, code, message);
    return Boolean(client);
  } catch {
    return false;
  }
}
