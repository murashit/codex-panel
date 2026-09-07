import type { CodexErrorInfo } from "../../../../generated/app-server/v2/CodexErrorInfo";
import { createStructuredSystemItem } from "../../domain/thread-stream/factories/system-items";
import type { ThreadStreamItem, ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import type { UserVisibleNoticeNotification } from "./notification-routing";

export function userVisibleNoticeItem(notification: UserVisibleNoticeNotification, id: string): ThreadStreamItem | null {
  switch (notification.method) {
    case "model/rerouted":
      return createStructuredSystemItem(id, `Model changed to ${notification.params.toModel}.`, [
        { body: `Switched from ${notification.params.fromModel} because high-risk cyber activity was detected.` },
      ]);
    case "deprecationNotice":
      return createStructuredSystemItem(id, notification.params.summary, detailSections(notification.params.details));
    case "warning":
      return createStructuredSystemItem(id, notification.params.message, []);
    case "error": {
      const { error, willRetry } = notification.params;
      const sections = detailSections(error.additionalDetails);
      if (error.misalignment?.detailedExplanation) sections.push({ body: error.misalignment.detailedExplanation });
      if (error.misalignment?.steer?.message)
        sections.push({ title: "Suggested continuation input", body: error.misalignment.steer.message });
      const httpStatus = errorHttpStatus(error.codexErrorInfo);
      if (httpStatus !== null) sections.push({ auditFacts: [{ key: "HTTP status", value: String(httpStatus) }] });
      sections.push({ body: willRetry ? "Codex will retry automatically." : "Codex will not retry automatically." });
      return createStructuredSystemItem(id, error.message, sections);
    }
    case "configWarning": {
      const { summary, details, path, range } = notification.params;
      const sections = detailSections(details);
      const auditFacts = [];
      if (path) auditFacts.push({ key: "Config file", value: path });
      if (range) {
        auditFacts.push({
          key: "Location",
          value: `${String(range.start.line)}:${String(range.start.column)}–${String(range.end.line)}:${String(range.end.column)}`,
        });
      }
      if (auditFacts.length > 0) sections.push({ auditFacts });
      return createStructuredSystemItem(id, summary, sections);
    }
    case "windows/worldWritableWarning": {
      const { samplePaths, extraCount, failedScan } = notification.params;
      const sections: ThreadStreamNoticeSection[] = [];
      if (samplePaths.length > 0) sections.push({ title: "Paths writable by everyone", body: samplePaths.join("\n") });
      if (extraCount > 0) sections.push({ body: `${String(extraCount)} additional paths were found.` });
      if (failedScan) sections.push({ body: "The scan could not be completed; the path list may be incomplete." });
      return createStructuredSystemItem(id, "Windows sandbox filesystem warning.", sections);
    }
    case "windowsSandbox/setupCompleted":
      return notification.params.success
        ? null
        : createStructuredSystemItem(id, "Windows sandbox setup failed.", detailSections(notification.params.error));
  }
}

function detailSections(details: string | null): ThreadStreamNoticeSection[] {
  return details ? [{ body: details }] : [];
}

function errorHttpStatus(info: CodexErrorInfo | null): number | null {
  if (!info || typeof info === "string") return null;
  if ("httpConnectionFailed" in info) return info.httpConnectionFailed.httpStatusCode;
  if ("responseStreamConnectionFailed" in info) return info.responseStreamConnectionFailed.httpStatusCode;
  if ("responseStreamDisconnected" in info) return info.responseStreamDisconnected.httpStatusCode;
  if ("responseTooManyFailedAttempts" in info) return info.responseTooManyFailedAttempts.httpStatusCode;
  return null;
}
