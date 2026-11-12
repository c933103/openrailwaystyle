# Clear unfinished drawings

## Confirmed failure and bounded change

On source `891e97ade75a4f156cc7b752375673e7a6e849aa`, the Clear toolbar handler
checks only `drawing.features.length`. The first unfinished line, area or curve
has draft points but no finished feature. Extending the only saved line removes
it from that list and retains the original in `drawing.extending` until Finish
or cancellation. In both states Clear silently does nothing, even after every
extension point has been undone.

The handler now recognizes finished features, draft points and the original
held by an extension. It retains the existing “Delete all drawings?” confirmation
and calls the existing `Drawing.clear()` only when accepted. Empty state and a
cursor preview without any points remain no-ops. No geometry algorithms,
providers, network behavior, source data, permissions or held work change.

## Acceptance contract

- Clear asks before discarding any saved or unfinished drawing, including a
  paused draft and an extension with no remaining draft points.
- Declining changes neither editable/rendered state nor persistence; a declined
  extension can still be cancelled to recover the original.
- Accepting empties saved features, draft points/flags, selection, cursor and
  extension ownership, refreshes all three drawing sources and persists the
  empty collection. Finish, cancel and reload cannot resurrect cleared work.
- The chosen tool and Move map state remain unchanged; subsequent drawing uses
  only newly entered points. Repeated empty Clear does not ask again.
- The coordinated `20261018-drawing-clear-1` asset token updates the cache-first
  toolbar while old tabs retain their saved version. No shell generation purge.

## Reproducible checks

`tests/drawing-clear.test.mjs` executes the actual toolbar handler with real DOM
clicks and the production Drawing class. Its 20 cases cover positive and negative
confirmation, saved/draft combinations, persistence, reload and unchanged healthy
states. Against the pinned predecessor, 15 cases fail at the missing confirmation
and five healthy controls pass; the corrected handler passes all 20.

`tests/startup.test.mjs` additionally starts the complete app and verifies toolbar
buttons, first-draft clearing, declined confirmation, no resurrection on Finish,
empty repeats and fresh input. `tests/sw-install.test.mjs` executes the current
toolbar returned offline by the actual service worker after the token upgrade,
checking exact current bytes and old-tab isolation.

Commands: `npm run build`, `git diff --exit-code -- styles/world.style.json`,
`npm test`, `node --check styles/app.mjs`, and `git diff --check`.
The PR receipt records final-source results, immutable logs and hosted gates.
Synthetic/DOM checks do not establish native browser rendering or worldwide
feature/data coverage. Existing hosted browser groups and current-head review
remain required; the broader board and all domain/source/provider holds stay open.
