import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

function run(command, args, input) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, input });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

const tag = process.env.TAG;
const sha = process.env.CHECKED_SHA;
const assetDir = process.env.ASSET_DIR;
const repository = process.env.GITHUB_REPOSITORY;
const recoveryReleaseId = process.env.RECOVERY_RELEASE_ID;
if (recoveryReleaseId && (!process.env.RECOVERY_PR || !/^[1-9]\d*$/.test(recoveryReleaseId))) {
  throw new Error("An explicit draft ID requires recovery with a merged release PR");
}
let pullRequest;
if (process.env.RECOVERY_PR) {
  if (!/^\d+$/.test(process.env.RECOVERY_PR)) throw new Error("Recovery requires an explicit PR number");
  pullRequest = JSON.parse(run("gh", ["api", `repos/${repository}/pulls/${process.env.RECOVERY_PR}`]));
} else {
  pullRequest = JSON.parse(process.env.RELEASE_PR_JSON || "null");
}

if (!/^\d+\.\d+\.\d+$/.test(tag)) throw new Error("Expected an explicit X.Y.Z tag");
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Missing checked commit SHA");
if (
  !pullRequest?.merged_at ||
  pullRequest.merge_commit_sha !== sha ||
  pullRequest.base?.ref !== "main" ||
  pullRequest.base?.repo?.full_name !== repository ||
  pullRequest.head?.repo?.full_name !== repository ||
  !pullRequest.head?.ref?.startsWith("tagpr-from-") ||
  !pullRequest.labels?.some((label) => label.name === "tagpr")
) {
  throw new Error("Release notes must come from the tagpr PR merged at the checked SHA");
}
const body = pullRequest.body;
if (
  typeof body !== "string" ||
  !/^## Changes\r?\n\r?\n/.test(body) ||
  !/^-\s+\S/m.test(body) ||
  [...body.matchAll(/^## /gm)].length !== 1
) {
  throw new Error("Replace the generated PR body with final notes: one Changes section with bullets");
}

const recordedSha = (await readFile(path.join(assetDir, "checked-sha"), "utf8")).trim();
if (recordedSha !== sha) throw new Error("Staged assets belong to a different commit");
const names = ["main.js", "manifest.json", "styles.css"];
const assets = await Promise.all(
  names.map(async (name) => {
    const file = path.join(assetDir, name);
    const bytes = await readFile(file);
    if (bytes.length === 0) throw new Error(`Empty release asset: ${name}`);
    if (name === "manifest.json" && JSON.parse(bytes).version !== tag) throw new Error("Tag and staged manifest version differ");
    return { name, file, size: bytes.length, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  }),
);
const api = (endpoint, data) =>
  JSON.parse(
    run(
      "gh",
      ["api", `repos/${repository}/${endpoint}`, ...(data ? ["--method", "PATCH", "--input", "-"] : [])],
      data ? JSON.stringify(data) : undefined,
    ),
  );
const verifyTag = () => {
  if (api(`commits/${tag}`).sha !== sha) throw new Error("Remote tag does not resolve to the checked SHA");
};
// Draft pending tags are resolved by GraphQL; REST may expose an untagged placeholder.
const [owner, name] = repository.split("/");
const pendingRelease = (allowMissing = false) => {
  const result = JSON.parse(
    run("gh", [
      "api",
      "graphql",
      "-f",
      "query=query($owner:String!,$name:String!,$tagName:String!){repository(owner:$owner,name:$name){release(tagName:$tagName){databaseId isDraft}}}",
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-f",
      `tagName=${tag}`,
    ]),
  );
  const release = result.data?.repository?.release;
  if (allowMissing && release === null && !result.errors?.length) return null;
  if (result.errors?.length || !Number.isSafeInteger(release?.databaseId) || release.databaseId <= 0 || !release.isDraft) {
    throw new Error(
      `Expected a draft release for pending tag ${tag}: ${JSON.stringify({ release: release ?? null, errors: result.errors ?? [] })}`,
    );
  }
  return release;
};
const releaseId = recoveryReleaseId ? Number(recoveryReleaseId) : pendingRelease().databaseId;
if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error("Invalid release ID");
const draft = (allowMissing = false) => {
  const pending = pendingRelease(allowMissing);
  if (pending && pending.databaseId !== releaseId) throw new Error("Pending tag changed release during publication");
  const release = api(`releases/${releaseId}`);
  if (!release.draft || release.id !== releaseId) throw new Error("Refusing to modify a published or different release");
  return release;
};
verifyTag();
const release = draft(Boolean(recoveryReleaseId));
if (recoveryReleaseId && (release.name !== tag || release.body?.replace(/\r\n/g, "\n") !== body.replace(/\r\n/g, "\n"))) {
  throw new Error("Explicit recovery draft must already match the approved title and notes");
}
api(`releases/${release.id}`, { tag_name: tag, name: tag, body });
for (const asset of assets) {
  // Resolve uploads by the pinned draft ID, including partial-upload recovery.
  const current = draft();
  const existing = current.assets.find((uploaded) => uploaded.name === asset.name);
  if (existing) run("gh", ["api", `repos/${repository}/releases/assets/${existing.id}`, "--method", "DELETE"]);
  const uploadUrl = new URL(current.upload_url.split("{")[0]);
  uploadUrl.searchParams.set("name", asset.name);
  run("gh", [
    "api",
    uploadUrl.href,
    "--method",
    "POST",
    "--header",
    "Content-Type: application/octet-stream",
    "--header",
    `Content-Length: ${asset.size}`,
    "--input",
    asset.file,
  ]);
}
const ready = draft();
if (ready.body !== body) throw new Error("Draft release notes changed during upload");
if (
  ready.assets.length !== assets.length ||
  !assets.every((asset) => ready.assets.some((uploaded) => uploaded.name === asset.name && uploaded.digest === asset.digest))
) {
  throw new Error("Draft assets do not match the three checked install assets");
}
verifyTag();
const published = api(`releases/${release.id}`, { tag_name: tag, draft: false });
if (published.draft !== false || published.tag_name !== tag) throw new Error("Release publication for the intended tag was not confirmed");
verifyTag();
