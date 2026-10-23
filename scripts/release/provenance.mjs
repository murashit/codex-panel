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
    },
    internalParameters: {
      github: {
        event_name: process.env.GITHUB_EVENT_NAME,
        repository_id: process.env.GITHUB_REPOSITORY_ID,
        repository_owner_id: process.env.GITHUB_REPOSITORY_OWNER_ID,
        runner_environment: process.env.RUNNER_ENVIRONMENT,
      },
    },
    // GitHub validates the first dependency against the signing workflow context.
    // Keep the separately checked build source as an additional dependency.
    resolvedDependencies: [
      { uri: `git+${repositoryUrl}@refs/heads/main`, digest: { gitCommit: workflowSha } },
      { uri: `git+${repositoryUrl}@refs/tags/${tag}`, digest: { gitCommit: sourceSha } },
    ],
  },
  runDetails: {
    builder: { id: `${repositoryUrl}/.github/workflows/check.yml@refs/heads/main` },
    metadata: { invocationId: `${repositoryUrl}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}` },
  },
};
await writeFile(path.join(process.env.RUNNER_TEMP, "recovery-provenance.json"), JSON.stringify(predicate));
