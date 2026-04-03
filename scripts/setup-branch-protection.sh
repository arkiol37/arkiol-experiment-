#!/usr/bin/env bash
# scripts/setup-branch-protection.sh
# ══════════════════════════════════════════════════════════════════════════════
# ARKIOL AI v11 — GitHub Branch Protection Setup
# ══════════════════════════════════════════════════════════════════════════════
#
# Applies mandatory branch protection rules to `main` so that:
#   1. Every merge requires the "CI Gate" check (all 6 CI jobs) to pass.
#   2. Vercel production deployments can only trigger after CI Gate passes.
#   3. Direct pushes to main are blocked — all changes must go through a PR.
#   4. At least one code review is required before merge.
#
# Usage:
#   export GITHUB_TOKEN=ghp_your_personal_access_token
#   export GITHUB_REPO=your-org/arkiol-ai   # e.g. "acme/arkiol-ai"
#   bash scripts/setup-branch-protection.sh
#
# Requires: GitHub CLI (gh) OR curl + GITHUB_TOKEN with repo admin scope.
# The script uses the GitHub REST API directly so gh CLI is not required.
#
# ── Why this matters ──────────────────────────────────────────────────────────
#
# The CI workflow (.github/workflows/ci.yml) runs:
#   install → lint-typecheck → unit-tests → migration-check
#          → integration-tests → build → smoke-tests → CI Gate
#
# "CI Gate" is a single terminal job that only succeeds when ALL upstream jobs
# succeed. Branch protection that requires "CI Gate" therefore blocks merges
# unless every check — linting, types, migrations, tests, build, smoke — pass.
#
# Vercel is configured to trigger on push to main (deploy.yml).  Because direct
# pushes to main are blocked, every Vercel production deployment is preceded by
# a passing CI Gate.  This makes it structurally impossible to deploy broken
# builds.
#
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

: "${GITHUB_TOKEN:?Set GITHUB_TOKEN to a personal access token with repo admin scope}"
: "${GITHUB_REPO:?Set GITHUB_REPO to owner/repo  (e.g. acme/arkiol-ai)}"

BRANCH="main"
API="https://api.github.com/repos/${GITHUB_REPO}/branches/${BRANCH}/protection"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo " Arkiol AI v11 — Applying branch protection to: ${BRANCH}"
echo " Repo: ${GITHUB_REPO}"
echo "══════════════════════════════════════════════════════════════"
echo ""

# ── Build the protection payload ──────────────────────────────────────────────
#
# required_status_checks.contexts:
#   "CI Gate" — the terminal job in .github/workflows/ci.yml.
#   This single entry is sufficient: CI Gate only passes when ALL 6
#   upstream jobs (lint-typecheck, migration-check, unit-tests,
#   integration-tests, build, smoke-tests) pass.
#
# enforce_admins: true — ensures repository admins cannot bypass the rules.
#   Remove this if you need break-glass emergency direct-push capability,
#   but document the exception policy.
#
# required_pull_request_reviews:
#   Requires at least 1 approving review.
#   dismiss_stale_reviews: a new push invalidates existing approvals.
#   require_code_owner_reviews: if a CODEOWNERS file is present, owners
#   must approve changes to their files.
#
# restrictions: null — all collaborators with write access can push branches
#   and open PRs; only direct pushes to main are blocked.

PAYLOAD=$(cat <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["CI Gate"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true
}
JSON
)

HTTP_STATUS=$(curl -s -o /tmp/bp_response.json -w "%{http_code}" \
  -X PUT \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}" \
  "${API}")

echo "GitHub API response (HTTP ${HTTP_STATUS}):"
cat /tmp/bp_response.json | python3 -m json.tool 2>/dev/null || cat /tmp/bp_response.json
echo ""

if [ "${HTTP_STATUS}" = "200" ]; then
  echo "✅  Branch protection applied successfully."
  echo ""
  echo "   Branch:  ${BRANCH}"
  echo "   Rules:   CI Gate required, 1 review required, direct pushes blocked"
  echo ""
  echo "   What is now enforced:"
  echo "     • All 6 CI jobs must pass (via CI Gate check)"
  echo "     • At least 1 approving PR review required"
  echo "     • Stale reviews dismissed on new commits"
  echo "     • Conversations must be resolved before merge"
  echo "     • Force pushes and branch deletion are blocked"
  echo "     • Rules apply to admins too (enforce_admins=true)"
  echo ""
  echo "   Vercel deployment gate:"
  echo "     Since direct pushes to main are blocked, every Vercel production"
  echo "     deploy (triggered by push to main) is preceded by a passing CI Gate."
  echo "     Broken builds cannot reach production."
elif [ "${HTTP_STATUS}" = "403" ]; then
  echo "❌  403 Forbidden — your token needs admin:repo scope and you must be"
  echo "    a repository admin or organization owner."
  exit 1
elif [ "${HTTP_STATUS}" = "404" ]; then
  echo "❌  404 Not Found — check GITHUB_REPO is set to the correct owner/repo"
  echo "    (e.g. 'acme/arkiol-ai') and that the '${BRANCH}' branch exists."
  exit 1
else
  echo "❌  Unexpected HTTP status ${HTTP_STATUS} — see response above."
  exit 1
fi

# ── Verify the rules are readable back ────────────────────────────────────────
echo "Verifying applied rules..."
VERIFY_STATUS=$(curl -s -o /tmp/bp_verify.json -w "%{http_code}" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "${API}")

if [ "${VERIFY_STATUS}" = "200" ]; then
  CONTEXTS=$(python3 -c "
import json, sys
d = json.load(open('/tmp/bp_verify.json'))
ctxs = d.get('required_status_checks', {}).get('contexts', [])
print('  Required checks: ' + ', '.join(ctxs) if ctxs else '  No required checks (!))')
reviews = d.get('required_pull_request_reviews', {})
count = reviews.get('required_approving_review_count', 0)
print(f'  Required reviews: {count}')
admins = d.get('enforce_admins', {}).get('enabled', False)
print(f'  Enforce admins:  {admins}')
" 2>/dev/null || echo "  (could not parse response)")
  echo "${CONTEXTS}"
  echo ""
  echo "✅  Verification passed — rules are active."
else
  echo "⚠️   Could not re-read branch protection (HTTP ${VERIFY_STATUS}) — rules may still be applied."
fi

echo ""
echo "Done."
