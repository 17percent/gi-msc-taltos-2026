/* index.js — a tesztkönyvtár belépési pontja.
 *
 * Node 24-ben a `node --test <könyvtár>/` a könyvtárat MODULKÉNT oldja fel
 * (nem globként), vagyis ezt az `index.js`-t futtatja. Ezért itt töltjük be az
 * összes `*.test.js` fájlt — így a kért parancs változatlanul működik:
 *
 *   node --test Prototypes/tudasbazis-prototype/tests/
 *
 * (`node --test` argumentum nélkül, a repó gyökeréből a `*.test.js` minta
 * szerint ugyanezeket a fájlokat külön-külön is megtalálja.)
 * Nincs npm, nincs package.json: csak Node beépített modulok.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .forEach((f) => require(path.join(__dirname, f)));
