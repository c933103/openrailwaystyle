# Native-grid 3D terrain fusion

Workstream 3 continues with the 3D composition boundary after native decoding
and latitude repair. The renderer previously rejected every input except
256×256 heights. It now accepts 256×256 and 512×512 pixel-centred XYZ rasters,
normalizing them to the existing 256×256 mesh. Shared source arrays are unchanged.
Land retains its signed elevations. The independent ocean mask alone selects
seabed samples; no sign-based land classification or coastline ramp is added.

The optional `seabedDem` reader keeps the land and bathymetry inputs separately
selectable. Its default remains the existing repaired DEM. The z10/zero-ocean
recovery policy is still the current Mapzen contract, not a generic assumption
about a prospective replacement. Both sources must already use compatible
height units, datum and pixel registration. Resampling does not resolve these
metadata requirements or add surveyed resolution. Positive-weight invalid
samples fail before interpolation can conceal them in a plausible average.

## Verification receipt

Base: merged main `3508eb1ea991ed9bef471d0a87f52275d8a36d58`.
Local Node v24.22.1; no live provider requests. The final commit and hosted
results are recorded in the PR. Browser shell advances from 75 to 76 with
`20261117-native-fusion-1` across its module graph.

- `npm run build`: passed; generated style and station files unchanged.
- `node --check styles/app.mjs` and `git diff --check`: passed.
- `node --experimental-vm-modules --test --test-concurrency=2 tests/terrain-3d.test.mjs tests/terrain-deadlines.test.mjs tests/dem-repair.test.mjs tests/elevation.test.mjs tests/sw-install.test.mjs tests/resources.test.mjs`: 143 passed.
- Added native-grid affine-ramp, adjacent-tile registration, signed lowland,
  sharp step, mixed-size ocean fusion, invalid contributor, distinct reader,
  and worker/page encoding parity regressions. The canvas test observes encoded
  Terrarium bytes; it is not a real WebGL/browser result.
- Full aggregate and fixture browser acceptance remain required on the exact
  published head. Existing hosted terrain checks exercise the unchanged
  production source; synthetic tests establish the new native-grid behavior.

## Remaining source evidence

The [terrain assessment](terrain-source-assessment.md) records the provider
investigation. No source switch is included. Mapterhorn regional source/datum
and missing-data semantics remain unverified for actual Nuuk/McMurdo samples;
there is no justified ArcticDEM/REMA attribution or common bathymetry datum
established by the available catalogue. A real migration must establish these
contracts and exercise all contour/hillshade/profile consumers and bounded app
browser views. This change does not certify a source migration, macro fault
classification, coastal smoothing, or completion of workstream 3. Existing
#251 hold is unchanged.
