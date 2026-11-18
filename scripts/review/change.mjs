import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { parseArgs, promisify } from "node:util";
import { Stryker } from "@stryker-mutator/core";

const [review, ...args] = process.argv.slice(2);
const { values } = parseArgs({ args, options: { base: { type: "string", default: "origin/main" } } });
const run = promisify(execFile);
const git = async (...command) =>
  (await run("git", ["--literal-pathspecs", ...command], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })).stdout;
const base = (await git("merge-base", "--", values.base, "HEAD")).trim();
const roots = review === "mutation" ? ["src"] : ["src", "tests"];
const paths = new Map();
const status = await git("diff", "--find-renames", "--name-status", "--diff-filter=ACMRT", "-z", base, "--", ...roots);
const entries = status.split("\0");
for (let index = 0; index < entries.length - 1; ) {
  const kind = entries[index++];
  const original = entries[index++];
  const destination = /^[RC]/.test(kind) ? entries[index++] : original;
  paths.set(destination, kind === "A" || kind.startsWith("C") ? null : original);
}
const untracked = await git("ls-files", "--others", "--exclude-standard", "-z", "--", ...roots);
for (const file of untracked.split("\0").filter(Boolean)) paths.set(file, null);

const changes = new Map();
for (const [file, original] of paths) {
  if (file.startsWith("src/generated/")) continue;
  if (review === "mutation" && (!/\.tsx?$/.test(file) || file.endsWith(".d.ts"))) continue;
  if (original === null) {
    changes.set(file, [[1, Infinity]]);
    continue;
  }
  const patch = await git(
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--inter-hunk-context=0",
    "--unified=0",
    `${base}:${original}`,
    "--",
    file,
  );
  const ranges = [];
  for (const match of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = Number(match[2] ?? 1);
    if (count) ranges.push([start, start + count - 1]);
  }
  if (ranges.length) changes.set(file, ranges);
}

if (!changes.size) {
  console.log(`No changed lines in scope for ${review} review.`);
} else if (review === "mutation") {
  const mutate = [];
  for (const [file, ranges] of changes) {
    // Stryker interprets its input paths as minimatch globs.
    const pattern = file.replace(/[?*()[\]{}]/g, "[$&]");
    for (const [start, end] of ranges) mutate.push(end === Infinity ? pattern : `${pattern}:${start}-${end}`);
  }
  await new Stryker({
    mutate,
    incremental: false,
    concurrency: 2,
    reporters: ["clear-text"],
    // A change with no related tests is a review finding. Vitest reports it in the dry run.
    allowEmpty: true,
    allowConsoleColors: false,
    clearTextReporter: { reportTests: false },
  }).runMutationTest();
} else {
  const directory = mkdtempSync(join(tmpdir(), "panel-duplication-"));
  try {
    await run(process.execPath, [
      "node_modules/jscpd/run-jscpd.js",
      "src",
      "tests",
      "--ignore",
      "**/src/generated/**,src/generated/**",
      "--absolute",
      "--reporters",
      "json",
      "--output",
      directory,
    ]);
    const { duplicates } = JSON.parse(readFileSync(join(directory, "jscpd-report.json"), "utf8"));
    let count = 0;
    for (const { firstFile, secondFile } of duplicates) {
      const sides = [firstFile, secondFile].map(({ name, start, end }) => ({ file: relative(".", name).split(sep).join("/"), start, end }));
      if (sides.some(({ file, start, end }) => changes.get(file)?.some(([low, high]) => low <= end && start <= high))) {
        console.log(sides.map(({ file, start, end }) => `${file}:${start}-${end}`).join("  <->  "));
        count++;
      }
    }
    console.log(`${count} duplicate pairs touching changed lines.`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
