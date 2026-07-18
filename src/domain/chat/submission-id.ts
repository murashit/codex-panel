const PANEL_SUBMISSION_CLIENT_ID_PATTERN = /^local-(?:user|steer)-\d+-[A-Za-z0-9_-]+-[a-z0-9]+-[a-z0-9]+$/;

export function isPanelSubmissionClientId(value: string | null | undefined): value is string {
  return typeof value === "string" && PANEL_SUBMISSION_CLIENT_ID_PATTERN.test(value);
}
