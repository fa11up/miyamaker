#!/usr/bin/env bash
# Deploy miyamints from a release checkout only, and record what was deployed.
#
#   script/deploy.sh [forge script args...]        e.g. --rpc-url ... --account miyamints-deployer --sender 0x... --broadcast --verify
#   DEPLOY_TAG=v1.0.0 script/deploy.sh ...          deploy a release tag instead of main (HEAD must be exactly that tag)
#   DEPLOY_SCRIPT=script/DeployMiyaPoolV2.s.sol script/deploy.sh ...   only the v2 pool factory, next to a live system
#
# Refuses unless:
#   - the whole repo is clean (no staged, unstaged or untracked files; ignored files are fine),
#   - submodules are checked out at the commits the repo records,
#   - HEAD is `main` and equals origin/main (after a fetch), or HEAD is exactly the tag in DEPLOY_TAG.
# Then runs DEPLOY_SCRIPT (default script/DeployMiyamints.s.sol) with FOUNDRY_PROFILE=deploy and DEPLOY_GIT_COMMIT /
# DEPLOY_GIT_REF set; the scripts refuse to broadcast without DEPLOY_GIT_COMMIT and record it in deployments/<chainId>.json.
set -euo pipefail

cd "$(dirname "$0")/.."            # contracts/
ROOT="$(git rev-parse --show-toplevel)"

die() { echo "deploy.sh: $*" >&2; exit 1; }

if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=normal)" ]; then
  git -C "$ROOT" status --short >&2
  die "working tree is not clean: commit or remove these first"
fi

if git -C "$ROOT" submodule status --recursive | grep -qE '^[-+U]'; then
  git -C "$ROOT" submodule status --recursive | grep -E '^[-+U]' >&2
  die "submodules are missing or not at the recorded commits: git submodule update --init --recursive"
fi

COMMIT="$(git rev-parse HEAD)"
if [ -n "${DEPLOY_TAG:-}" ]; then
  TAG_COMMIT="$(git rev-parse -q --verify "refs/tags/${DEPLOY_TAG}^{commit}")" || die "no tag ${DEPLOY_TAG}"
  [ "$TAG_COMMIT" = "$COMMIT" ] || die "HEAD ${COMMIT} is not tag ${DEPLOY_TAG} (${TAG_COMMIT}): git checkout ${DEPLOY_TAG}"
  REF="$DEPLOY_TAG"
else
  BRANCH="$(git symbolic-ref --short -q HEAD || true)"
  [ "$BRANCH" = "main" ] || die "deploy from main only (HEAD is '${BRANCH:-detached}'), or set DEPLOY_TAG to a release tag"
  git fetch -q origin main || die "could not fetch origin/main to confirm this is the released main"
  [ "$(git rev-parse origin/main)" = "$COMMIT" ] || die "local main ${COMMIT} != origin/main $(git rev-parse origin/main): pull or push first"
  REF="main"
fi

# A broadcast waits for each receipt (--slow): without it forge sends every transaction at once, and a revert in the
# middle still lets the later ones (ownership handoffs included) land on an incomplete system.
EXTRA=()
case " $* " in *" --broadcast "*) case " $* " in *" --slow "*) ;; *) EXTRA=(--slow) ;; esac ;; esac

echo "deploy.sh: deploying ${REF} @ ${COMMIT}"
export FOUNDRY_PROFILE=deploy DEPLOY_GIT_COMMIT="$COMMIT" DEPLOY_GIT_REF="$REF"
# DEPLOY_SCRIPT picks another script under the same checks (e.g. script/DeployMiyaPoolV2.s.sol).
SCRIPT="${DEPLOY_SCRIPT:-script/DeployMiyamints.s.sol}"
case "$SCRIPT" in script/DeployMiyamints.s.sol|script/DeployMiyaPoolV2.s.sol) ;; *) die "unknown DEPLOY_SCRIPT $SCRIPT" ;; esac
exec forge script "$SCRIPT" "$@" ${EXTRA[@]+"${EXTRA[@]}"}
