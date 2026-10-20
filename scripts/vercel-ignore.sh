#!/bin/bash
# Vercel Ignored Build Step. Exit 1 = build, exit 0 = skip.
# Runs from apps/web (the Vercel root directory).

# Production (main) always builds.
if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then
  exit 1
fi

# Skip when the last commit touched nothing the site depends on.
if git diff --quiet HEAD^ HEAD -- . ../../packages ../../package-lock.json 2>/dev/null; then
  echo "No web-related changes, skipping preview."
  exit 0
fi

# Not a PR build: skip.
if [ -z "$VERCEL_GIT_PULL_REQUEST_ID" ]; then
  echo "Not a pull request, skipping preview."
  exit 0
fi

# Build only when the PR carries the "preview" label.
AUTH=()
[ -n "$GITHUB_TOKEN" ] && AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")
LABELS=$(curl -sf "${AUTH[@]}" \
  "https://api.github.com/repos/prsurve/manifestlens/issues/$VERCEL_GIT_PULL_REQUEST_ID/labels")

if echo "$LABELS" | grep -q '"name": *"preview"'; then
  echo "PR has the preview label, building."
  exit 1
fi

echo "PR has no preview label, skipping."
exit 0
