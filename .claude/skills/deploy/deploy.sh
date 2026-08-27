#!/usr/bin/env bash
# deploy.sh — deploy changed Catalyst targets, verify them live, then push unpushed commits.
#
# Usage:
#   deploy.sh                       detect changed targets (vs origin/main + working tree), deploy, push
#   deploy.sh --only functions:task_manager,client
#   deploy.sh --all                 deploy every target in catalyst.json
#   deploy.sh --no-push             deploy only
#   deploy.sh --no-deploy           push only
#   deploy.sh --dry-run             show what would happen
#
# Never force-pushes. Never commits your working-tree changes (except the client-package.json
# version bump it makes itself, which it commits so the pushed history matches what's live).

set -euo pipefail

ONLY=""; ALL=0; DO_PUSH=1; DO_DEPLOY=1; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --all) ALL=1; shift ;;
    --no-push) DO_PUSH=0; shift ;;
    --no-deploy) DO_DEPLOY=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_URL="https://wsm-security-60073792083.development.catalystserverless.in"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SSH_REMOTE="git@github.com:praveenkumar-pv-8915/wsm_security.git"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[31mxx %s\033[0m\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

command -v catalyst >/dev/null || die "catalyst CLI not found on PATH (this must run on the Mac with zcatalyst-cli installed)"

# ---------------------------------------------------------------- git / ssh prep
say "Loading SSH key from Keychain and fetching origin"
ssh-add --apple-load-keychain >/dev/null 2>&1 || warn "ssh-add --apple-load-keychain failed; push may prompt or fail"
if [ "$(git remote get-url origin)" != "$SSH_REMOTE" ]; then
  warn "origin is not the SSH URL; switching to $SSH_REMOTE (HTTPS push has no credentials on this Mac)"
  run git remote set-url origin "$SSH_REMOTE"
fi
git fetch origin "$BRANCH" 2>&1 | tail -1 || die "git fetch failed — check SSH access"

AHEAD=$(git rev-list --count "origin/$BRANCH..$BRANCH")
BEHIND=$(git rev-list --count "$BRANCH..origin/$BRANCH")
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
echo "branch=$BRANCH ahead=$AHEAD behind=$BEHIND dirty_paths=$DIRTY"

# ---------------------------------------------------------------- detect targets
CONFIGURED_FUNCS=$(node -e 'console.log((require("./catalyst.json").functions.targets||[]).join(" "))')

if [ -n "$ONLY" ]; then
  TARGETS="$ONLY"
elif [ "$ALL" = 1 ]; then
  TARGETS="client"
  for f in $CONFIGURED_FUNCS; do TARGETS="$TARGETS,functions:$f"; done
else
  # union of: paths changed in unpushed commits + paths changed/untracked in the working tree
  CHANGED=$( { git diff --name-only "origin/$BRANCH...$BRANCH"; git status --porcelain | awk '{print $NF}'; } | sort -u )
  TARGETS=""
  for f in $CONFIGURED_FUNCS; do
    if echo "$CHANGED" | grep -q "^functions/$f/"; then TARGETS="${TARGETS:+$TARGETS,}functions:$f"; fi
  done
  if echo "$CHANGED" | grep -Ev '^frontend/dist/' | grep -q '^frontend/'; then TARGETS="${TARGETS:+$TARGETS,}client"; fi
fi

if [ "$DO_DEPLOY" = 1 ] && [ -z "$TARGETS" ]; then
  warn "No changed Catalyst targets detected (functions/<name>/ or frontend/). Use --only or --all to force."
  DO_DEPLOY=0
fi

# ---------------------------------------------------------------- deploy
if [ "$DO_DEPLOY" = 1 ]; then
  say "Deploy targets: $TARGETS"
  [ "$DIRTY" -gt 0 ] && warn "Working tree has uncommitted changes — the deploy uses the working tree, so what goes live may differ from what gets pushed."

  IFS=',' read -ra TLIST <<< "$TARGETS"
  FUNCS_TO_VERIFY=()
  for t in "${TLIST[@]}"; do
    case "$t" in
      functions:*)
        fn="${t#functions:}"
        dir="functions/$fn"
        [ -d "$dir" ] || die "no such function dir: $dir"
        echo "$CONFIGURED_FUNCS" | tr ' ' '\n' | grep -qx "$fn" || die "$fn is not in catalyst.json functions.targets"
        if [ -f "$dir/package.json" ] && [ ! -d "$dir/node_modules" ]; then
          say "npm install in $dir"
          run bash -c "cd '$dir' && npm install --no-audit --no-fund >/dev/null"
        fi
        for js in "$dir"/*.js; do [ -f "$js" ] && node --check "$js"; done
        if [ "$fn" = "welcome" ] && ! grep -q CRED_ENC_KEY "$dir/catalyst-config.json"; then
          warn "welcome/catalyst-config.json has no CRED_ENC_KEY — the vault master key would NOT be deployed. Aborting."
          exit 1
        fi
        FUNCS_TO_VERIFY+=("$fn")
        ;;
      client)
        say "Building frontend client"
        CP="frontend/public/client-package.json"
        cur=$(node -e "console.log(require('./$CP').version)")
        new=$(echo "$cur" | awk -F. '{printf "%d.%d.%d", $1, $2, $3+1}')
        echo "bumping client-package.json version $cur -> $new (Catalyst requires a strictly increasing version)"
        if [ "$DRY" = 0 ]; then
          node -e "const fs=require('fs');const p='./$CP';const j=require(p);j.version='$new';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
          [ -d frontend/node_modules ] || (cd frontend && npm install --no-audit --no-fund >/dev/null)
          (cd frontend && npm run build >/dev/null)
          [ -f frontend/dist/client-package.json ] || die "frontend/dist/client-package.json missing after build"
          git add "$CP"
          git commit -q -m "chore: bump client-package.json to $new for client deploy" -- "$CP"
        fi
        ;;
      *) die "unsupported target '$t' (use functions:<name> or client)" ;;
    esac
  done

  say "catalyst deploy --only $TARGETS"
  run catalyst deploy --only "$TARGETS"

  if [ "$DRY" = 0 ]; then
    say "Verifying live endpoints"
    for fn in "${FUNCS_TO_VERIFY[@]:-}"; do
      [ -n "$fn" ] || continue
      for path in "/server/$fn/health" "/server/$fn/"; do
        code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$BASE_URL$path" || echo "000")
        echo "  GET $path -> HTTP $code"
      done
    done
    if [[ ",$TARGETS," == *",client,"* ]]; then
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$BASE_URL/app/index.html" || echo "000")
      echo "  GET /app/index.html -> HTTP $code"
    fi
    echo "  (401 on non-health routes is expected: they sit behind Catalyst user auth; 404/5xx is not)"
  fi
fi

# ---------------------------------------------------------------- push
if [ "$DO_PUSH" = 1 ]; then
  AHEAD=$(git rev-list --count "origin/$BRANCH..$BRANCH")
  say "Push: $AHEAD unpushed commit(s) on $BRANCH"
  if [ "$BEHIND" -gt 0 ]; then
    die "origin/$BRANCH has $BEHIND commit(s) not in local. Not pushing (would need a force). Inspect with: git log $BRANCH..origin/$BRANCH"
  fi
  if [ "$AHEAD" -eq 0 ]; then
    echo "nothing to push"
  else
    git log --oneline "origin/$BRANCH..$BRANCH"
    run git push origin "$BRANCH"
  fi
  [ "$DIRTY" -gt 0 ] && warn "Uncommitted/untracked paths were NOT pushed:" && git status --short
fi

say "Done"
