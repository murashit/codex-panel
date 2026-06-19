import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { readJson } from "./utils.mjs";

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const validArgs = new Set(["--json"]);

for (const arg of args) {
  if (!validArgs.has(arg)) {
    console.error("Usage: node scripts/api-baseline.mjs [--json]");
    process.exit(1);
  }
}

function fail(message) {
  failures.push(message);
}

function parseSemver(value) {
  const match = String(value ?? "").match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  if (!match) return null;
  return {
    version: match[0],
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function minorKey(version) {
  return version ? `${version.major}.${version.minor}` : null;
}

function readCodexVersion() {
  const result = spawnSync("codex", ["--version"], {
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
  });
  if (result.error || result.status !== 0) return null;
  return parseSemver(`${result.stdout}\n${result.stderr}`)?.version ?? null;
}

function readCompatibilityBaselines(readme) {
  const section = markdownSection(readme, "Compatibility");
  const table = readMarkdownTableValues(section);
  return {
    codexTestedCliVersion: table.get("codex.testedCliVersion") ?? null,
    obsidianApiTypesVersion: table.get("obsidian") ?? null,
    obsidianMinAppVersion: table.get("manifest.minAppVersion") ?? null,
  };
}

function markdownSection(markdown, heading) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const headingLine = `## ${heading}`;
  const start = lines.findIndex((line) => line.trim() === headingLine);
  if (start === -1) return "";
  const end = lines.findIndex((line, index) => index > start && /^##\s+\S/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

function readMarkdownTableValues(markdown) {
  const values = new Map();
  const lines = markdown.split("\n").map((line) => line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    const header = splitMarkdownTableRow(lines[index]);
    if (!header) continue;
    const separator = splitMarkdownTableRow(lines[index + 1]);
    if (!separator || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;

    const keyColumn = header.findIndex((cell) => normalizeTableHeader(cell) === "key");
    const versionColumn = header.findIndex((cell) => normalizeTableHeader(cell) === "version");
    if (keyColumn === -1 || versionColumn === -1) continue;

    for (index += 2; index < lines.length; index += 1) {
      const row = splitMarkdownTableRow(lines[index]);
      if (!row) break;
      const key = inlineCodeValue(row[keyColumn]);
      const version = inlineCodeValue(row[versionColumn]);
      if (key && version) values.set(key, version);
    }
  }
  return values;
}

function splitMarkdownTableRow(line) {
  if (!line?.startsWith("|") || !line.endsWith("|")) return null;
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeTableHeader(value) {
  return value.trim().toLowerCase();
}

function inlineCodeValue(value) {
  return value?.match(/`([^`]+)`/)?.[1] ?? null;
}

function packageRangeKind(spec) {
  const value = String(spec ?? "");
  if (value.startsWith("~")) return "patch";
  if (/^\d+\.\d+\.\d+$/.test(value)) return "exact";
  if (value.startsWith("^")) return "minor";
  return "other";
}

function displayValue(value) {
  return value ?? "(missing)";
}

const failures = [];
const packageJson = await readJson("package.json");
const packageLockJson = await readJson("package-lock.json");
const manifestJson = await readJson("manifest.json");
const versionsJson = await readJson("versions.json");
const readme = await readFile("README.md", "utf8");
const clientSource = await readFile("src/app-server/connection/client.ts", "utf8");
const appServerGenerateSource = await readFile("scripts/generate-app-server-types.mjs", "utf8");
const readmeBaselines = readCompatibilityBaselines(readme);

const codexReadmeVersion = readmeBaselines.codexTestedCliVersion;
const codexLocalVersion = readCodexVersion();
const codexReadmeSemver = parseSemver(codexReadmeVersion);
const codexLocalSemver = parseSemver(codexLocalVersion);

const obsidianMinVersion = manifestJson.minAppVersion;
const obsidianReadmeApiTypesVersion = readmeBaselines.obsidianApiTypesVersion;
const obsidianReadmeMinVersion = readmeBaselines.obsidianMinAppVersion;
const obsidianVersionEntry = versionsJson[packageJson.version] ?? null;
const obsidianSpec = packageJson.devDependencies?.obsidian ?? null;
const obsidianLockVersion = packageLockJson.packages?.["node_modules/obsidian"]?.version ?? null;
const obsidianSpecSemver = parseSemver(obsidianSpec);
const obsidianLockSemver = parseSemver(obsidianLockVersion);
const obsidianMinSemver = parseSemver(obsidianMinVersion);

const appServerGenerationExperimental =
  appServerGenerateSource.includes("app-server") &&
  appServerGenerateSource.includes("generate-ts") &&
  appServerGenerateSource.includes("--experimental");
const initializeExperimentalApi = /experimentalApi:\s*true/.test(clientSource);
const initializeRequestAttestationDisabled = /requestAttestation:\s*false/.test(clientSource);

if (!codexReadmeSemver) {
  fail("README.md Compatibility table must define `codex.testedCliVersion` as X.Y.Z.");
}
if (!codexLocalSemver) {
  fail("local codex --version could not be read.");
}
if (codexReadmeSemver && codexLocalSemver && minorKey(codexReadmeSemver) !== minorKey(codexLocalSemver)) {
  fail(`local Codex CLI minor ${minorKey(codexLocalSemver)} does not match compatibility table minor ${minorKey(codexReadmeSemver)}.`);
}
if (!appServerGenerationExperimental) fail("generate:app-server-types must use codex app-server generate-ts --experimental.");
if (!initializeExperimentalApi) fail("app-server initialize must declare experimentalApi: true.");
if (!initializeRequestAttestationDisabled) fail("app-server initialize must declare requestAttestation: false.");

if (!obsidianMinSemver) fail("manifest.json minAppVersion must be X.Y.Z.");
if (obsidianMinSemver && obsidianMinSemver.patch !== 0) {
  fail(`manifest.json minAppVersion should be the minor baseline patch 0, got ${obsidianMinVersion}.`);
}
if (!parseSemver(obsidianReadmeMinVersion)) {
  fail("README.md Compatibility table must define `manifest.minAppVersion` as X.Y.Z.");
} else if (obsidianReadmeMinVersion !== obsidianMinVersion) {
  fail(`README Obsidian baseline ${displayValue(obsidianReadmeMinVersion)} does not match manifest ${obsidianMinVersion}.`);
}
if (obsidianVersionEntry !== obsidianMinVersion) {
  fail(`versions.json must map ${packageJson.version} to manifest minAppVersion ${obsidianMinVersion}.`);
}
if (!obsidianSpecSemver) fail("package.json devDependency obsidian must include an X.Y.Z version.");
if (!obsidianLockSemver) fail("package-lock.json must lock node_modules/obsidian to X.Y.Z.");
if (packageRangeKind(obsidianSpec) !== "patch") {
  fail(`package.json devDependency obsidian should use a patch-only '~' range, got ${displayValue(obsidianSpec)}.`);
}
if (obsidianMinSemver && obsidianSpecSemver && minorKey(obsidianSpecSemver) !== minorKey(obsidianMinSemver)) {
  fail(`obsidian devDependency minor ${minorKey(obsidianSpecSemver)} does not match minAppVersion minor ${minorKey(obsidianMinSemver)}.`);
}
if (obsidianMinSemver && obsidianLockSemver && minorKey(obsidianLockSemver) !== minorKey(obsidianMinSemver)) {
  fail(`locked obsidian minor ${minorKey(obsidianLockSemver)} does not match minAppVersion minor ${minorKey(obsidianMinSemver)}.`);
}
if (!parseSemver(obsidianReadmeApiTypesVersion)) {
  fail("README.md Compatibility table must define `obsidian` API types as X.Y.Z.");
} else if (obsidianReadmeApiTypesVersion !== obsidianLockVersion) {
  fail(
    `README Obsidian API types ${displayValue(obsidianReadmeApiTypesVersion)} does not match package-lock obsidian ${displayValue(obsidianLockVersion)}.`,
  );
}

const report = {
  codex: {
    policy: "managed by minor version",
    readmeTestedCliVersion: codexReadmeVersion,
    readmeTestedMinor: minorKey(codexReadmeSemver),
    localCliVersion: codexLocalVersion,
    localCliMinor: minorKey(codexLocalSemver),
    localCliMatchesTestedMinor: codexReadmeSemver && codexLocalSemver ? minorKey(codexReadmeSemver) === minorKey(codexLocalSemver) : null,
    appServerGenerationExperimental,
    initializeExperimentalApi,
    initializeRequestAttestationDisabled,
  },
  obsidian: {
    policy: "manifest declares the minimum app version; obsidian npm provides compile-time API types in the same minor",
    minAppVersion: obsidianMinVersion,
    minAppVersionMinor: minorKey(obsidianMinSemver),
    readmeMinAppVersion: obsidianReadmeMinVersion,
    versionsJsonCurrentMinAppVersion: obsidianVersionEntry,
    readmeApiTypesVersion: obsidianReadmeApiTypesVersion,
    packageDependency: obsidianSpec,
    packageDependencyRange: packageRangeKind(obsidianSpec),
    packageDependencyMinor: minorKey(obsidianSpecSemver),
    lockedPackageVersion: obsidianLockVersion,
    lockedPackageMinor: minorKey(obsidianLockSemver),
  },
  failures,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("API baseline");
  console.log("");
  console.log("Codex app-server");
  console.log(`  policy: ${report.codex.policy}`);
  console.log(`  compatibility table CLI: ${displayValue(report.codex.readmeTestedCliVersion)}`);
  console.log(`  compatibility table minor: ${displayValue(report.codex.readmeTestedMinor)}`);
  console.log(`  local codex CLI: ${displayValue(report.codex.localCliVersion)}`);
  console.log(`  local codex minor: ${displayValue(report.codex.localCliMinor)}`);
  console.log(`  generate-ts --experimental: ${report.codex.appServerGenerationExperimental ? "yes" : "no"}`);
  console.log(`  initialize experimentalApi: ${report.codex.initializeExperimentalApi ? "yes" : "no"}`);
  console.log(`  initialize requestAttestation disabled: ${report.codex.initializeRequestAttestationDisabled ? "yes" : "no"}`);
  console.log("");
  console.log("Obsidian API");
  console.log(`  policy: ${report.obsidian.policy}`);
  console.log(`  manifest minAppVersion: ${displayValue(report.obsidian.minAppVersion)}`);
  console.log(`  compatibility table minAppVersion: ${displayValue(report.obsidian.readmeMinAppVersion)}`);
  console.log(`  versions.json current minAppVersion: ${displayValue(report.obsidian.versionsJsonCurrentMinAppVersion)}`);
  console.log(`  compatibility table API types: ${displayValue(report.obsidian.readmeApiTypesVersion)}`);
  console.log(`  package obsidian: ${displayValue(report.obsidian.packageDependency)}`);
  console.log(`  package range: ${report.obsidian.packageDependencyRange}`);
  console.log(`  package-lock obsidian: ${displayValue(report.obsidian.lockedPackageVersion)}`);
  if (failures.length > 0) {
    console.log("");
    console.log("Failures");
    for (const message of failures) console.log(`  - ${message}`);
  }
}

if (failures.length > 0) process.exit(1);
