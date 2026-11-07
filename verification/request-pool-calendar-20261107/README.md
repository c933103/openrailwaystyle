# Independent request-pool calendar diagnostic

Source: PR #409 head 173a5843d0df1f3d612bbc8dec31915b1a220486 (base main abeeb6a5140b9c701247e75411bfea3ab64ca632 has the identical calendar parser). Node 24.22.1, Linux x64. From the repository root run `TZ=Asia/Tokyo node --test /path/to/diagnostic.mjs`.

Two offline fake-response/fake-timer cases exercise the actual pool. IMF-fixdate `Wed, 07 Oct 2026 00:02:00 GMT` passes the 120-second origin pause. Valid obsolete asctime `Wed Oct  7 00:02:00 2026` fails: Date.parse interprets it as local time, and the next same-origin request is sent before the true UTC deadline. No real provider requests occurred.

This independent calendar defect is not part of #409's error-body cleanup fix, not yet repaired, and not a failed #409 acceptance check. A subsequent bounded repair should share the validated HTTP calendar semantics without weakening cooldowns or creating a browser import of an unpublished scripts path. Preserve numeric handling and source workflow dependency tracking. Existing holds remain unchanged.
