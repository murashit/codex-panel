import type { ThreadStreamItem, ThreadStreamNoticeSection } from "./items";

export function isTerminalTurnErrorItem(item: ThreadStreamItem): boolean {
  return item.provenance?.source === "panel" && item.provenance.channel === "notice" && item.provenance.reason === "turnError";
}

export function isEquivalentTurnErrorNotice(item: ThreadStreamItem, terminal: ThreadStreamItem): boolean {
  if (
    !terminal.turnId ||
    !isTerminalTurnErrorItem(terminal) ||
    item.id === terminal.id ||
    item.turnId !== terminal.turnId ||
    item.kind !== terminal.kind ||
    item.provenance?.source !== "panel" ||
    item.provenance.channel !== "notice"
  ) {
    return false;
  }
  if (item.kind === "reviewResult" && terminal.kind === "reviewResult") {
    return (
      item.text === terminal.text &&
      (item.provenance.reason === "reviewMessage" || item.provenance.reason === "parsedAutoReview") &&
      JSON.stringify(item.review?.auditFacts ?? []) === JSON.stringify(terminal.review?.auditFacts ?? [])
    );
  }
  if (item.kind !== "system" || terminal.kind !== "system" || item.provenance.reason !== "runtimeError" || item.text !== terminal.text)
    return false;
  const observed = item.noticeSections ?? [];
  const saved = terminal.noticeSections ?? [];
  if (observed.length !== saved.length + 1) return false;
  if (!saved.every((section, index) => observed[index] && sameNoticeSection(section, observed[index]))) return false;
  return true;
}

function sameNoticeSection(a: ThreadStreamNoticeSection, b: ThreadStreamNoticeSection): boolean {
  return a.title === b.title && a.body === b.body && JSON.stringify(a.auditFacts ?? []) === JSON.stringify(b.auditFacts ?? []);
}
