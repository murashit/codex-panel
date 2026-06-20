export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function isExpectedNextVersion(previous, current) {
  if (current.major === previous.major && current.minor === previous.minor) {
    return current.patch === previous.patch + 1;
  }
  if (current.major === previous.major && current.minor === previous.minor + 1) {
    return current.patch === 0;
  }
  if (current.major === previous.major + 1) {
    return current.minor === 0 && current.patch === 0;
  }
  return false;
}
