#!/usr/bin/env bash
# Lumberjack Release Helper
# ---------------------------------------------------------------------------
# Usage:
#   scripts/release.sh <version>
#
# Examples:
#   scripts/release.sh 1.0.16              # Stable
#   scripts/release.sh 1.1.0-beta.1        # Pre-Release (Beta)
#   scripts/release.sh 1.1.0-rc.1          # Release Candidate
#
# What it does:
#   1. Sanity checks (clean working tree, on main, up to date with origin)
#   2. SemVer validation; warns if a stable release contains commits never
#      shipped in a prior beta/rc
#   3. Bumps version in package.json + release/app/package.json
#   4. Regenerates CHANGELOG.md via git-cliff
#      (stable releases aggregate all intermediate beta/rc tags into one block)
#   5. Commits the bump + changelog
#   6. Creates an annotated tag vX.Y.Z[-pre.N]
#   7. Pushes branch + tag together in a single atomic push
#   8. Prints links to GitHub Actions / Releases
# ---------------------------------------------------------------------------

set -euo pipefail

# ---------- helpers ---------------------------------------------------------
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
blue()   { printf "\033[34m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n" "$*"; }

die() { red "❌ $*"; exit 1; }

confirm() {
  local prompt="${1:-Continue?}"
  read -r -p "$(yellow "$prompt [y/N] ")" reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "Aborted by user."
}

