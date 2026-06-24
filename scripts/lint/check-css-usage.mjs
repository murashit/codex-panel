import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const stylesDir = path.join(root, "src", "styles");
if (process.argv.length > 2) {
  console.error("Usage: node scripts/lint/check-css-usage.mjs");
  process.exit(1);
}

const cssFiles = await orderedCssFiles();
const sourceFiles = await filesInTree(path.join(root, "src"), new Set([".ts", ".tsx"]), {
  excludedPrefixes: [path.join(root, "src", "generated")],
});
const testFiles = await filesInTree(path.join(root, "tests"), new Set([".ts", ".tsx"]));

const cssClasses = await collectCssClasses(cssFiles);
const sourceTexts = await readTexts(sourceFiles);
const testTexts = await readTexts(testFiles);
const sourceText = sourceTexts.map((item) => item.text).join("\n");
const dynamicPrefixes = collectDynamicClassPrefixes(sourceText);

const testOnlyCandidates = [];
const candidates = [];

for (const [className, locations] of cssClasses) {
  const sourceMatches = locationsInTexts(sourceTexts, className);
  if (sourceMatches.length > 0) continue;

  const testMatches = locationsInTexts(testTexts, className);
  if (testMatches.length > 0) {
    testOnlyCandidates.push({ className, locations, testMatches });
    continue;
  }

  candidates.push({ className, locations });
}

if (candidates.length + testOnlyCandidates.length + dynamicPrefixes.length > 0) {
  printCandidates({ testOnlyCandidates, candidates, dynamicPrefixes });
  process.exit(1);
}

async function orderedCssFiles() {
  const orderPath = path.join(stylesDir, "order.json");
  const order = JSON.parse(await readFile(orderPath, "utf8"));
  if (!Array.isArray(order) || !order.every((item) => typeof item === "string")) {
    throw new Error(`${relative(orderPath)} must be a JSON array of CSS file names.`);
  }
  return order.map((file) => path.join(stylesDir, file));
}

async function collectCssClasses(files) {
  const result = new Map();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
      const withoutComment = line.replace(/\/\*.*?\*\//g, "");
      const classPattern = /(^|[^\\])\.([_a-zA-Z][\w-]*)/g;
      for (const match of withoutComment.matchAll(classPattern)) {
        const className = match[2];
        if (!className.startsWith("codex-panel")) continue;
        const locations = result.get(className) ?? [];
        locations.push(`${relative(file)}:${index + 1}`);
        result.set(className, locations);
      }
    }
  }
  return new Map([...result.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function collectDynamicClassPrefixes(text) {
  const prefixes = new Set();
  const templatePrefixPattern = /codex-panel(?:-[a-z]+)?__[a-z0-9-]+--\$\{/g;
  for (const match of text.matchAll(templatePrefixPattern)) {
    prefixes.add(match[0].slice(0, -"${".length));
  }
  return [...prefixes].sort((left, right) => left.localeCompare(right));
}

async function readTexts(files) {
  const result = [];
  for (const file of files) {
    result.push({ file, text: await readFile(file, "utf8") });
  }
  return result;
}

function locationsInTexts(texts, needle) {
  const locations = [];
  for (const { file, text } of texts) {
    let offset = text.indexOf(needle);
    if (offset === -1) continue;
    const line = text.slice(0, offset).split("\n").length;
    locations.push(`${relative(file)}:${line}`);
  }
  return locations;
}

async function filesInTree(directory, extensions, options = {}) {
  const excludedPrefixes = options.excludedPrefixes ?? [];
  const result = [];
  await collectFiles(directory, extensions, excludedPrefixes, result);
  return result.sort((left, right) => relative(left).localeCompare(relative(right)));
}

async function collectFiles(directory, extensions, excludedPrefixes, result) {
  if (excludedPrefixes.some((prefix) => directory === prefix || directory.startsWith(`${prefix}${path.sep}`))) return;

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(file, extensions, excludedPrefixes, result);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      result.push(file);
    }
  }
}

function printCandidates({ testOnlyCandidates, candidates, dynamicPrefixes }) {
  console.error("CSS usage check failed.");
  if (dynamicPrefixes.length > 0) {
    console.error("");
    console.error("Dynamic CSS class prefixes are not allowed:");
    for (const prefix of dynamicPrefixes) {
      console.error(`  ${prefix}`);
    }
  }

  if (testOnlyCandidates.length > 0) {
    console.error("");
    console.error("Test-only unused CSS class candidates:");
    for (const item of testOnlyCandidates) {
      console.error(`  ${item.className}`);
      console.error(`    css: ${item.locations.join(", ")}`);
      console.error(`    tests: ${item.testMatches.join(", ")}`);
    }
  }

  if (candidates.length > 0) {
    console.error("");
    console.error("Unused CSS class candidates:");
    for (const item of candidates) {
      console.error(`  ${item.className}`);
      console.error(`    css: ${item.locations.join(", ")}`);
    }
  }
}

function relative(file) {
  return path.relative(root, file);
}
