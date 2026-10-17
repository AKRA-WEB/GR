'use strict';
const path = require('node:path');
function backendPath(...segments) {
  const root = process.env.AKRA_TEST_BACKEND_ROOT;
  if (!root || !path.isAbsolute(root)) throw new Error('Set AKRA_TEST_BACKEND_ROOT to the explicitly selected absolute backend source directory');
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Backend test path must stay inside the selected source directory');
  return target;
}
module.exports = {backendPath};
