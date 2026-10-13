# Codex review repair receipt

Supersedes the first implementation at 0e76eaa7ccae97df34b9a3d32aa0217aa31d0d17. Both P2 findings reproduced: the old projection missed plan date/preflight changes and numeric/hyphen anchor definitions. The replacement hashes the entire workflow as a direct generation input and removes YAML projection and legacy equivalence machinery. Renderer-only JavaScript still reuses data; workflow/lock edits and legacy missing data identity take the normal fresh path.

Final unchanged source: npm test 1,523/1,523; all mainline tests 93/93; build/generated-style equality/syntax/YAML/diff checks passed. Linux, Node24.19.0, npm11.9.0 (hosted Node22). Independent review33/33 focused checks, no remaining blocker. Reviewer source SHA256 provenance a7a3df236fffec34c9f01fa610c26b24ece20b1945bf3ed8546eb0fdd973f4fa and planner3c14be97f3ffa5b5b697bf547e74b7bfa9b5f682c4bd390164fae07d394dfce7.

The first-head hosted logs are historical only. That head reused407544, skipped extraction and passed840+18 observations, but Codex found the two P2 issues, so it was not merged. Its historical downloadedBytes metric is retained original acquisition provenance, not new traffic. No new-head hosted reuse or savings is claimed. New-head bootstrap CI and exact-head re-review remain required.
