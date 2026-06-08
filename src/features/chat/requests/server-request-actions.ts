import type { AppServerClient } from "../../../app-server/client";

type RespondRequestId = Parameters<AppServerClient["respondToServerRequest"]>[0];
type RejectRequestId = Parameters<AppServerClient["rejectServerRequest"]>[0];

export interface ServerRequestActionsHost {
  currentClient: () => AppServerClient | null;
}

export interface ServerRequestActions {
  respond: (requestId: RespondRequestId, result: unknown) => boolean;
  reject: (requestId: RejectRequestId, code: number, message: string) => boolean;
}

export function createServerRequestActions(host: ServerRequestActionsHost): ServerRequestActions {
  return {
    respond: (requestId, result) => respondToServerRequest(host, requestId, result),
    reject: (requestId, code, message) => rejectServerRequest(host, requestId, code, message),
  };
}

function respondToServerRequest(host: ServerRequestActionsHost, requestId: RespondRequestId, result: unknown): boolean {
  try {
    const client = host.currentClient();
    client?.respondToServerRequest(requestId, result);
    return Boolean(client);
  } catch {
    return false;
  }
}

function rejectServerRequest(host: ServerRequestActionsHost, requestId: RejectRequestId, code: number, message: string): boolean {
  try {
    const client = host.currentClient();
    client?.rejectServerRequest(requestId, code, message);
    return Boolean(client);
  } catch {
    return false;
  }
}
