import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const sha = "a".repeat(40);
const body = "## Changes\n\n- Approved change.\n";
const repository = "owner/repo";
const posixOnly = { skip: process.platform === "win32" ? "The release workflow runs on a POSIX host" : false };
const pullRequest = {
  merged_at: "2026-10-23T00:00:00Z",
  merge_commit_sha: sha,
  base: { ref: "main", repo: { full_name: repository } },
  head: { ref: "tagpr-from-1.0.0", repo: { full_name: repository } },
  labels: [{ name: "tagpr" }],
  body,
};

// Emulate the API boundary: drafts exist in listings/by ID, never by tag.
const ghFixture = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const file=process.env.RELEASE_TEST_STATE;
const state=JSON.parse(fs.readFileSync(file));
const args=process.argv.slice(2);
let response;
if(args[0]==='api') {
  const endpoint=args.find(arg=>arg.startsWith('repos/'));
  if(endpoint.endsWith('/pulls/113')) response=state.pullRequest;
  else if(endpoint.endsWith('/commits/1.0.1')) response={sha:state.sha};
  else if(endpoint.endsWith('/releases?per_page=100')) {
    if(!args.includes('--paginate')) throw new Error('Listing must paginate');
    response=state.ids.join('\\n');
  } else if(endpoint.endsWith('/releases/42')) {
    if(args.includes('--method')) {
      const patch=JSON.parse(fs.readFileSync(0,'utf8'));
      state.writes.push(patch);Object.assign(state.release,patch);
    }
    response=state.release;
  } else throw new Error('Unexpected endpoint (draft tag lookup returns 404): '+endpoint);
} else if(args[0]==='release'&&args[1]==='upload') {
  state.release.assets=args.slice(3,args.indexOf('--clobber')).map(file=>({name:path.basename(file),digest:'sha256:'+createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
} else throw new Error('Unexpected command');
fs.writeFileSync(file,JSON.stringify(state));
if(response!==undefined) console.log(typeof response==='string'?response:JSON.stringify(response));
`;

for (const scenario of ["normal", "recovery", "published", "ambiguous"]) {
  test(`publisher handles ${scenario} release through draft-aware lookup`, posixOnly, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "release-test-"));
    try {
      const gh = path.join(dir, "gh");
      await writeFile(gh, ghFixture);
      await chmod(gh, 0o755);
      await writeFile(path.join(dir, "checked-sha"), sha);
      const assets = { "main.js": "checked bundle", "manifest.json": '{"version":"1.0.1"}', "styles.css": "checked styles" };
      for (const [name, content] of Object.entries(assets)) await writeFile(path.join(dir, name), content);
      const stateFile = path.join(dir, "state.json");
      await writeFile(
        stateFile,
        JSON.stringify({
          sha,
          pullRequest,
          ids: scenario === "ambiguous" ? [42, 43] : [42],
          writes: [],
          release: { id: 42, tag_name: "1.0.1", draft: scenario !== "published", body: "generated", assets: [] },
        }),
      );
      const result = spawnSync(process.execPath, ["scripts/release/publish.mjs"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}${path.delimiter}${process.env.PATH}`,
          RELEASE_TEST_STATE: stateFile,
          TAG: "1.0.1",
          CHECKED_SHA: sha,
          ASSET_DIR: dir,
          GITHUB_REPOSITORY: repository,
          RELEASE_PR_JSON: JSON.stringify(pullRequest),
          RECOVERY_PR: scenario === "recovery" ? "113" : "",
        },
      });
      const state = JSON.parse(await readFile(stateFile, "utf8"));
      if (scenario === "normal" || scenario === "recovery") {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(state.release.body, body);
        assert.equal(state.release.draft, false);
        assert.deepEqual(
          state.release.assets,
          Object.entries(assets).map(([name, content]) => ({
            name,
            digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
          })),
        );
      } else {
        assert.notEqual(result.status, 0);
        assert.deepEqual(state.writes, []);
        assert.deepEqual(state.release.assets, []);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("recovery accepts only an existing ancestral tag dispatched from main", posixOnly, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recovery-test-"));
  try {
    const workflow = await readFile(".github/workflows/check.yml", "utf8");
    const block = workflow.split("- name: Validate explicit recovery target")[1].split("- name: Verify workflow dependencies")[0];
    const script = block
      .split("run: |\n")[1]
      .split("\n")
      .map((line) => line.slice(10))
      .join("\n");
    const git = (...args) => {
      const result = spawnSync("git", ["-c", "user.name=Release test", "-c", "user.email=test@example.invalid", ...args], {
        cwd: dir,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git("init");
    git("commit", "--allow-empty", "-m", "initial");
    git("tag", "1.0.0");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("commit", "--allow-empty", "-m", "unmerged");
    git("tag", "2.0.0");
    for (const [head, tag, ref, succeeds] of [
      ["1.0.0", "1.0.0", "refs/heads/main", true],
      ["1.0.0", "1.0.0", "refs/heads/other", false],
      ["1.0.0", "2.0.0", "refs/heads/main", false],
      ["2.0.0", "2.0.0", "refs/heads/main", false],
    ]) {
      git("checkout", "--detach", head);
      const result = spawnSync("bash", ["-e", "-c", script], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, TAG: tag, GITHUB_REF: ref },
      });
      assert.equal(result.status === 0, succeeds, `${head}/${tag}/${ref}: ${result.stderr}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recovery provenance distinguishes the tagged source from the repaired workflow", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "provenance-test-"));
  try {
    const workflowSha = "b".repeat(40);
    const result = spawnSync(process.execPath, ["scripts/release/provenance.mjs"], {
      encoding: "utf8",
      env: {
        ...process.env,
        RUNNER_TEMP: dir,
        GITHUB_REPOSITORY: repository,
        GITHUB_SHA: workflowSha,
        CHECKED_SHA: sha,
        TAG: "1.0.1",
        RECOVERY_PR: "113",
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "2",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const predicate = JSON.parse(await readFile(path.join(dir, "recovery-provenance.json"), "utf8"));
    assert.deepEqual(predicate.buildDefinition.externalParameters.inputs, { tag: "1.0.1", release_pr: "113" });
    assert.deepEqual(predicate.buildDefinition.resolvedDependencies, [
      { uri: "git+https://github.com/owner/repo@refs/tags/1.0.1", digest: { gitCommit: sha } },
      { uri: "git+https://github.com/owner/repo@refs/heads/main", digest: { gitCommit: workflowSha } },
    ]);
    assert.equal(predicate.runDetails.builder.id, "https://github.com/owner/repo/.github/workflows/check.yml@refs/heads/main");
    assert.equal(predicate.runDetails.metadata.invocationId, "https://github.com/owner/repo/actions/runs/123/attempts/2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
