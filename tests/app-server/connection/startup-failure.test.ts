import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { startupFailure } from "../../../src/app-server/connection/startup-failure";

it("distinguishes missing launch paths using filesystem evidence, not ENOENT alone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "panel-startup-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, "codex");
  const missingDirectory = join(directory, "missing");
  const error = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT", syscall: "spawn codex" });

  expect((await startupFailure(error, executable, directory)).reason).toBe("executable");
  await writeFile(executable, "");
  expect((await startupFailure(error, executable, missingDirectory)).reason).toBe("vault");
  expect((await startupFailure(error, "codex", directory)).reason).toBe("missingPath");
  // An existing executable can still fail to spawn, e.g. its interpreter is absent.
  expect((await startupFailure(error, executable, directory)).reason).toBe("missingPath");
});

it.each(["EACCES", "EPERM"])("describes %s without inferring an administrator policy", async (code) => {
  const error = Object.assign(new Error("private path"), { code });
  const failure = await startupFailure(error, "codex", "/vault");
  expect(failure.message).toContain("denied access");
  expect(failure.message).not.toContain("administrator");
  expect(failure.message).not.toContain("private path");
});
