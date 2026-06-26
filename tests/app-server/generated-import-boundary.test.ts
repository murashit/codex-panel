import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, "src");
const testsRoot = path.join(repoRoot, "tests");
const generatedImportPattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'][^"']*generated\/app-server\//;
const sourceExtensions = new Set([".ts", ".tsx"]);

describe("generated app-server import boundary", () => {
  it("detects static, import type, and re-export generated app-server references", () => {
    expect(generatedImportPattern.test('import type { Thread } from "../../src/generated/app-server/v2/Thread";')).toBe(true);
    expect(generatedImportPattern.test('type Thread = import("../../src/generated/app-server/v2/Thread").Thread;')).toBe(true);
    expect(generatedImportPattern.test('const thread = require("../../src/generated/app-server/v2/Thread");')).toBe(true);
    expect(generatedImportPattern.test('export type { Thread } from "../../src/generated/app-server/v2/Thread";')).toBe(true);
    expect(generatedImportPattern.test('export * from "../../src/generated/app-server/v2/Thread";')).toBe(true);
  });

  it("keeps generated app-server types behind explicit app-server adapters", async () => {
    const files = await sourceFiles(sourceRoot);
    const offenders: string[] = [];

    for (const file of files) {
      const relativePath = slashPath(path.relative(repoRoot, file));
      if (relativePath.startsWith("src/generated/")) continue;
      if (allowsGeneratedAppServerImport(relativePath)) continue;
      if (generatedImportPattern.test(await readFile(file, "utf8"))) offenders.push(relativePath);
    }

    expect(offenders).toEqual([]);
  });

  it("keeps generated app-server types out of feature tests", async () => {
    const files = await sourceFiles(testsRoot);
    const offenders: string[] = [];

    for (const file of files) {
      const relativePath = slashPath(path.relative(repoRoot, file));
      if (relativePath.startsWith("tests/app-server/")) continue;
      if (generatedImportPattern.test(await readFile(file, "utf8"))) offenders.push(relativePath);
    }

    expect(offenders).toEqual([]);
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(fullPath);
      if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) return [fullPath];
      return [];
    }),
  );
  return files.flat();
}

function slashPath(value: string): string {
  return value.split(path.sep).join("/");
}

function allowsGeneratedAppServerImport(relativePath: string): boolean {
  return relativePath.startsWith("src/app-server/connection/");
}
