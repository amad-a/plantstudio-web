// Saving a plant and reading it back must not change what it draws.
// usage: node test/roundtrip.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { parsePlantFile, plantToText } from '../src/model/plant.js';
import { Turtle, DRAW_MODES } from '../src/model/turtle.js';

class RecordingSurface {
  foreColor = 0; backColor = 0; lineColor = 0; lineWidth = 1;
  out = [];
  configure() { this.out = []; }
  drawLine(a, b) { this.out.push(...a, ...b, this.lineColor, this.lineWidth); return null; }
  drawTriangle(a, b, c) { this.out.push(...a, ...b, ...c, this.foreColor, this.backColor); return { zForSorting: 0 }; }
}

function drawing(plant) {
  const surface = new RecordingSurface();
  const turtle = new Turtle(surface);
  turtle.reset({ ...DRAW_MODES.solids }, 1, 0, 0);
  plant.draw(turtle);
  return surface.out;
}

function largestDifference(a, b) {
  if (a.length !== b.length) return Infinity;
  return a.reduce((worst, value, i) => Math.max(worst, Math.abs(value - b[i])), 0);
}

let checked = 0, worstDifference = 0;
const failures = [];
for (const file of readdirSync('data').filter((name) => name.endsWith('.pla'))) {
  for (const plant of parsePlantFile(readFileSync('data/' + file, 'latin1')).plants) {
    const reloaded = parsePlantFile(plantToText(plant)).plants[0];
    const copied = plant.copy();
    const difference = Math.max(largestDifference(drawing(plant), drawing(reloaded)), largestDifference(drawing(plant), drawing(copied)));
    worstDifference = Math.max(worstDifference, difference);
    checked++;
    if (difference > 0.05) failures.push(`${file} / ${plant.name}: off by ${difference}`);
  }
}
console.log(`${checked - failures.length}/${checked} plants survive save and copy; largest difference ${worstDifference} px`);
console.log(failures.slice(0, 20).join('\n'));
process.exitCode = failures.length ? 1 : 0;
