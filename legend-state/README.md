# Live legend disclosure state

Source `807b1e09d34f6649e048020130fd5c8989847e92`, tree
`ffff86b7841996636cedd3395adecb336b013381`, parent
`f32cb4aac43f797d0f870cb9cfc054dfb17f15f0`.

Three sensitive actual-source regression cases fail on the parent and pass with
synchronous live `details.open` capture before legend replacement and guards
against detached-node toggle events. Both open and closed states are preserved.
Native `toggle` dispatch can be deferred; the displayed DOM state is authoritative.

Final checks: 13/13 startup-focused tests and 86/86 SW/terrain/globe tests pass,
with zero skips/cancellations. Build, generated-style equality, syntax and
whitespace pass. The full release graph uses `20261027-clean-history-3d-2`, shell 53.

Browser assertions, waits and terrain pixel checks are unchanged. The combined
clean-history and visible-terrain features and their regression tests remain.
Fresh exact-head Code review and hosted CI are required; no new local full-suite
or native-browser pass is claimed.

The PR273 postmerge status-open failure motivated this diagnosis. The reproduced
path does not prove that historical event ordering. The preceding f32cb4a controls
job passed and remains a passed historical measurement.

`manifest.json` records commands and source hashes. Logs replace the absolute
local checkout path with `<checkout>` but otherwise preserve results.
