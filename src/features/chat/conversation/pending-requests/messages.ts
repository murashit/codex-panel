export function cannotSendApprovalResponseMessage(): string {
  return "Could not send approval response because Codex app-server is not connected.";
}

export function cannotSendUserInputMessage(): string {
  return "Could not send user input because Codex app-server is not connected.";
}

export function cannotCancelUserInputMessage(): string {
  return "Could not cancel user input because Codex app-server is not connected.";
}

export function userCancelledInputRequestMessage(): string {
  return "User cancelled input request.";
}

export function cannotRejectServerRequestMessage(): string {
  return "Could not reject app-server request because Codex app-server is not connected.";
}
