// Temporary bridge for Stryker 10 + Vitest 5. Stryker records space-joined
// test IDs, but Vitest 5 filters on names joined with " > ". Remove this
// plugin and restore testRunner: "vitest" once the upstream fix is released:
// https://github.com/stryker-mutator/stryker-js/issues/6210
// https://github.com/stryker-mutator/stryker-js/pull/6214
import fs from "node:fs/promises";
import { strykerPlugins as vitestPlugins } from "@stryker-mutator/vitest-runner";

const TEST_NAMES_FILE = ".stryker-vitest5-test-names.json";
const INCOMPLETE_RUN_RETRIES = 3;
const SUCCEEDED_TEST_STATUS = 0; // @stryker-mutator/api TestStatus.Success
const FAILED_TEST_STATUS = 1; // @stryker-mutator/api TestStatus.Failed
const upstream = vitestPlugins.find((plugin) => plugin.name === "vitest");
if (!upstream) throw new Error("Stryker's Vitest runner is unavailable.");

function createVitest5Runner(injector) {
  const runner = upstream.factory(injector);
  const init = runner.init.bind(runner);
  const dryRun = runner.dryRun.bind(runner);
  const run = runner.run.bind(runner);
  let testNames;

  runner.dryRun = async (options) => {
    const result = await dryRun(options);
    if (result.status !== "complete") return result;

    // Match the task order used by Stryker's Vitest runner to produce result.tests.
    const tasks = runner.ctx.state
      .getFiles()
      .flatMap(collectTests)
      .filter((task) => task.result);
    if (tasks.length !== result.tests.length) throw new Error("Vitest dry run returned an unexpected number of tests.");
    testNames = new Map();
    const duplicates = new Set();
    tasks.forEach((task, index) => {
      const id = result.tests[index].id;
      if (result.tests[index].name !== legacyTestName(task)) {
        throw new Error(`Vitest dry run reordered test ${id}`);
      }
      if (!task.fullTestName) throw new Error(`Vitest did not name test ${id}`);
      if (testNames.has(id)) duplicates.add(id);
      testNames.set(id, task.fullTestName);
    });
    if (duplicates.size) throw new Error(`Duplicate Stryker test IDs:\n${[...duplicates].join("\n")}`);
    // The dry run and mutant runs use separate workers in the same sandbox.
    await fs.writeFile(TEST_NAMES_FILE, JSON.stringify([...testNames]));
    return result;
  };

  runner.run = async (options = {}) => {
    const selectedTestIds = options.testIds ?? [];
    if (selectedTestIds.length) {
      if (!testNames) {
        const entries = JSON.parse(await fs.readFile(TEST_NAMES_FILE, "utf8"));
        testNames = new Map(entries);
      }
      // Preserve Stryker's coverage and result IDs; translate only the filter.
      const testIds = selectedTestIds.map((id) => {
        const name = testNames.get(id);
        if (!name) throw new Error(`No Vitest test name found for ${id}`);
        const file = id.slice(0, id.indexOf("#"));
        return `${file}#${name}`;
      });
      options = { ...options, testIds };
    }
    // Vitest's bail can lose a failing result under load. A surviving mutant
    // must report every selected test; otherwise retry before trusting it.
    // See https://github.com/stryker-mutator/stryker-js/pull/6146.
    let missing = [];
    for (let attempt = 0; attempt <= INCOMPLETE_RUN_RETRIES; attempt++) {
      const result = await run(options);
      if (!selectedTestIds.length || result.status !== "complete") return result;
      const completed = new Set(result.tests.filter((test) => test.status === SUCCEEDED_TEST_STATUS).map((test) => test.id));
      missing = selectedTestIds.filter((id) => !completed.has(id));
      if (result.tests.some((test) => test.status === FAILED_TEST_STATUS) || missing.length === 0) {
        return result;
      }
    }
    throw new Error(`Vitest did not complete ${missing.length} selected tests after retries.`);
  };
  runner.init = async () => {
    await init();
    const start = runner.ctx.start.bind(runner.ctx);
    runner.ctx.start = (files) => {
      for (const project of runner.ctx.projects) {
        const pattern = project.config.testNamePattern;
        if (pattern instanceof RegExp) {
          // The upstream filter is unanchored and can select similarly named tests.
          project.config.testNamePattern = new RegExp(`^(?:${pattern.source})$`);
        }
      }
      return start(files);
    };
  };
  return runner;
}
createVitest5Runner.inject = upstream.factory.inject;

export const strykerPlugins = [{ ...upstream, name: "vitest5", factory: createVitest5Runner }];

function collectTests(suite) {
  return suite.tasks.flatMap((task) => {
    if (task.type === "suite") return collectTests(task);
    return task.type === "test" ? [task] : [];
  });
}

function legacyTestName(task) {
  const names = [task.name];
  for (let suite = task.suite; suite; suite = suite.suite) names.unshift(suite.name);
  return names.join(" ").trim();
}
