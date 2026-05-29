import stylelint from "stylelint";

const ruleName = "codex-panel/no-specificity-where";

const messages = stylelint.utils.ruleMessages(ruleName, {
  rejected: (selector) => `Do not hide class, id, or attribute selectors inside :where(): "${selector}"`,
});

function rule(primary) {
  return (root, result) => {
    if (primary === false) return;

    root.walkRules((ruleNode) => {
      const selector = ruleNode.selector;
      if (!selector.includes(":where(")) return;

      for (const range of whereRanges(selector)) {
        const body = selector.slice(range.bodyStart, range.bodyEnd);
        if (!/[.#[]/.test(body)) continue;

        stylelint.utils.report({
          message: messages.rejected,
          messageArgs: [selector.slice(range.start, range.end)],
          node: ruleNode,
          result,
          ruleName,
          index: range.start,
          endIndex: range.end,
        });
      }
    });
  };
}

function whereRanges(selector) {
  const ranges = [];
  let searchFrom = 0;

  while (searchFrom < selector.length) {
    const start = selector.indexOf(":where(", searchFrom);
    if (start === -1) break;

    const bodyStart = start + ":where(".length;
    let depth = 1;
    let index = bodyStart;

    for (; index < selector.length && depth > 0; index += 1) {
      const char = selector[index];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
    }

    if (depth === 0) {
      ranges.push({ start, bodyStart, bodyEnd: index - 1, end: index });
      searchFrom = index;
    } else {
      searchFrom = bodyStart;
    }
  }

  return ranges;
}

rule.ruleName = ruleName;
rule.messages = messages;

export default stylelint.createPlugin(ruleName, rule);
