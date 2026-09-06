import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const validArgs = new Set(["--json"]);
const obsidianCodeMirrorPeers = ["@codemirror/state", "@codemirror/view"];

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
for (const arg of args) {
  if (!validArgs.has(arg)) {
    console.error("Usage: node scripts/api-baseline.mjs [--json]");
    process.exit(1);
  }
}

const report = await createApiBaselineReport();
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

if (report.failures.length > 0) process.exit(1);

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

async function createApiBaselineReport() {
  const failures = [];
  const fail = (message) => {
    failures.push(message);
  };
  const inputs = await readBaselineInputs(process.cwd());
  const readmeBaselines = readCompatibilityBaselines(inputs.readme);

  const codexReadmeVersion = readmeBaselines.codexTestedCliVersion;
  const codexRecordedVersion = inputs.appServerCompatibilityJson.codexAppServer?.testedCliVersion ?? null;
  const codexLocalVersion = readCodexVersion();
  const codexReadmeSemver = parseSemver(codexReadmeVersion);
  const codexRecordedSemver = parseSemver(codexRecordedVersion);
  const codexLocalSemver = parseSemver(codexLocalVersion);

  const obsidianMinVersion = inputs.manifestJson.minAppVersion;
  const obsidianReadmeMinVersion = readmeBaselines.obsidianMinAppVersion;
  const obsidianSpec = inputs.packageJson.devDependencies?.obsidian ?? null;
  const obsidianLockPackage = inputs.packageLockJson.packages?.["node_modules/obsidian"];
  const obsidianLockVersion = obsidianLockPackage?.version ?? null;
  const obsidianPeerDependencies = obsidianLockPackage?.peerDependencies ?? {};
  const obsidianSpecSemver = parseSemver(obsidianSpec);
  const obsidianLockSemver = parseSemver(obsidianLockVersion);
  const obsidianMinSemver = parseSemver(obsidianMinVersion);

  const generationArguments = inputs.appServerCompatibilityJson.codexAppServer?.typeGeneration?.arguments ?? null;
  const expectedGenerationArguments = ["app-server", "generate-ts", "--experimental"];
  const appServerGenerationArgumentsDeclared =
    Array.isArray(generationArguments) && generationArguments.every((argument) => typeof argument === "string");
  const appServerGenerationArgumentsSupported =
    appServerGenerationArgumentsDeclared && arraysEqual(generationArguments, expectedGenerationArguments);
  const initializeCapabilities = inputs.appServerCompatibilityJson.codexAppServer?.initialize?.capabilities ?? {};
  const initializeExperimentalApi = initializeCapabilities.experimentalApi === true;
  const initializeRequestAttestationDisabled = initializeCapabilities.requestAttestation === false;

  if (!codexReadmeSemver) {
    fail("README.md Compatibility table must define `codexAppServer.testedCliVersion` as X.Y.Z.");
  }
  if (!codexRecordedSemver || codexRecordedSemver.version !== codexRecordedVersion) {
    fail("src/app-server/connection/compatibility.json must declare codexAppServer.testedCliVersion as X.Y.Z.");
  }
  if (!codexLocalSemver) {
    fail("local codex --version could not be read.");
  }
  if (codexReadmeVersion && codexRecordedVersion && codexReadmeVersion !== codexRecordedVersion) {
    fail(`README Codex CLI ${codexReadmeVersion} does not match recorded tested CLI ${codexRecordedVersion}.`);
  }
  if (codexLocalSemver && codexRecordedSemver && codexLocalSemver.version !== codexRecordedSemver.version) {
    fail(`local Codex CLI ${codexLocalSemver.version} does not match recorded tested CLI ${codexRecordedSemver.version}.`);
  }
  if (!appServerGenerationArgumentsDeclared) {
    fail("src/app-server/connection/compatibility.json must declare codexAppServer.typeGeneration.arguments as a string array.");
  } else if (!appServerGenerationArgumentsSupported) {
    fail(`app-server type generation arguments must be ${expectedGenerationArguments.join(" ")}.`);
  }
  if (!initializeExperimentalApi) {
    fail("src/app-server/connection/compatibility.json must declare codexAppServer.initialize.capabilities.experimentalApi: true.");
  }
  if (!initializeRequestAttestationDisabled) {
    fail("src/app-server/connection/compatibility.json must declare codexAppServer.initialize.capabilities.requestAttestation: false.");
  }

  if (!obsidianMinSemver) fail("manifest.json minAppVersion must be X.Y.Z.");
  if (!parseSemver(obsidianReadmeMinVersion)) {
    fail("README.md Compatibility table must define `manifest.minAppVersion` as X.Y.Z.");
  } else if (obsidianReadmeMinVersion !== obsidianMinVersion) {
    fail(`README Obsidian baseline ${displayValue(obsidianReadmeMinVersion)} does not match manifest ${obsidianMinVersion}.`);
  }
  if (!obsidianSpecSemver) fail("package.json devDependency obsidian must include an X.Y.Z version.");
  if (!obsidianLockSemver) fail("package-lock.json must lock node_modules/obsidian to X.Y.Z.");
  if (packageRangeKind(obsidianSpec) !== "compatible") {
    fail(`package.json devDependency obsidian should use a caret range, got ${displayValue(obsidianSpec)}.`);
  }
  for (const dependency of obsidianCodeMirrorPeers) {
    const packageSpec = inputs.packageJson.devDependencies?.[dependency] ?? null;
    const peerSpec = obsidianPeerDependencies[dependency] ?? null;
    if (!peerSpec) {
      fail(`locked obsidian must declare the ${dependency} peer dependency; review the root CodeMirror pin.`);
    } else if (packageSpec !== peerSpec) {
      fail(`package.json devDependency ${dependency} ${displayValue(packageSpec)} must match locked obsidian peer ${peerSpec}.`);
    }
  }

  return {
    codex: {
      policy: "compatibility is managed by minor; generated bindings are proven against an exact CLI patch",
      recordedTestedCliVersion: codexRecordedVersion,
      readmeTestedCliVersion: codexReadmeVersion,
      readmeTestedMinor: minorKey(codexReadmeSemver),
      localCliVersion: codexLocalVersion,
      localCliMinor: minorKey(codexLocalSemver),
      readmeMatchesRecordedVersion: codexReadmeVersion && codexRecordedVersion ? codexReadmeVersion === codexRecordedVersion : false,
      localCliMatchesRecordedVersion:
        codexLocalSemver && codexRecordedSemver ? codexLocalSemver.version === codexRecordedSemver.version : null,
      generationArguments,
      appServerGenerationArgumentsSupported,
      initializeExperimentalApi,
      initializeRequestAttestationDisabled,
    },
    obsidian: {
      policy: "manifest declares the runtime floor; obsidian npm tracks the latest compile-time API types independently",
      minAppVersion: obsidianMinVersion,
      minAppVersionMinor: minorKey(obsidianMinSemver),
      readmeMinAppVersion: obsidianReadmeMinVersion,
      packageDependency: obsidianSpec,
      packageDependencyRange: packageRangeKind(obsidianSpec),
      lockedPackageVersion: obsidianLockVersion,
      codeMirrorPeers: Object.fromEntries(
        obsidianCodeMirrorPeers.map((dependency) => [
          dependency,
          {
            packageDependency: inputs.packageJson.devDependencies?.[dependency] ?? null,
            obsidianPeerDependency: obsidianPeerDependencies[dependency] ?? null,
          },
        ]),
      ),
    },
    failures,
  };
}

