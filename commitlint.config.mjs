export default {
  defaultIgnores: false,
  extends: ["@commitlint/config-conventional"],
  rules: {
    "subject-case": [0],
    "type-enum": [2, "always", ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "test"]],
  },
};
