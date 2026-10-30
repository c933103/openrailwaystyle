# Working on Railway Atlas

Read [CONTRIBUTING.md](CONTRIBUTING.md), the [development guide](docs/development.md)
and the relevant contract before editing. Use a bounded PR with an observable
outcome, risk and acceptance checks. Keep unrelated investigations separate.

## Changes and evidence

- Keep application code, regression tests, compact fixtures, required product
  data, generated build inputs and licensing material on the application branch.
- Keep bulky run logs, captures and duplicate historical source bundles on a
  designated evidence branch or authorized durable artifact store. Link immutable
  commits from one compact PR receipt instead of copying the archive into each fix.
- Use Git trees and diffs for tracked source. Historical source reconstruction or
  equality with a dated benchmark is not an ordinary CI requirement. Test current
  behavior, real compatibility and artifact provenance directly. A new measurement
  records its own inputs; it does not overwrite the historical measurement.
- Preserve existing evidence and reachable refs. Before moving an archive, inspect
  its consumers and licensing obligations, verify the preserved bytes and access,
  and use a separately reviewed migration. Do not purge or rewrite history.
- Keep source and data integrity, fixture isolation, service-worker upgrades,
  security boundaries and required output-equality checks. Do not replace a real
  regression with a skip, weaker assertion or an unexplained new tolerance.

## Acceptance and reporting

Run relevant tests plus the applicable build and aggregate checks on final source.
Harness changes need their failure paths checked. Rendering changes need the
fixture-safe browser checks in the development guide; committed checks and CI
stay fixture-only. Checking a change against real provider data is allowed:
by hand in a browser, or by a few scripted read-only requests where that
provider's published terms allow automated access (see
[external services](docs/external-services.md): En Liberté's do;
OpenRailwayMap's forbid downloading tiles "using automated processes or in
bulk", so check ORM tiles by hand only). Do not store, commit or redistribute
those responses, and do not run bulk downloads or benchmarks against public
providers.
Existing required CI remains binding.
Set thresholds from the user-visible requirement and risk; changing a gate needs
a documented replacement contract and independent review. Preserve useful failures.

Record the outcome, exact source, commands/environment, results, unresolved limits
and any immutable archive links in one concise PR receipt. Record hashes when byte
identity matters. Distinguish prepared, published, tested, reviewed, merged and
deployed; do not claim skipped, failed or unrun checks passed. Obtain current-head
review and applicable CI before an authorized merge. Keep repository visibility
and existing holds unchanged; exclude secrets and unrelated private information.
Handle security findings in the designated private tracker.
