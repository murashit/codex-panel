import { writeFile } from "node:fs/promises";
import path from "node:path";

const { GITHUB_REPOSITORY: repository, GITHUB_SHA: workflowSha, CHECKED_SHA: sourceSha, TAG: tag } = process.env;
const repositoryUrl = `https://github.com/${repository}`;
// The repaired main workflow is the builder; the immutable tag is the source.
const predicate = {
  buildDefinition: {
    buildType: "https://actions.github.io/buildtypes/workflow/v1",
    externalParameters: {
      workflow: { ref: "refs/heads/main", repository: repositoryUrl, path: ".github/workflows/check.yml" },
      inputs: { tag, release_pr: process.env.RECOVERY_PR },
    },
    internalParameters: {},
    resolvedDependencies: [
      { uri: `git+${repositoryUrl}@refs/tags/${tag}`, digest: { gitCommit: sourceSha } },
      { uri: `git+${repositoryUrl}@refs/heads/main`, digest: { gitCommit: workflowSha } },
    ],
  },
  runDetails: {
    builder: { id: `${repositoryUrl}/.github/workflows/check.yml@refs/heads/main` },
    metadata: { invocationId: `${repositoryUrl}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}` },
  },
};
await writeFile(path.join(process.env.RUNNER_TEMP, "recovery-provenance.json"), JSON.stringify(predicate));
