export function shortSignature(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function renderTextWithWikiLinks(parent: HTMLElement, text: string, openLink: (target: string) => void): void {
  const wikilinkPattern = /\[\[([^\]\n]+?)\]\]/g;
  const doc = parent.ownerDocument;
  let lastIndex = 0;
  for (const match of text.matchAll(wikilinkPattern)) {
    const index = match.index;
    if (index > lastIndex) {
      parent.appendChild(doc.createTextNode(text.slice(lastIndex, index)));
    }

    const rawLink = match[1];
    const separator = rawLink.indexOf("|");
    const target = (separator === -1 ? rawLink : rawLink.slice(0, separator)).trim();
    const label = (separator === -1 ? rawLink : rawLink.slice(separator + 1)).trim() || target;

    if (target.length === 0) {
      parent.appendChild(doc.createTextNode(match[0]));
    } else {
      const link = parent.createEl("a", {
        cls: "internal-link codex-panel__wikilink",
        text: label,
        attr: {
          href: target,
          title: target,
        },
      });
      link.onclick = (event) => {
        event.preventDefault();
        openLink(target);
      };
    }
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parent.appendChild(doc.createTextNode(text.slice(lastIndex)));
  }
}
