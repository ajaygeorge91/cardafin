// Single source of truth for the version reported by the HTTP health check.
// Kept as a constant rather than read from package.json at startup — one
// fewer file read on the hot path, and no risk of resolving a path relative
// to the wrong cwd. Bump this by hand alongside package.json's "version".

export const VERSION = "0.1.0";
