# Independent source-identity review

Reviewed parser SHA-256:
`93f40a87dad36e8bd2280d45d7eb90fa875d1507244bb7683d4b719f34787f7b`.
It is unchanged in PR #238 head `5b4422cd32e75762e4eedf02bed1a566905e8b06`.

The independent reviewer read MOTIS v2.10.2 `src/tag_lookup.cc` directly and
verified the date/start-time/dataset-tag/original-ID envelope, original-ID
underscores and minimum-two-digit extended hours. No concrete defect was found
in the final whole-group veto; the original ambiguity graph remains intact.

- Independently reran the 21 source-identity tests: all passed.
- Added 36 independent runtime controls: four dataset tags covering Unicode,
  case and punctuation, four original IDs including leading underscores, both
  input orders, and four cross-source 00/23/24/100-hour cases. All passed, with
  distinct-instance counts, isolated cancellation and cross-source merging
  behaving as expected.

This is bounded contract/source and runtime review. It does not replace the
aggregate suite, actual-browser checks or exact-head Codex/CI acceptance.
