import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { normalizeSource } from "./normalize-app-server-types.mjs";

function members(source) {
  const parsed = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
  assert.deepEqual(parsed.parseDiagnostics, []);
  return parsed.statements[0].type.types.map((member) =>
    ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, member, parsed).replace(/\s+/g, " "),
  );
}

test("preserves null next to an intersection and its accepted values", () => {
  const source = "type Before = {code:number} | null | null | null & {brand:true};";
  const normalized = normalizeSource(source);
  assert.deepEqual(members(normalized), ["{ code: number; }", "null", "null & { brand: true; }"]);
  const fixture = `${source}\n${normalized.replace("Before", "After")}\n
    type Assert<T extends true> = T;
    type Forward = Assert<[Before] extends [After] ? true : false>;
    type Backward = Assert<[After] extends [Before] ? true : false>;
    const accepted: After = null;`;
  const options = { strict: true, noLib: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === "fixture.ts" ? ts.createSourceFile(name, fixture, ts.ScriptTarget.Latest, true) : undefined);
  const program = ts.createProgram(["fixture.ts"], options, host);
  assert.deepEqual(program.getSyntacticDiagnostics(), []);
  assert.deepEqual(program.getSemanticDiagnostics(), []);
});

test("normalizes each nested union without flattening property, parenthesized, or intersection types", () => {
  const source =
    'type T = "known" | string | null | null | {value: string | "nested"; maybe: number | null | null} | ("wrapped" | string) | (null & {brand:true});';
  const normalized = normalizeSource(source);
  assert.deepEqual(members(normalized), [
    "string",
    "null",
    "{ value: string; maybe: number | null; }",
    "(string)",
    "(null & { brand: true; })",
  ]);
  assert.equal(normalizeSource(normalized), normalized);
});

test("preserves string and comment bytes while removing nonadjacent duplicate null tokens", () => {
  const source =
    '/* | null | null */ type T = "| null | null" | null /* first */ | number | /* duplicate */ null;\ntype U = string | /* name */ "known" // end\n;';
  const normalized = normalizeSource(source);
  assert.deepEqual(members(normalized), ['"| null | null"', "null", "number"]);
  for (const text of ['"| null | null"', "/* | null | null */", "/* first */", "/* duplicate */", "/* name */", "// end"])
    assert.ok(normalized.includes(text), `Missing preserved text: ${text}`);
  assert.ok(!normalized.includes('"known"'));
  assert.equal(normalizeSource(normalized), normalized);
});

test("leaves unfamiliar alternatives intact and does not infer a broad string", () => {
  const source = `type T = "known" | (string) | Open | (string & {brand:true}) | \`prefix\${string}\` | unknown;`;
  assert.equal(normalizeSource(source), source);
  assert.equal(normalizeSource('type T = "known" | "added";'), 'type T = "known" | "added";');
  assert.equal(normalizeSource('type T = "known" | ;'), 'type T = "known" | ;');
});
