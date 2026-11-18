# Mobile energy fixture framing

Hosted infrastructure job 133459627416 rendered the grid line on mobile but
failed its civil-outline assertion. At zoom 18, the 412px view centered at
longitude .0007 spans approximately .000147–.001253. The original tank
(−.0001–.00005) and generator (.00145) were outside that view. The desktop
view contained both and passed.

Move the same tank to .00035–.0005 and generator to .00095. Their tags,
latitude, geometry sizes, generated-bundle path, layers, timeouts and all
rendered-feature assertions remain unchanged. No runtime or source-data changes.

Validation: coordinate projection confirms both fit the mobile view with more
than 70px horizontal margin; syntax, focused energy tests and build are checked
on this branch. Hosted desktop/mobile rendering remains required; local browser
execution is unavailable in this executor. Previous failed hosted evidence remains
failed and is not replaced by coordinate calculations.
