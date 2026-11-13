# Infuse canary workflow

This fork keeps upstream workflow files for clean source reconciliation, but
their GitHub Actions workflow state must remain disabled. The only enabled
workflow is `.github/workflows/infuse-canary.yml`, which has no automatic
trigger and can run only through `workflow_dispatch` on `main`.

## Branch contract

Each canary version uses two final branches:

- `canary-openclaw-vYYYY.M.D` is the reviewed bundle candidate.
- `build/canary-openclaw-vYYYY.M.D` contains only the generated build
  controller for that exact candidate.

Version components preserve the upstream tag spelling: both zero-padded and
non-zero-padded month/day values are accepted, including `v2026.11.3`.

The build branch must contain `ci/infuse-canary/binding.json` with schema 3 and
`ci/infuse-canary/run-host.py`. The binding must identify:

- repository `infuse-ai-com/openclaw`;
- the exact build and candidate branches;
- the exact 40-character candidate commit;
- runner label `blacksmith-8vcpu-ubuntu-2404`.

The dispatcher rejects a moving or mismatched build/candidate branch before any
candidate code runs. The Blacksmith job receives a read-only `GITHUB_TOKEN`,
does not persist checkout credentials, and retains sanitized evidence for one
day. The generated controller remains responsible for its secretless Docker
boundary, source and package identity checks, resource limits, and evidence
sanitization.

## Manual dispatch

Review both final branch heads, then dispatch from `main` with the exact build
branch and its full commit SHA:

```bash
gh workflow run .github/workflows/infuse-canary.yml \
  --repo infuse-ai-com/openclaw \
  --ref main \
  -f build_ref=build/canary-openclaw-vYYYY.M.D \
  -f build_sha=<40-character-build-commit>
```

Do not dispatch a branch name without independently recording its exact head.
Qualification, prerelease publication, and production deployment are separate
approval gates.

## Workflow-state audit

After this file reaches `main`, explicitly enable only the canary dispatcher
and disable every other registered workflow. Verify the resulting allowlist:

```bash
gh api --paginate repos/infuse-ai-com/openclaw/actions/workflows \
  --jq '.workflows[] | [.path, .state] | @tsv'
```

The expected state is `active` for `.github/workflows/infuse-canary.yml` and
`disabled_manually` for every other workflow. A newly inherited upstream
workflow is disabled before the next fork synchronization is considered
complete.
