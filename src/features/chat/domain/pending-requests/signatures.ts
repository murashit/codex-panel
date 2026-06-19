import type { PendingApproval, PendingMcpElicitation, PendingUserInput } from "./model";

export function pendingRequestsSignature(
  approvals: readonly PendingApproval[],
  inputs: readonly PendingUserInput[],
  mcpElicitations: readonly PendingMcpElicitation[],
  drafts: ReadonlyMap<string, string>,
  mcpDrafts: ReadonlyMap<string, string>,
): string {
  if (approvals.length === 0 && inputs.length === 0 && mcpElicitations.length === 0) return "";
  return JSON.stringify({
    approvals: approvals.map((approval) => ({ id: approval.requestId, method: approval.method })),
    inputs: inputs.map((input) => ({
      id: input.requestId,
      questions: input.params.questions.map((question) => ({
        id: question.id,
        header: question.header,
        question: question.question,
        options: question.options?.map((option) => option.label) ?? null,
      })),
    })),
    mcpElicitations: mcpElicitations.map((elicitation) => ({
      id: elicitation.requestId,
      mode: elicitation.params.mode,
      serverName: elicitation.params.serverName,
      message: elicitation.params.message,
      fields:
        elicitation.params.mode === "form"
          ? elicitation.params.fields.map((field) => ({
              id: field.id,
              type: field.type,
              title: field.title,
              options: "options" in field ? field.options.map((option) => option.value) : null,
            }))
          : [],
    })),
    drafts: Array.from(drafts.entries()).sort(([left], [right]) => left.localeCompare(right)),
    mcpDrafts: Array.from(mcpDrafts.entries()).sort(([left], [right]) => left.localeCompare(right)),
  });
}

export function pendingRequestFocusSignature(
  approvals: readonly PendingApproval[],
  inputs: readonly PendingUserInput[],
  mcpElicitations: readonly PendingMcpElicitation[],
): string {
  if (approvals.length === 0 && inputs.length === 0 && mcpElicitations.length === 0) return "";
  return JSON.stringify({
    approvals: approvals.map((approval) => ({ id: approval.requestId, method: approval.method })),
    inputs: inputs.map((input) => ({ id: input.requestId, method: input.method })),
    mcpElicitations: mcpElicitations.map((elicitation) => ({ id: elicitation.requestId, method: elicitation.method })),
  });
}
