import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const stylesDir = path.join(root, "src", "styles");
const reportDynamicPrefixes = process.argv[2] === "--report-dynamic-prefixes";
if (process.argv.length > (reportDynamicPrefixes ? 3 : 2)) {
  console.error("Usage: node scripts/lint/check-css-usage.mjs [--report-dynamic-prefixes]");
  process.exit(1);
}

const dynamicCssClassPatterns = [
  {
    prefix: "codex-panel-diff__line--",
    classes: [
      "codex-panel-diff__line--added",
      "codex-panel-diff__line--context",
      "codex-panel-diff__line--file",
      "codex-panel-diff__line--hunk",
      "codex-panel-diff__line--removed",
    ],
  },
  {
    prefix: "codex-panel-diff__word--",
    classes: ["codex-panel-diff__word--added", "codex-panel-diff__word--removed"],
  },
  {
    prefix: "codex-panel-threads__row--",
    classes: ["codex-panel-threads__row--open", "codex-panel-threads__row--pending", "codex-panel-threads__row--running"],
  },
  {
    prefix: "codex-panel__connection-diagnostics-row--",
    classes: ["codex-panel__connection-diagnostics-row--error", "codex-panel__connection-diagnostics-row--warning"],
  },
  {
    prefix: "codex-panel__execution--",
    classes: ["codex-panel__execution--completed", "codex-panel__execution--failed", "codex-panel__execution--running"],
  },
  {
    prefix: "codex-panel__goal--",
    classes: [
      "codex-panel__goal--active",
      "codex-panel__goal--blocked",
      "codex-panel__goal--budgetLimited",
      "codex-panel__goal--complete",
      "codex-panel__goal--paused",
      "codex-panel__goal--usageLimited",
    ],
  },
  {
    prefix: "codex-panel__limit-panel-meter--",
    classes: ["codex-panel__limit-panel-meter--5", "codex-panel__limit-panel-meter--7"],
  },
  {
    prefix: "codex-panel__limit-panel-row--",
    classes: ["codex-panel__limit-panel-row--danger", "codex-panel__limit-panel-row--warn"],
  },
  {
    prefix: "codex-panel__task-step--",
    classes: ["codex-panel__task-step--completed", "codex-panel__task-step--inProgress"],
  },
];

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
const dynamicCssClasses = dynamicCssClassMap(dynamicCssClassPatterns);

const testOnlyCandidates = [];
const candidates = [];
const dynamicPrefixMatches = new Map();

for (const [className, locations] of cssClasses) {
  const sourceMatches = locationsInTexts(sourceTexts, className);
  if (sourceMatches.length > 0) continue;

  const dynamicClass = dynamicCssClasses.get(className);
  if (dynamicClass && dynamicPrefixes.includes(dynamicClass.prefix)) {
    const matches = dynamicPrefixMatches.get(dynamicClass.prefix) ?? [];
    matches.push({ className, locations });
    dynamicPrefixMatches.set(dynamicClass.prefix, matches);
    continue;
  }

  const testMatches = locationsInTexts(testTexts, className);
  if (testMatches.length > 0) {
    testOnlyCandidates.push({ className, locations, testMatches });
    continue;
  }

  candidates.push({ className, locations });
}

const dynamicConfigurationErrors = dynamicCssConfigurationErrors({
  cssClasses,
  dynamicCssClassPatterns,
  dynamicPrefixes,
});

if (reportDynamicPrefixes) {
  printDynamicPrefixReport({ dynamicPrefixes, dynamicPrefixMatches });
}

if (candidates.length + testOnlyCandidates.length + dynamicConfigurationErrors.length > 0) {
  printCandidates({ testOnlyCandidates, candidates, dynamicConfigurationErrors });
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

function dynamicCssClassMap(patterns) {
  const result = new Map();
  for (const pattern of patterns) {
    for (const className of pattern.classes) {
      if (!className.startsWith(pattern.prefix)) {
        throw new Error(`Dynamic CSS class ${className} does not match prefix ${pattern.prefix}.`);
      }
      result.set(className, { prefix: pattern.prefix });
    }
  }
  return result;
}

function dynamicCssConfigurationErrors({ cssClasses, dynamicCssClassPatterns, dynamicPrefixes }) {
  const errors = [];
  for (const pattern of dynamicCssClassPatterns) {
    const existingClasses = pattern.classes.filter((className) => cssClasses.has(className));
    if (existingClasses.length > 0 && !dynamicPrefixes.includes(pattern.prefix)) {
      errors.push({
        title: "Dynamic CSS class configuration references prefixes that are not present in source templates:",
        details: [`  ${pattern.prefix}`, ...existingClasses.map((className) => `    ${className}`)],
      });
    }
  }
  return errors;
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

function printDynamicPrefixReport({ dynamicPrefixes, dynamicPrefixMatches }) {
  console.log("Dynamic CSS class prefix exemptions:");
  if (dynamicPrefixMatches.size === 0) {
    console.log("  none");
  } else {
    for (const [prefix, matches] of [...dynamicPrefixMatches.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      console.log(`  ${prefix}`);
      for (const match of matches) {
        console.log(`    ${match.className}`);
        console.log(`      css: ${match.locations.join(", ")}`);
      }
    }
  }

  const prefixesWithoutExemptions = dynamicPrefixes.filter((prefix) => !dynamicPrefixMatches.has(prefix));
  if (prefixesWithoutExemptions.length === 0) return;

  console.log("");
  console.log("Detected dynamic prefixes with no CSS exemptions:");
  for (const prefix of prefixesWithoutExemptions) {
    console.log(`  ${prefix}`);
  }
}

function printCandidates({ testOnlyCandidates, candidates, dynamicConfigurationErrors }) {
  console.error("CSS usage check failed.");
  for (const error of dynamicConfigurationErrors) {
    console.error("");
    console.error(error.title);
    for (const detail of error.details) {
      console.error(detail);
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
