// The level-crossing tags shown in the details panel. The crossing snapshot
// (scripts/crossing-data.mjs) carries exactly these in its detail tiles, so
// a click needs no request. Free-text tags come last: an unescaped tab in an
// Overpass CSV value can only spill into the final column.
export const CROSSING_TAGS = [['crossing:barrier','Barriers'],['crossing:light','Lights'],['crossing:bell','Bells'],['crossing:activation','Activation'],
  ['crossing:supervision','Supervision'],['crossing:on_demand','On demand'],['crossing:saltire','Saltire (St Andrew\'s cross)'],['crossing:chicane','Chicane'],
  ['crossing','Crossing type'],['access','Access'],['ref','Reference'],['name','Name'],['description','Description']];
