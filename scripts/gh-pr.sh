#!/usr/bin/env bash
# Pull requests through GitHub's REST API. In claude.ai/code sessions the GitHub proxy blocks
# GraphQL, so `gh pr create` and `gh pr checks` fail there; `gh api` REST calls work.
#   scripts/gh-pr.sh create "<title>" <body-file> [base]   prints the PR URL (reuses an open PR for this branch)
#   scripts/gh-pr.sh checks [sha]                          lists check runs for a commit (default HEAD)
set -euo pipefail
repo=$(git remote get-url origin | sed -E 's#\.git$##' | awk -F'[/:]' '{print $(NF-1)"/"$NF}')

case "${1:-}" in
  create)
    title=${2:?title}; body=${3:?body file}; base=${4:-main}
    head=$(git rev-parse --abbrev-ref HEAD)
    existing=$(gh api "repos/$repo/pulls?head=${repo%%/*}:$head&state=open" --jq '.[0].html_url // empty')
    if [ -n "$existing" ]; then echo "$existing"; exit 0; fi
    gh api "repos/$repo/pulls" -f title="$title" -f head="$head" -f base="$base" -F body=@"$body" --jq .html_url ;;
  checks)
    sha=${2:-$(git rev-parse HEAD)}
    gh api "repos/$repo/commits/$sha/check-runs" \
      --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion // "pending")\t\(.html_url)"' ;;
  *) echo 'usage: scripts/gh-pr.sh create "<title>" <body-file> [base] | checks [sha]'; exit 1 ;;
esac
