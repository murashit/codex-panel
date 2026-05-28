import type { AppServerClient } from "../../app-server/client";

type RespondRequestId = Parameters<AppServerClient["respondToServerRequest"]>[0];
type RejectRequestId = Parameters<AppServerClient["rejectServerRequest"]>[0];

export interface ServerRequestResponderHost {
  currentClient: () => AppServerClient | null;
}

export class ServerRequestResponder {
  constructor(private readonly host: ServerRequestResponderHost) {}

  respond(requestId: RespondRequestId, result: unknown): boolean {
    try {
      const client = this.host.currentClient();
      client?.respondToServerRequest(requestId, result);
      return Boolean(client);
    } catch {
      return false;
    }
  }

  reject(requestId: RejectRequestId, code: number, message: string): boolean {
    try {
      const client = this.host.currentClient();
      client?.rejectServerRequest(requestId, code, message);
      return Boolean(client);
    } catch {
      return false;
    }
  }
}
