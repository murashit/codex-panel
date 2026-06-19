import type { ServerRequest } from "../../../../app-server/connection/rpc-messages";
import {
  appServerUserInputRequest,
  appServerUserInputResponse,
  type AppServerUserInputResponse,
} from "../../../../app-server/protocol/server-requests";
import type { PendingUserInput } from "../../domain/pending-requests/model";

export function toPendingUserInput(request: ServerRequest): PendingUserInput | null {
  const userInputRequest = appServerUserInputRequest(request);
  if (!userInputRequest) return null;
  return {
    requestId: userInputRequest.requestId,
    method: userInputRequest.method,
    params: userInputRequest.params,
  };
}

export function userInputResponse(input: PendingUserInput, answers: Record<string, string>): AppServerUserInputResponse {
  return appServerUserInputResponse(input.params.questions, answers);
}
