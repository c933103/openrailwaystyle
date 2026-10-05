// pbf (3.3.0, and still 5.1.2) writes code points U+20000-U+2FFFF one plane
// too low: its UTF-8 writer joins a surrogate pair with `| 0x10000` rather
// than adding it, so 𨋢 U+282E2 became the Tangut U+182E2. Every string in a
// tile written with pbf or vt-pbf goes through Pbf#writeString; importing
// this module makes it write the browser's own UTF-8 encoding instead.
import Pbf from 'pbf';

const encoder = new TextEncoder();
Pbf.prototype.writeString = function writeString(value) {
  this.writeBytes(encoder.encode(String(value)));
};
export default Pbf;
