# Watch map

[Documentation index](README.md)

Use `?ui=watch` in a map link, or enable **Map-only watch layout** in Settings.
The explicit choice persists in the existing cookie and shared links. Screen
size alone never changes a phone into watch mode.

The normal watch view is the map across the entire viewport. There is no
persistent menu, info button, scale, zoom control, readout or detail card.
Drag and pinch operate directly on the map; double tap zooms. Hold still for
700 ms to request temporary controls. A drag, second pointer, release, pointer
cancellation or loss of focus cancels the hold. No pointer is captured and map
gestures are never prevented. Shift F10/context menu is a keyboard alternative.

Temporary controls fit inside a square occupying 70% of the shorter viewport
dimension, safe inside a circular face. Choose a railway view directly; Options
opens layers or source information. Service uses the ordinary route view,
independent of timetable/frequency data. One layer choice
returns to the map. **Map** or Escape closes controls. **Standard view** restores
the ordinary interface. Credits remain available through Options → Info, with
source links. Errors can be inspected there too. Browsing taps never open cards.

This changes browser layout and interaction only. It does not reduce map data,
alter terrain/DPR defaults, or promise support/performance on physical watch
hardware. The browser check exercises 192, 240 and 280px viewports, a circular
safe area, full-face geometry, deliberate controls, drag, pinch and zoom.
