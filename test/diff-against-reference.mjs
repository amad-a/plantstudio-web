// Compares what this port draws with the Python reference run, primitive by primitive.
// usage: node test/diff-against-reference.mjs spec.json reference.json
import { readFileSync } from 'node:fs';
import { parsePlantFile, POSING } from '../src/model/plant.js';
import { Turtle, DRAW_MODES } from '../src/model/turtle.js';

const TOLERANCE = 1e-6;

class RecordingSurface {
  foreColor = 0; backColor = 0; lineColor = 0; lineWidth = 1;
  out = [];
  configure() { this.out = []; }
  drawLine(a, b) {
    this.out.push(['L', ...a, ...b, this.lineColor, this.lineWidth]);
    return null;
  }
  drawTriangle(a, b, c) {
    this.out.push(['T', ...a, ...b, ...c, this.foreColor, this.backColor]);
    return { zForSorting: 0 };
  }
}

const reference = JSON.parse(readFileSync(process.argv[3]));
const plantsByKey = new Map();
const plantFor = (file, name) => {
  if (!plantsByKey.has(file)) plantsByKey.set(file, parsePlantFile(readFileSync('data/' + file, 'latin1')).plants);
  return plantsByKey.get(file).find((p) => p.name === name);
};

let exact = 0;
const failures = [];
for (const expected of reference) {
  const plant = plantFor(expected.file, expected.name);
  plant.amendments = expected.amendments ?? [];
  POSING.drawingForOutput = expected.mode !== 'screen';
  POSING.showGhostingForHiddenParts = expected.mode === 'screen';
  POSING.showHighlightingForNonHiddenPosedParts = expected.mode === 'screen';
  plant.setAge(expected.age);
  const surface = new RecordingSurface();
  const turtle = new Turtle(surface);
  turtle.reset({ ...DRAW_MODES.solids }, 1, 0, 0);
  plant.draw(turtle);
  const label = `${expected.file} / ${expected.name} @${expected.age} ${expected.mode ?? ''}`;
  let problem = null;
  if (plant.partsCreated !== expected.parts) problem = `parts ${plant.partsCreated} vs ${expected.parts}`;
  else if (plant.random.seed !== expected.seed) problem = `rng seed ${plant.random.seed} vs ${expected.seed}`;
  else if (surface.out.length !== expected.out.length) problem = `primitives ${surface.out.length} vs ${expected.out.length}`;
  else {
    for (let i = 0; i < surface.out.length && !problem; i++) {
      const mine = surface.out[i], theirs = expected.out[i];
      for (let j = 0; j < mine.length; j++) {
        const same = typeof mine[j] === 'string' ? mine[j] === theirs[j] : Math.abs(mine[j] - theirs[j]) <= TOLERANCE * Math.max(1, Math.abs(theirs[j]));
        if (!same) {
          problem = `primitive ${i} (${mine[0]}) field ${j}: ${mine[j]} vs ${theirs[j]}`;
          break;
        }
      }
    }
  }
  if (problem) failures.push(`${label}: ${problem}`);
  else exact++;
}
console.log(`${exact}/${reference.length} renders match; ${reference.reduce((n, r) => n + r.out.length, 0)} primitives compared`);
console.log(failures.slice(0, 25).join('\n'));
process.exitCode = failures.length ? 1 : 0;
