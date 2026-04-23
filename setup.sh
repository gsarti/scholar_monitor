#!/usr/bin/env bash
# One-shot configuration for a fresh Scholar Monitor fork.
#
# Updates config.json, sets the SERPAPI_KEY secret, enables GitHub Pages with
# Actions as the source, and optionally triggers the first scrape run.
#
# Requires: gh (GitHub CLI) authenticated as the repo owner, python3, jq is optional.
# Run from the repo root:   ./setup.sh

set -euo pipefail

bold()   { printf "\033[1m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*" >&2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { red "Missing required command: $1"; exit 1; }
}

prompt() {
  local prompt_text="$1" default="${2:-}" reply
  if [[ -n "$default" ]]; then
    read -r -p "$prompt_text [$default]: " reply
    printf "%s" "${reply:-$default}"
  else
    read -r -p "$prompt_text: " reply
    printf "%s" "$reply"
  fi
}

prompt_secret() {
  local prompt_text="$1" reply
  read -r -s -p "$prompt_text: " reply
  echo >&2
  printf "%s" "$reply"
}

confirm() {
  local prompt_text="$1" default="${2:-y}" reply
  read -r -p "$prompt_text [$default]: " reply
  reply="${reply:-$default}"
  [[ "${reply,,}" == "y" || "${reply,,}" == "yes" ]]
}

require_cmd gh
require_cmd python3

if ! gh auth status >/dev/null 2>&1; then
  red "The 'gh' CLI is not authenticated. Run 'gh auth login' first."
  exit 1
fi

REPO_SLUG="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [[ -z "$REPO_SLUG" ]]; then
  red "Could not detect the GitHub repository. Are you in a cloned fork?"
  exit 1
fi
REPO_NAME="${REPO_SLUG#*/}"

bold "Scholar Monitor — fork setup"
echo "Repo: $REPO_SLUG"
echo

CURRENT_ID="$(python3 -c "import json; print(json.load(open('config.json')).get('scholar_id', ''))")"
CURRENT_NAME="$(python3 -c "import json; print(json.load(open('config.json')).get('display_name', ''))")"
CURRENT_BASE="$(python3 -c "import json; print(json.load(open('config.json')).get('base_path', ''))")"
CURRENT_DIGEST="$(python3 -c "import json; print(str(json.load(open('config.json')).get('weekly_digest', True)).lower())")"

SCHOLAR_ID="$(prompt 'Google Scholar ID (user= param in the profile URL)' "$CURRENT_ID")"
if [[ -z "$SCHOLAR_ID" ]]; then red "Scholar ID is required."; exit 1; fi

DISPLAY_NAME="$(prompt 'Display name (shown in the browser title)' "${CURRENT_NAME:-Scholar Monitor}")"
BASE_PATH="$(prompt 'Base path (leading slash; match your repo name)' "${CURRENT_BASE:-/$REPO_NAME}")"

if confirm 'Enable weekly citations digest GitHub Issue?' y; then
  WEEKLY_DIGEST=true
else
  WEEKLY_DIGEST=false
fi

python3 - "$SCHOLAR_ID" "$DISPLAY_NAME" "$BASE_PATH" "$WEEKLY_DIGEST" <<'PY'
import json, sys, pathlib
scholar_id, display_name, base_path, weekly = sys.argv[1:5]
path = pathlib.Path("config.json")
cfg = json.loads(path.read_text())
cfg["scholar_id"] = scholar_id
cfg["display_name"] = display_name
cfg["base_path"] = base_path
cfg["weekly_digest"] = weekly == "true"
path.write_text(json.dumps(cfg, indent=2) + "\n")
print("Wrote config.json")
PY

if confirm 'Set the SERPAPI_KEY secret now? (Get a free key at https://serpapi.com)' y; then
  SERPAPI_KEY="$(prompt_secret 'SerpAPI key')"
  if [[ -n "$SERPAPI_KEY" ]]; then
    gh secret set SERPAPI_KEY --body "$SERPAPI_KEY"
    green "Set SERPAPI_KEY secret on $REPO_SLUG."
  else
    yellow "No key entered; skipping."
  fi
fi

if confirm 'Enable GitHub Pages (source = GitHub Actions)?' y; then
  # Create Pages site if missing; update source otherwise. Both endpoints accept build_type.
  if gh api "repos/$REPO_SLUG/pages" --silent 2>/dev/null; then
    gh api -X PUT "repos/$REPO_SLUG/pages" -f "build_type=workflow" >/dev/null \
      && green "Pages source set to GitHub Actions."
  else
    gh api -X POST "repos/$REPO_SLUG/pages" -f "build_type=workflow" >/dev/null \
      && green "Pages site created, source = GitHub Actions."
  fi
fi

if confirm 'Commit config.json changes and push?' y; then
  git add config.json
  if ! git diff --staged --quiet; then
    git commit -m "config: initial fork setup"
    git push
    green "Pushed config.json."
  else
    yellow "No config changes to commit."
  fi
fi

if confirm 'Trigger the first scrape run now?' y; then
  gh workflow run scrape.yml >/dev/null && green "Scrape workflow dispatched. Check the Actions tab for progress."
fi

echo
bold "Done."
echo "Your site will deploy at: https://$(echo "$REPO_SLUG" | cut -d/ -f1).github.io${BASE_PATH}"
echo "If you're using a custom domain on your user site, it will also serve at <yourdomain>${BASE_PATH}."
