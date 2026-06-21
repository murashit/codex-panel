import type { ServerRequest } from "../../../../app-server/connection/rpc-messages";
import {
  appServerUserInputRequest,
  appServerUserInputResponse,
  type AppServerUserInputResponse,
} from "../../../../app-server/protocol/server-requests";
import type { PendingUserInput } from "../../../../domain/pending-requests/model";

export function toPendingUserInput(request: ServerRequest): PendingUserInput | null {
  return appServerUserInputRequest(request);
}

export function userInputResponse(input: PendingUserInput, answers: Record<string, string>): AppServerUserInputResponse {
  return appServerUserInputResponse(input.params.questions, answers);
}
