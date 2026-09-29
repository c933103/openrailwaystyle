# GitHub Actions workflows

| Workflow | File | Runs on | What it does |
| --- | --- | --- | --- |
| Validate and deploy world railway map | `.github/workflows/site.yml` | push to `main` and some feature branches, pull requests, manual | Rebuilds the style, checks `styles/world.style.json` is reproducible, runs `npm test`, unpacks the published `rail-data` and `street-data` snapshots, runs the Chromium/WebGL checks, uploads the site as an artifact. Deploys to GitHub Pages only from `main`, not for pull requests. |
| Build worldwide railway lifecycle snapshot | `.github/workflows/snapshot.yml` | Monday, Wednesday and Friday 03:23 UTC; manual (optional `refresh` input); push to `build/world-lifecycle` touching the snapshot scripts | Applies changes since the previous run, refreshes the oldest cached regions, rebuilds the 20 world regions, loading-gauge list and polar caps, and publishes to the `rail-data` branch. See [Lifecycle snapshot](lifecycle-snapshot.md). |
| Refresh mapped street-running tracks | `.github/workflows/street-running.yml` | Sunday 03:27 UTC; manual; push to `main` or `fix/planning-context` touching the street-running scripts | Extracts explicitly mapped street-running track and publishes to the `street-data` branch. See [Street-running tracks](street-running.md). |

Data branches and releases used by the workflows:

- `rail-data` — published lifecycle snapshot (replaced by a single commit on each publish).
- `street-data` — published street-running snapshot.
- `overpass-cache` release — raw Overpass responses, so a rebuild after changing `scripts/lifecycle.mjs` needs no new queries.

Setup for a new fork is in [Deployment](deployment.md).
