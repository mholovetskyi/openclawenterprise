// Discovers git repository roots by walking ancestor directories.
import fs from "node:fs";
import path from "node:path";

const DEFAULT_GIT_DISCOVERY_MAX_DEPTH = 12;

function walkUpFrom<T>(
  startDir: string,
  opts: { maxDepth?: number },
  resolveAtDir: (dir: string) => T | null | undefined,
): T | null {
  let current = path.resolve(startDir);
  const maxDepth = opts.maxDepth ?? DEFAULT_GIT_DISCOVERY_MAX_DEPTH;
  for (let i = 0; i < maxDepth; i += 1) {
    const resolved = resolveAtDir(current);
    if (resolved !== null && resolved !== undefined) {
      return resolved;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function hasGitMarker(repoRoot: string): boolean {
  const gitPath = path.join(repoRoot, ".git");
  try {
    fs.readFileSync(gitPath);
    return true;
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
    // EISDIR means .git is a directory (normal full clone) — still a valid marker.
    if (code === "EISDIR") {
      return true;
    }
    return false;
  }
}

export function findGitRoot(startDir: string, opts: { maxDepth?: number } = {}): string | null {
  // A `.git` file counts as a repo marker even if it is not a valid gitdir pointer.
  return walkUpFrom(startDir, opts, (repoRoot) => (hasGitMarker(repoRoot) ? repoRoot : null));
}

function resolveGitDirFromMarker(repoRoot: string): string | null {
  const gitPath = path.join(repoRoot, ".git");
  let raw: string;
  try {
    raw = fs.readFileSync(gitPath, "utf-8");
  } catch (err) {
    // If .git is a directory (normal full clone), it IS the git dir.
    const code = typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
    if (code === "EISDIR") {
      return gitPath;
    }
    return null;
  }
  const match = raw.match(/gitdir:\s*(.+)/i);
  if (!match?.[1]) {
    return null;
  }
  return path.resolve(repoRoot, match[1].trim());
}

export function resolveGitHeadPath(
  startDir: string,
  opts: { maxDepth?: number } = {},
): string | null {
  // Stricter than findGitRoot: keep walking until a resolvable git dir is found.
  return walkUpFrom(startDir, opts, (repoRoot) => {
    const gitDir = resolveGitDirFromMarker(repoRoot);
    return gitDir ? path.join(gitDir, "HEAD") : null;
  });
}
