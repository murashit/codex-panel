const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function parseVersion(version) {
  if (typeof version !== "string") return null;
  const match = versionPattern.exec(version);
  return match ? match.slice(1).map(BigInt) : null;
}
export function compareVersions(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}
