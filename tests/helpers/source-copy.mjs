import {basename} from 'node:path';

// Other tests may import Python modules while these trees are copied. Python
// atomically renames temporary bytecode files, so traversing __pycache__ can
// fail with ENOENT. Generated caches are not fixture inputs: exclude each
// directory before recursion, without hiding failures for any real source.
export const sourceCopyOptions = Object.freeze({
  recursive: true,
  filter: source => basename(source) !== '__pycache__',
});
