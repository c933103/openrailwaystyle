// Local RequestInit marker: this is not a header or Overpass query parameter.
export const CHANGE_FOLLOW_UP = Symbol.for('railway-atlas.overpass-change-follow-up');
// Older crossing receipts counted only the augmented diff, not its row reads.
export const CHANGE_SCOPE = 'adiff+crossing-rows-v1';
