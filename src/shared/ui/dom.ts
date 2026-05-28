import { parseObsidianWikiLink } from "../obsidian/wikilinks";

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
    const rawMatch = match[0];
    if (rawLink === undefined) continue;
    const parsed = parseObsidianWikiLink(rawLink);

    if (!parsed) {
      parent.appendChild(doc.createTextNode(rawMatch));
    } else {
      const target = `${parsed.target}${parsed.subpath}`;
      const label = parsed.display || target;
      const link = parent.createEl("a", {
        cls: "internal-link codex-panel__wikilink",
        text: label,
        attr: {
          href: target,
        },
      });
      link.onclick = (event) => {
        event.preventDefault();
        openLink(target);
      };
    }
    lastIndex = index + rawMatch.length;
  }

  if (lastIndex < text.length) {
    parent.appendChild(doc.createTextNode(text.slice(lastIndex)));
  }
}
