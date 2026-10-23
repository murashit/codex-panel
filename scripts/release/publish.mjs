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

const tag = process.env.TAG?.trim();
const sha = process.env.CHECKED_SHA;
const assetDir = process.env.ASSET_DIR;
const repository = process.env.GITHUB_REPOSITORY;
if (!/^\d+\.\d+\.\d+$/.test(tag)) throw new Error("Expected an explicit X.Y.Z tag");
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Missing checked commit SHA");
const api = (endpoint) => JSON.parse(run("gh", ["api", `repos/${repository}/${endpoint}`]));
const verifyTag = () => {
  if (api(`commits/${tag}`).sha !== sha) throw new Error("Remote tag does not resolve to the checked SHA");
};
verifyTag();

// Normal publication and recovery obtain notes from the same merged source PR.
const pullRequests = run("gh", ["api", `repos/${repository}/commits/${sha}/pulls`, "--paginate", "--jq", ".[].number"])
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((number) => api(`pulls/${number}`))
  .filter(
    (pr) =>
      pr.merged_at &&
      pr.merge_commit_sha === sha &&
      pr.base?.ref === "main" &&
      pr.base?.repo?.full_name === repository &&
      pr.head?.repo?.full_name === repository &&
      pr.head?.ref?.startsWith("tagpr-from-") &&
      pr.labels?.some((label) => label.name === "tagpr"),
  );
if (pullRequests.length !== 1) throw new Error("Expected one tagpr PR merged at the checked SHA");
const body = pullRequests[0].body;
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
const assets = await Promise.all(
  ["main.js", "manifest.json", "styles.css"].map(async (name) => {
    const file = path.join(assetDir, name);
    const bytes = await readFile(file);
    if (bytes.length === 0) throw new Error(`Empty release asset: ${name}`);
    if (name === "manifest.json" && JSON.parse(bytes).version !== tag) throw new Error("Tag and staged manifest version differ");
    return { name, file, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  }),
);

// Match gh's pending-tag lookup: REST may expose an untagged placeholder for drafts.
const [owner, name] = repository.split("/");
const findRelease = () => {
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
  const pending = result.data?.repository?.release;
  if (result.errors?.length || pending === undefined) throw new Error(`Release lookup failed: ${JSON.stringify(result)}`);
  if (pending === null) return null;
  if (!Number.isSafeInteger(pending.databaseId) || pending.databaseId <= 0) throw new Error("Invalid release ID");
  const release = api(`releases/${pending.databaseId}`);
  if (release.id !== pending.databaseId || release.draft !== pending.isDraft) throw new Error("Release changed during lookup");
  return release;
};
const verifyContents = (release) => {
  if (release.name !== tag || release.body !== body) throw new Error("Release title or notes differ from the approved PR");
  if (
    release.assets.length !== assets.length ||
    !assets.every((asset) => release.assets.some((uploaded) => uploaded.name === asset.name && uploaded.digest === asset.digest))
  ) {
    throw new Error("Release assets do not match the three checked install assets");
  }
};

let release = findRelease();
if (!release) {
  run("gh", ["release", "create", tag, "--draft", "--verify-tag", "--title", tag, "--notes-file", "-", "--repo", repository], body);
  release = findRelease();
  if (!release) throw new Error("Draft creation was not confirmed");
}
if (!release.draft) {
  verifyContents(release);
  if (release.tag_name !== tag) throw new Error("Published release has a different tag");
  verifyTag();
  console.log(`Published release ${tag} already matches the checked source, notes and assets`);
  process.exit(0);
}
if (release.name !== tag || release.body !== body) throw new Error("Draft title or notes differ from the approved PR");
const releaseId = release.id;
const pinnedRelease = () => {
  const current = findRelease();
  if (current?.id !== releaseId) throw new Error("Pending tag changed release during publication");
  return current;
};
const draft = () => {
  const current = pinnedRelease();
  if (!current.draft) throw new Error("Refusing to modify a published release");
  return current;
};
draft();
run("gh", ["release", "upload", tag, ...assets.map((asset) => asset.file), "--clobber", "--repo", repository]);
verifyContents(draft());
verifyTag();
// Explicit --tag preserves the pending tag when GitHub publishes the draft.
run("gh", ["release", "edit", tag, "--tag", tag, "--draft=false", "--repo", repository]);
const published = pinnedRelease();
if (published.draft || published.tag_name !== tag) throw new Error("Release publication for the intended tag was not confirmed");
verifyContents(published);
verifyTag();
