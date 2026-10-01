// Raw tile responses, shared between labels, views and track counting.
// Limit both retained bytes and entry count; an oversized response is usable
// by its caller without displacing everything else in the cache.
export class ByteCache {
  constructor({maxBytes=24*1024*1024,maxEntries=240}={}) {Object.assign(this,{maxBytes,maxEntries});this.entries=new Map();this.bytes=0;}
  has(key){return this.entries.has(key);}
  get(key){const entry=this.entries.get(key);if(!entry)return undefined;this.entries.delete(key);this.entries.set(key,entry);return entry.value;}
  delete(key){const entry=this.entries.get(key);if(!entry)return false;this.bytes-=entry.bytes;return this.entries.delete(key);}
  set(key,value){this.delete(key);const bytes=value?.byteLength??JSON.stringify(value).length*2;
    if(bytes>this.maxBytes)return this;
    this.entries.set(key,{value,bytes});this.bytes+=bytes;
    while(this.bytes>this.maxBytes||this.entries.size>this.maxEntries)this.delete(this.entries.keys().next().value);
    return this;
  }
  get size(){return this.entries.size;}
}
