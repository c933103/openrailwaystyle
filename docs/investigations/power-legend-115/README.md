# Power facility point-legend correction (#115)

## Scope and source

- Base: `8c1d2607068f0f3c0cce7e9e721fca1deaa07ee0` (main after #188).
- Candidate: `c7ed922d62420a430ddca11d0fcb3876a1dddd8c`.
- Frozen source diff SHA-256: `c8088f6d79a3b4504f3d27e5df22544368844f1025db1b5664f78293fc3ce180`.
- All 442 source files were reconstructed from SHA-verified GitHub blobs before editing.
- The E/F/C/W legend now retains explicit point-symbol metadata and shares letters, category colours, fill/stroke, detailed marker radius and text size with the actual map. Filled samples represent present facilities; enabling planned/former infrastructure adds matching hollow samples.
- The requested servicing labels are included: “Train refuelling point (fuel type where mapped)”, “Steam engine coaling”, “Steam engine water”. Other legend order, ordinary/patterned track samples and control-system disclosures are retained.
- Release token is `20261011-power-legend-1` consistently across the existing app imports and entry points. No service-worker schema or cache policy changes.
- This is a bounded correction related to #115, not completion of its wider source selection, presentation, wording, help/credits or data-status audit. #115 remains open. No provider acquisition, migration or localization work was added.

## Verification

| Check | Result |
| --- | --- |
| Main + new DOM regression | Expected failure: zero point samples instead of four |
| Main + new real-browser regression | Expected failure at same zero-vs-four assertion after actual facility layers rendered, with no map/page errors |
| Main + cache-version regression | Expected failure: previous token reused |
| Candidate DOM and coherent asset-version tests | Pass |
| Facility model tests | 13/13 pass, including all 14 facility kinds and map/legend paint correspondence |
| Existing startup/facility/departure focused set | 92/92 pass |
| Existing-worker navigation/cache upgrade | Pass: exact new app/CSS/metadata bytes available offline, coherent previous-token bytes preserved for old tabs |
| `npm run build` | Pass, generated `world.style.json` byte-identical to main |
| `npm test` | 1294/1294 pass, zero failures, cancellations or skips; 95.486 seconds |
| `node scripts/check-signal-power-browser.mjs` | Pass at 1365×900 desktop and 412×915 mobile, device scale 2 |
| `git diff --check` | Pass |

The browser check uses the real pinned MapLibre/WebGL renderer with controlled
OSM-shaped vector/GeoJSON/PMTiles fixtures and the repository's fail-closed network
guard. It compares visible point glyphs, circle size, filled/hollow paints,
accessible labels, unchanged 25×4 ordinary track samples, inactive/label settings,
view changes and return to Power. Existing simultaneous control bands, hover/tap
explanations, signal handling, facility details and overview checks also pass. No
live public-provider datasets were downloaded.

The existing numeric-departure regression from #188 remains included in the full
suite. The generated style SHA-256 is unchanged:
`1714821c3d2510dd908884139d3522dad847cdcf6c16c346f4902195d4a7abd7`.

## Screenshots

| State | Desktop | Mobile |
| --- | --- | --- |
| Present | [Active desktop](power-legend-active-desktop.png) | [Active mobile](power-legend-active-mobile.png) |
| Planned/former enabled | [Former desktop](power-legend-former-desktop.png) | [Former mobile](power-legend-former-mobile.png) |

## Evidence and limits

[manifest.json](manifest.json) records the artifact byte sizes and SHA-256 hashes.
The adjacent logs retain the baseline failures and candidate passes; absolute
scratch checkout paths are replaced with `[baseline]` and `[candidate]`.

An initial browser launch used a preview server that was no longer available and
failed with loopback `ECONNREFUSED`; running preview and browser in the same shell
resolved it. A preliminary aggregate was deliberately interrupted to avoid
brief overlap with the browser's final stage; its interrupted run is not counted
as a pass. The reported full suite is the subsequent complete isolated run, with
all original timeout caps unchanged.

## Independent review

The frozen diff passed independent review: 105 focused tests, exact baseline vs
candidate parity across 36 legend states outside the four intended rows, separate
baseline-failing/candidate-passing Chromium checks at both widths, and keyboard
help-disclosure checks. All eight facility map layers also deep-equal main.

A tight `#legend` screenshot appeared to crop the Construction label in the
planned/former key. Independent full-panel captures and bounds/hit testing showed
identical baseline/candidate bounds, the entire label within the panel, and a
successful hit test on its last character. This is a screenshot-boundary artifact,
not a UI defect introduced by the patch.

- [Baseline desktop panel](review-baseline-desktop-full-panel.png)
- [Candidate desktop panel](review-candidate-desktop-full-panel.png)
- [Baseline mobile panel](review-baseline-mobile-full-panel.png)
- [Candidate mobile panel](review-candidate-mobile-full-panel.png)
- [Layout and keyboard evidence](review-help-and-layout.json)
- [36-state parity result](review-parity-result.log)
- [105 focused tests](review-candidate-focused.log)
