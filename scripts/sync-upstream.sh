#!/usr/bin/env bash
# sync-upstream.sh — Sync OpenClaw Enterprise with upstream openclaw/openclaw releases
#
# Usage:
#   ./scripts/sync-upstream.sh                  # Show status & missing releases
#   ./scripts/sync-upstream.sh --merge <tag>    # Merge a specific upstream tag
#
# Prerequisites:
#   - git remote 'upstream' pointing to openclaw/openclaw
#     (the script will add it automatically if missing)
set -euo pipefail

UPSTREAM_REMOTE="upstream"
UPSTREAM_REPO="https://github.com/openclaw/openclaw.git"
ENTERPRISE_VERSION=$(jq -r '.version' package.json)

# ── Ensure upstream remote exists ────────────────────────────────────────────
if ! git remote get-url "$UPSTREAM_REMOTE" &>/dev/null; then
  echo "Adding upstream remote: $UPSTREAM_REPO"
  git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_REPO"
fi

# ── Fetch upstream tags ──────────────────────────────────────────────────────
echo "Fetching upstream tags..."
git fetch "$UPSTREAM_REMOTE" --tags --force

# ── List missing releases ────────────────────────────────────────────────────
echo ""
echo "Enterprise version: v$ENTERPRISE_VERSION"
echo ""

MISSING_TAGS=()
for tag in $(git tag -l 'v20*' --sort=-version:refname); do
  ver="${tag#v}"
  # Skip pre-releases
  if echo "$ver" | grep -qiE '(alpha|beta|rc)'; then
    continue
  fi
  # Check if this version is newer than enterprise
  if [ "$(printf '%s\n%s' "$ENTERPRISE_VERSION" "$ver" | sort -V | tail -1)" = "$ver" ] && [ "$ver" != "$ENTERPRISE_VERSION" ]; then
    MISSING_TAGS+=("$tag")
  fi
done

if [ ${#MISSING_TAGS[@]} -eq 0 ]; then
  echo "Enterprise is up to date with upstream."
  exit 0
fi

echo "Missing upstream releases (oldest first):"
for ((i=${#MISSING_TAGS[@]}-1; i>=0; i--)); do
  echo "  - ${MISSING_TAGS[$i]}"
done
echo ""

# ── Merge mode ───────────────────────────────────────────────────────────────
if [ "${1:-}" = "--merge" ]; then
  TARGET_TAG="${2:-}"
  if [ -z "$TARGET_TAG" ]; then
    echo "Error: --merge requires a tag argument (e.g., v2026.3.23)"
    exit 1
  fi

  # Verify tag exists
  if ! git rev-parse "$TARGET_TAG" &>/dev/null; then
    echo "Error: tag '$TARGET_TAG' not found. Run the script without flags to see available tags."
    exit 1
  fi

  echo "Merging upstream $TARGET_TAG into current branch..."
  echo ""

  BRANCH=$(git branch --show-current)
  echo "Current branch: $BRANCH"
  echo ""

  # Attempt the merge — conflicts are expected and will need manual resolution
  if git merge "$TARGET_TAG" --no-edit -m "chore: merge upstream $TARGET_TAG into enterprise"; then
    echo ""
    echo "Merge successful! Next steps:"
    echo "  1. Update version in package.json to match upstream"
    echo "  2. Update CHANGELOG.md with upstream changes"
    echo "  3. Run: pnpm install"
    echo "  4. Run: pnpm test"
    echo "  5. Run: pnpm test:enterprise-e2e"
  else
    echo ""
    echo "Merge has conflicts. Please resolve them manually:"
    echo "  1. Fix conflicts in the listed files"
    echo "  2. git add <resolved files>"
    echo "  3. git merge --continue"
    echo "  4. Update version in package.json"
    echo "  5. Run: pnpm test && pnpm test:enterprise-e2e"
  fi

  exit 0
fi

# ── Default: just show status ────────────────────────────────────────────────
LATEST="${MISSING_TAGS[0]}"
echo "To merge the latest upstream release:"
echo "  ./scripts/sync-upstream.sh --merge $LATEST"
echo ""
echo "To merge releases incrementally (recommended):"
OLDEST="${MISSING_TAGS[${#MISSING_TAGS[@]}-1]}"
echo "  ./scripts/sync-upstream.sh --merge $OLDEST"
