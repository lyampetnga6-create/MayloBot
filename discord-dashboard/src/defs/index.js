'use strict';
/** Assemble les définitions de modules ajoutées après la première version. */
module.exports = (kit) => [
  ...require('./ai')(kit),
  ...require('./security')(kit),
  ...require('./support')(kit),
  ...require('./community')(kit),
  ...require('./fun')(kit),
  ...require('./automation')(kit),
  ...require('./growth')(kit),
];