function readCompatibilityBaselines(readme) {
  const section = markdownSection(readme, "Compatibility");
  const table = readMarkdownTableValues(section);
  return {
    codexTestedCliVersion: table.get("codexAppServer.testedCliVersion") ?? null,
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
    if (!separator?.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;

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
  if (value.startsWith("^")) return "compatible";
  return "other";
}

function displayValue(value) {
  return value ?? "(missing)";
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function readBaselineInputs(cwd) {
  const [packageJson, packageLockJson, manifestJson, readme, appServerCompatibilityJson] = await Promise.all([
    readJson(cwd, "package.json"),
    readJson(cwd, "package-lock.json"),
    readJson(cwd, "manifest.json"),
    readFile(path.join(cwd, "README.md"), "utf8"),
    readJson(cwd, "src/app-server/connection/compatibility.json"),
  ]);

  return {
    appServerCompatibilityJson,
    manifestJson,
    packageJson,
    packageLockJson,
    readme,
  };
}

async function readJson(cwd, file) {
  return JSON.parse(await readFile(path.join(cwd, file), "utf8"));
}

function printReport(report) {
  console.log("API baseline");
  console.log("");
  console.log("Codex app-server");
  console.log(`  policy: ${report.codex.policy}`);
  console.log(`  compatibility table CLI: ${displayValue(report.codex.readmeTestedCliVersion)}`);
  console.log(`  recorded tested CLI: ${displayValue(report.codex.recordedTestedCliVersion)}`);
  console.log(`  compatibility table minor: ${displayValue(report.codex.readmeTestedMinor)}`);
  console.log(`  local codex CLI: ${displayValue(report.codex.localCliVersion)}`);
  console.log(`  local codex minor: ${displayValue(report.codex.localCliMinor)}`);
  console.log(`  generation arguments: ${report.codex.generationArguments?.join(" ") ?? "(missing)"}`);
  console.log(`  initialize experimentalApi: ${report.codex.initializeExperimentalApi ? "yes" : "no"}`);
  console.log(`  initialize requestAttestation disabled: ${report.codex.initializeRequestAttestationDisabled ? "yes" : "no"}`);
  console.log("");
  console.log("Obsidian API");
  console.log(`  policy: ${report.obsidian.policy}`);
  console.log(`  manifest minAppVersion: ${displayValue(report.obsidian.minAppVersion)}`);
  console.log(`  compatibility table minAppVersion: ${displayValue(report.obsidian.readmeMinAppVersion)}`);
  console.log(`  package obsidian: ${displayValue(report.obsidian.packageDependency)}`);
  console.log(`  package range: ${report.obsidian.packageDependencyRange}`);
  console.log(`  package-lock obsidian: ${displayValue(report.obsidian.lockedPackageVersion)}`);
  for (const [dependency, versions] of Object.entries(report.obsidian.codeMirrorPeers)) {
    console.log(
      `  ${dependency}: package ${displayValue(versions.packageDependency)}, obsidian peer ${displayValue(versions.obsidianPeerDependency)}`,
    );
  }
  if (report.failures.length > 0) {
    console.log("");
    console.log("Failures");
    for (const message of report.failures) console.log(`  - ${message}`);
  }
}