# ---------- args ------------------------------------------------------------
if [[ $# -lt 1 ]]; then
  die "Usage: $0 <version>   (e.g. 1.0.16  or  1.1.0-beta.1)"
fi

VERSION="$1"
TAG="v${VERSION}"

# Validate SemVer (incl. pre-release identifier)
SEMVER_REGEX='^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$'
if ! [[ "$VERSION" =~ $SEMVER_REGEX ]]; then
  die "Invalid version '$VERSION'. Expected: X.Y.Z or X.Y.Z-(alpha|beta|rc).N"
fi

IS_PRERELEASE="false"
[[ "$VERSION" == *-* ]] && IS_PRERELEASE="true"

bold "════════════════════════════════════════════════════════"
bold "  Lumberjack Release: $TAG ($( [[ "$IS_PRERELEASE" == "true" ]] && echo "Pre-Release" || echo "Stable" ))"
bold "════════════════════════════════════════════════════════"

# ---------- repo dir --------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---------- sanity checks ---------------------------------------------------
blue "▶ Sanity checks…"

# 1) git available
echo "  • Checking required tools…"
command -v git >/dev/null || die "git not found"
command -v node >/dev/null || die "node not found"
command -v npm  >/dev/null || die "npm not found"
green "  ✓ Required tools found"

# 2) on branch main
echo "  • Checking current branch…"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  yellow "  ⚠ You are on branch '$CURRENT_BRANCH' (not 'main')."
  confirm "  Release from this branch anyway?"
fi

# 3) clean working tree
echo "  • Checking working tree…"
if [[ -n "$(git status --porcelain)" ]]; then
  red "  ❌ Working tree has uncommitted changes:"
  git status --short
  die "Commit or stash changes before releasing."
fi

# 4) not behind origin
#    Being AHEAD of origin is fine — the atomic push at the end ships those
#    commits together with the tag, so there is no need to push them first.
#    Only abort if the branch is BEHIND (diverged), which would require a pull.
echo "  • Fetching tags from origin (authentication may be required)…"
git fetch origin --tags --verbose
REMOTE="$(git rev-parse "@{u}" 2>/dev/null || echo "")"
if [[ -n "$REMOTE" ]]; then
  echo "  • Comparing local branch with upstream…"
  BEHIND="$(git rev-list --count '@..@{u}')"
  AHEAD="$(git rev-list --count '@{u}..@')"
  if [[ "$BEHIND" -gt 0 ]]; then
    die "Your branch is $BEHIND commit(s) behind origin. Pull first."
  fi
  if [[ "$AHEAD" -gt 0 ]]; then
    yellow "  ⚠ $AHEAD local commit(s) not yet on origin — they will be pushed with the tag."
  fi
fi

# 5) tag must not already exist (local or remote)
echo "  • Checking whether tag $TAG is available locally…"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  die "Tag $TAG already exists locally. Delete with: git tag -d $TAG"
fi
echo "  • Checking whether tag $TAG is available on origin…"
if git ls-remote --tags origin "$TAG" | grep -q "$TAG"; then
  die "Tag $TAG already exists on origin. Choose a different version."
fi

green "  ✓ Clean working tree on '$CURRENT_BRANCH', not behind origin, tag is free"

# ---------- best-practice warning for stable releases -----------------------
if [[ "$IS_PRERELEASE" == "false" ]]; then
  blue "▶ Checking unreleased commits…"

  # Last pre-release tag for this major.minor.patch (e.g. v1.0.16-rc.1)
  LAST_PRE="$(git tag --sort=-version:refname \
    | grep -E "^v${VERSION}-(beta|rc|alpha)\.[0-9]+$" \
    | head -n 1 || true)"

  # Last pre-release tag of any kind since the last stable
  LAST_STABLE="$(git tag --sort=-version:refname \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | head -n 1 || true)"

  if [[ -n "$LAST_PRE" ]]; then
    NEW_COMMITS="$(git log "$LAST_PRE..HEAD" --pretty=format:'  - %s' \
      | grep -vE '^\s*-\s*chore: (bump version|release)|\[skip[- ]ci\]' || true)"
    if [[ -n "$NEW_COMMITS" ]]; then
      yellow "  ⚠ Commits in HEAD that were NOT in the last pre-release ($LAST_PRE):"
      echo "$NEW_COMMITS"
      echo
      yellow "  Best practice: cut an RC (e.g. ${VERSION}-rc.1) first and test it."
      confirm "  Proceed with stable release anyway?"
    else
      green "  ✓ HEAD matches the last pre-release ($LAST_PRE) — safe to promote"
    fi
  elif [[ -n "$LAST_STABLE" ]]; then
    yellow "  ⚠ No pre-release found for ${VERSION}. Going straight to stable."
    yellow "  Commits since $LAST_STABLE:"
    git log "$LAST_STABLE..HEAD" --pretty=format:'  - %s' \
      | grep -vE '^\s*-\s*chore: (bump version|release)|\[skip[- ]ci\]' || echo "  (none)"
    echo
    confirm "  Proceed without a beta/rc?"
  fi
fi

# ---------- bump version ----------------------------------------------------
blue "▶ Bumping package.json to ${VERSION}…"
npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
green "  ✓ package.json updated"

# release/app/package.json (separate manifest used by electron-builder)
if [[ -f release/app/package.json ]]; then
  node -e "
    const fs = require('fs');
    const p = 'release/app/package.json';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.version = '$VERSION';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  "
  green "  ✓ release/app/package.json updated"
fi

# ---------- changelog -------------------------------------------------------
blue "▶ Regenerating CHANGELOG.md (git-cliff)…"
# Tag the upcoming version so git-cliff renders the next block as $TAG.
if [[ "$IS_PRERELEASE" == "false" ]]; then
  # Stable release: collapse all intermediate pre-release tags (beta/rc/alpha)
  # into a single combined block so the changelog shows ALL changes since the
  # previous full release — not just the commits since the last beta/rc.
  npx --no-install git-cliff --config cliff.toml --tag "$TAG" \
    --ignore-tags '.*-(alpha|beta|rc)\.' --output CHANGELOG.md
  green "  ✓ CHANGELOG.md generated (pre-releases aggregated into $TAG)"
else
  # Pre-release: keep its own dedicated changelog block.
  npx --no-install git-cliff --config cliff.toml --tag "$TAG" --output CHANGELOG.md
  green "  ✓ CHANGELOG.md generated"
fi

# ---------- commit + tag ----------------------------------------------------
blue "▶ Committing & tagging…"
git add package.json package-lock.json CHANGELOG.md release/app/package.json 2>/dev/null || true
# Only commit if there's something staged
if ! git diff --cached --quiet; then
  git commit -m "chore: release $VERSION"
  green "  ✓ Commit created"
else
  yellow "  ⚠ Nothing to commit (version/changelog already up to date)"
fi

git tag -a "$TAG" -m "Release $VERSION"
green "  ✓ Annotated tag $TAG created"

# ---------- push ------------------------------------------------------------
blue "▶ Pushing to origin…"
echo
bold "About to push:"
echo "  - $CURRENT_BRANCH → origin/$CURRENT_BRANCH"
echo "  - $TAG → origin/$TAG"
echo
confirm "Push now?"

# Atomic push: branch and tag land together (or neither). This avoids the
# half-pushed state where the tag arrives — triggering the release build —
# before the release commit is on the branch, and vice versa.
git push --atomic origin "$CURRENT_BRANCH" "refs/tags/$TAG"
green "  ✓ Pushed branch and tag (atomic)"

# ---------- done ------------------------------------------------------------
REPO_URL="$(git config --get remote.origin.url \
  | sed -E 's#git@github\.com:#https://github.com/#' \
  | sed -E 's#\.git$##')"

echo
bold "════════════════════════════════════════════════════════"
green " ✅ Release $TAG triggered!"
bold "════════════════════════════════════════════════════════"
echo
echo "  Actions:  $REPO_URL/actions"
echo "  Releases: $REPO_URL/releases/tag/$TAG"
echo
yellow "Watch the pipeline; the draft release will be published automatically"
yellow "once 'finalize-release' completes."

