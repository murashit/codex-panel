import ts from "typescript";

export function normalizeSource(source) {
  const parsed = ts.createSourceFile("generated.ts", source, ts.ScriptTarget.Latest, true);
  if (parsed.parseDiagnostics.length > 0) return source;
  const edits = [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);

  function visit(node) {
    if (ts.isUnionTypeNode(node)) {
      const hasString = node.types.some((member) => member.kind === ts.SyntaxKind.StringKeyword);
      let hasNull = false;
      const retained = node.types.map((member) => {
        if (ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword) {
          const duplicate = hasNull;
          hasNull = true;
          return !duplicate;
        }
        // A direct bare string already accepts direct string literals; do not resolve or flatten other types.
        return !(hasString && ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal));
      });
      let hasRetained = false;
      for (let index = 0; index < node.types.length; index++) {
        const member = node.types[index];
        if (!retained[index]) edits.push({ start: member.getStart(parsed), end: member.end });
        if (index > 0 && !(hasRetained && retained[index])) {
          scanner.setTextPos(node.types[index - 1].end);
          if (scanner.scan() === ts.SyntaxKind.BarToken) {
            edits.push({ start: scanner.getTokenPos(), end: scanner.getTextPos() });
          }
        }
        hasRetained ||= retained[index];
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  // Remove tokens only, leaving trivia and unrelated source bytes untouched, including nested unions.
  for (const { start, end } of edits.sort((left, right) => right.start - left.start)) {
    source = source.slice(0, start) + source.slice(end);
  }
  return source;
}
