# Preserve distinct same-source trip instances

Related to #113 and #129. Their broader source identity, coverage and public-ref
requirements remain open.

## Reproduction and contract

On base `3a80f5f75d3ceab72b8b50c0dbe96a8dd8850401`, two selected stop boards can
contain different trips from the same dataset, with identical line, destination
and scheduled instant. `departureGroups` treats the board-list index as its only
source distinction. It merges these distinct trips, losing one schedule link and
transferring cancellation/platform/prediction state. An expired cancellation can
also cancel the other delayed trip. These are controlled provider-shaped fixture
reproductions, not a claim of a specific live station incident.

MOTIS v2.10.2's [tag lookup implementation](https://github.com/motis-project/motis/blob/v2.10.2/src/tag_lookup.cc)
defines the trip ID envelope as date, start time, dataset tag, and original trip
ID, separated by underscores. `split_trip_id` preserves underscores in the
original ID; `id_fragments` uses a YYYYMMDD date and a minimum-two-digit hour
followed by minutes. The [configuration contract](https://github.com/motis-project/motis/blob/v2.10.2/docs/setup.md)
forbids underscores in dataset tags. The [stop-time endpoint](https://github.com/motis-project/motis/blob/v2.10.2/src/endpoints/stop_times.cc)
emits that trip ID for each row. It does not guarantee that two separately
requested stop boards represent different feeds.

## Correction and risk

- Recognize only that dated MOTIS envelope, validating the calendar date and
  minute component while allowing extended GTFS hours and arbitrary original IDs.
- Reject a whole final group containing different trip-instance IDs for the same
  recognized dataset tag. Apply the same guard to expired cancellation evidence.
- Keep the original candidate/ambiguity graph. Do not remove competing rows or
  create smaller groups after a veto.
- Preserve exact same-instance observations, different-source reconciliation,
  unknown-format behavior, request limits, cache lifetimes and source labels.
- Keep publication asset versions coherent and update the user guide.

This is conservative negative identity evidence. Same-source duplicate-looking
trips can remain separate; missing/unrecognized IDs do not establish identity.
No agency/route label or stop-board name is treated as a source ID. Cross-source
equivalence still follows the existing bounded rules, not a worldwide proof.

## Validation receipt

Node 24.19.0, temporary source checkout verified against the base Git tree;
dependencies reuse the pinned existing installation. Offline fixtures only.

- Final 21-case focused suite: 21 pass. Against the unchanged base parser, the
  same final tests produce 7 intended failures and 14 passing controls.
- Cases cover distinct original IDs, service dates/start times, underscores and
  Unicode, exact repeats, different datasets, malformed/unknown envelopes,
  preserved ambiguity witnesses, whole-group veto, expired cancellation,
  selected-board requests and distinct full-schedule links in the DOM.
- Independent source/contract review found no concrete defect; independently
  reran 21 tests and 36 additional dataset-tag/original-ID/extended-hour controls.
- Build, style/station reproducibility, syntax and whitespace checks pass.
- The first broader focused run ended 505/506 with the startup-test subprocess
  killed; an isolated TAP rerun confirmed SIGKILL, not an assertion failure.
  Aggregate validation remains pending at publication.
- The new production-browser fixture covers both board orders, same/different
  instances, different sources, expired cancellation and cached reopening.
  Local execution is blocked: the default Playwright browser is absent; the
  installed system Chromium fails because Unix-domain sockets are denied. No
  bypass was attempted. Hosted Chromium/WebKit checks remain required.

Final commands, exact-head review/CI outcomes and immutable bulky-evidence links
are recorded in the PR receipt. This document does not claim merge, deployment,
live-provider availability or physical-device acceptance.
