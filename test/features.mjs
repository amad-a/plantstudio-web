// Checks posing, the OBJ exporter and the wizard's parameter logic without a browser.
// usage: node test/features.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePlantFile, plantToText, newAmendment, breed, POSING } from '../src/model/plant.js';
import { exportPlantsToObj } from '../src/model/export.js';
import { parseTdoLibrary, Tdo } from '../src/model/tdo.js';
import { Turtle, DRAW_MODES } from '../src/model/turtle.js';
import { Random } from '../src/model/support.js';
import { applyAnswers, buildPlant, defaultAnswers } from '../src/ui/wizard.js';

class Recorder {
  foreColor = 0; backColor = 0; lineColor = 0; lineWidth = 1;
  lines = []; triangles = [];
  configure() { this.lines = []; this.triangles = []; }
  drawLine(a, b, partID) { this.lines.push({ a, b, partID, color: this.lineColor }); return null; }
  drawTriangle(a, b, c, partID) { this.triangles.push({ a, b, c, partID, color: this.foreColor }); return { zForSorting: 0 }; }
}

const load = (name) => parsePlantFile(readFileSync(`data/${name}.pla`, 'latin1')).plants;
const draw = (plant) => {
  const surface = new Recorder();
  const turtle = new Turtle(surface);
  turtle.reset({ ...DRAW_MODES.solids }, 1, 0, 0);
  plant.draw(turtle);
  return surface;
};
const check = (name, test) => {
  test();
  console.log('ok  ', name);
};
const tulip = () => load('Garden flowers').find((plant) => plant.name === 'gilia');

check('hiding a leaf removes only that leaf', () => {
  const plant = tulip();
  const before = draw(plant);
  const partID = before.triangles[0].partID;
  plant.amendments.push({ ...newAmendment(partID, 'leaf'), hide: true });
  const after = draw(plant);
  assert.equal(after.triangles.filter((t) => t.partID === partID).length, 0);
  assert.equal(after.triangles.length, before.triangles.filter((t) => t.partID !== partID).length);
});

check('hiding an internode hides what grows from it, but not its leaves', () => {
  const plant = tulip();
  const first = plant.firstPhytomer.nextPlantPart;
  plant.amendments.push({ ...newAmendment(first.partID, 'internode'), hide: true });
  const after = draw(plant);
  assert.equal(after.lines.filter((line) => line.partID === first.partID).length, 0);
  assert.ok(after.triangles.length < draw(tulip()).triangles.length);
});

check('a rotation moves later parts and leaves earlier ones alone', () => {
  const plant = tulip();
  const before = draw(plant).lines;
  const stem = plant.firstPhytomer.nextPlantPart;
  plant.amendments.push({ ...newAmendment(stem.partID, 'internode'), addRotations: true, zRotation: 45 });
  const after = draw(plant).lines;
  assert.deepEqual(after[0], before[0]);
  assert.notDeepEqual(after.at(-1).b, before.at(-1).b);
});

check('scale multipliers change the part, and carry up the stem only if asked', () => {
  const plant = tulip();
  const stem = plant.firstPhytomer.nextPlantPart;
  const length = (lines, id) => lines.filter((l) => l.partID === id).reduce((n, { a, b }) => n + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), 0);
  const nextID = stem.nextPlantPart.partID;
  const base = draw(plant).lines;
  const amendment = { ...newAmendment(stem.partID, 'internode'), multiplyScale: true, lengthMultiplier_pct: 200 };
  plant.amendments.push(amendment);
  const doubled = draw(plant).lines;
  assert.ok(Math.abs(length(doubled, stem.partID) / length(base, stem.partID) - 2) < 1e-6);
  assert.ok(Math.abs(length(doubled, nextID) - length(base, nextID)) < 1e-6);
  amendment.propagateScale = true;
  assert.ok(Math.abs(length(draw(plant).lines, nextID) / length(base, nextID) - 2) < 1e-6);
});

check('highlight colors show on screen but not in output', () => {
  const plant = tulip();
  const part = draw(plant).triangles[0].partID;
  plant.amendments.push(newAmendment(part, 'leaf'));
  assert.ok(draw(plant).triangles.some((t) => t.color === POSING.nonHiddenPosedColor));
  POSING.drawingForOutput = true;
  assert.ok(!draw(plant).triangles.some((t) => t.color === POSING.nonHiddenPosedColor));
  POSING.drawingForOutput = false;
});

check('ghosting and "not shown" change what a hidden part does', () => {
  const plant = tulip();
  const part = draw(plant).triangles[0].partID;
  plant.amendments.push({ ...newAmendment(part, 'leaf'), hide: true });
  POSING.showGhostingForHiddenParts = true;
  assert.ok(draw(plant).triangles.some((t) => t.partID === part && t.color === POSING.ghostingColor));
  POSING.showGhostingForHiddenParts = false;
  POSING.showPosingAtAll = false;
  assert.ok(draw(plant).triangles.some((t) => t.partID === part && t.color !== POSING.ghostingColor));
  POSING.showPosingAtAll = true;
});

check('poses survive saving, copying and reloading; breeding drops them', () => {
  const plant = tulip();
  const part = plant.plantPartForPartID(draw(plant).triangles[0].partID);
  assert.equal(part.getName(), 'leaf');
  plant.amendments.push({ ...newAmendment(part.partID, part.getName()), hide: true, addRotations: true, xRotation: 30, multiplyScale: true, propagateScale: true, scaleMultiplier_pct: 150, lengthMultiplier_pct: 80, widthMultiplier_pct: 60 });
  const reloaded = parsePlantFile(plantToText(plant)).plants[0];
  assert.deepEqual(reloaded.amendments, plant.amendments);
  assert.deepEqual(plant.copy().amendments, plant.amendments);
  assert.deepEqual(draw(reloaded).triangles, draw(plant).triangles);
  assert.equal(breed(plant, null, { mutation: 0 }, new Random(5)).amendments.length, 0);
});

check('an unknown part number in a pose does nothing', () => {
  const plant = tulip();
  const before = draw(plant).triangles.length;
  plant.amendments.push({ ...newAmendment(999999, 'leaf'), hide: true });
  assert.equal(draw(plant).triangles.length, before);
});

check('OBJ export is well formed, with every material defined', () => {
  const plants = load('Wildflowers').slice(0, 3);
  const { obj, mtl } = exportPlantsToObj(plants, 'test.mtl');
  const lines = obj.split('\n');
  let vertices = 0;
  for (const line of lines) {
    if (line.startsWith('v ')) {
      vertices++;
      assert.ok(line.split(' ').slice(1).every((value) => Number.isFinite(Number(value))), line);
    } else if (line.startsWith('f ')) {
      for (const value of line.split(' ').slice(1).map(Number)) assert.ok(value < 0 && vertices + value >= 0, line);
    }
  }
  assert.ok(lines.includes('mtllib test.mtl'));
  assert.equal(lines.filter((line) => line.startsWith('o ')).length, 3);
  const defined = new Set(mtl.split('\n').filter((line) => line.startsWith('newmtl ')).map((line) => line.slice(7)));
  for (const line of lines.filter((l) => l.startsWith('usemtl '))) assert.ok(defined.has(line.slice(7)), line);
  assert.ok(vertices > 1000);
});

check('OBJ geometry stands where the drawing does, and ignores window zoom', () => {
  const [plant] = load('Wildflowers');
  const heightOf = (text) => {
    const ys = text.split('\n').filter((line) => line.startsWith('v ')).map((line) => Number(line.split(' ')[2]));
    return Math.max(...ys) - Math.min(...ys);
  };
  const before = heightOf(exportPlantsToObj([plant], 'x.mtl').obj);
  const measured = plant.measure(plant.drawingScale_PixelsPerMm, 0, 0);
  const expected = measured.bottom - measured.top;
  assert.ok(Math.abs(before - expected) / expected < 0.15, `${before} vs ${expected}`);
});

check('OBJ leaves out hidden parts', () => {
  const plant = tulip();
  const count = () => exportPlantsToObj([plant], 'x.mtl').obj.split('\n').filter((line) => line.startsWith('f ')).length;
  const before = count();
  plant.amendments.push({ ...newAmendment(draw(plant).triangles[0].partID, 'leaf'), hide: true });
  assert.ok(count() < before);
});

const library = parseTdoLibrary(readFileSync('data/3D object library.tdo', 'latin1'));

check('wizard defaults grow a plant with no flowers', () => {
  const plant = buildPlant(defaultAnswers(library), 'wizard');
  assert.equal(plant.age, plant.pGeneral.ageAtMaturity);
  assert.equal(plant.pMeristem.branchingIndex, 0);
  assert.ok(plant.pGeneral.ageAtWhichFloweringStarts > plant.pGeneral.ageAtMaturity);
  assert.ok(draw(plant).triangles.length > 0);
});

check('wizard answers set the original parameters', () => {
  const answers = { ...defaultAnswers(library), branching: 30, branchAngle: 60, secondary: true, curviness: 3, leaflets: 5, leafletShape: 1, leafletSpread: 50, apical: 2, axillary: 5, flowers: 10, inflorShape: 'panicle', petals: 4, showFruit: false };
  const plant = buildPlant(answers, 'wizard');
  const p = plant.pInflor[1];
  assert.equal(plant.pMeristem.branchingAngle, 60);
  assert.equal(plant.pInternode.curvingIndex, 50);
  assert.equal(plant.pInternode.firstInternodeCurvingIndex, 20);
  assert.equal(plant.pLeaf.compoundNumLeaflets, 5);
  assert.deepEqual([p.numFlowersOnMainBranch, p.numFlowersPerBranch, p.numBranches], [1, 3, 3]);
  assert.equal(plant.pFlower[1].tdoParams[3].repetitions, 4);
  assert.equal(plant.pFlower[1].minDaysBeforeSettingFruit, 200);
  assert.equal(plant.pGeneral.ageAtWhichFloweringStarts, Math.round(plant.pGeneral.ageAtMaturity * 0.6));
});

check('every wizard flower count and shape grows without error', () => {
  for (const flowers of [1, 2, 3, 5, 10, 20]) {
    for (const inflorShape of ['spike', 'raceme', 'panicle', 'umbel', 'cluster', 'head']) {
      const plant = buildPlant({ ...defaultAnswers(library), apical: 1, axillary: 3, flowers, inflorShape }, 'wizard');
      assert.ok(draw(plant).lines.every((line) => line.a.every(Number.isFinite)), `${flowers} ${inflorShape}`);
    }
  }
  assert.ok(applyAnswers);
});

check('3D object edits keep their indexes straight', () => {
  const tdo = new Tdo('test');
  tdo.points = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 5]];
  tdo.triangles = [[1, 2, 3], [2, 4, 3]];
  tdo.removeTriangle(tdo.triangles[0]);
  assert.deepEqual(tdo.points, [[10, 0, 0], [0, 10, 0], [10, 10, 5]]);
  assert.deepEqual(tdo.triangles, [[1, 3, 2]]);
  tdo.setOriginPointIndex(2);
  assert.deepEqual(tdo.points[2], [0, 0, 0]);
  const mirrored = new Tdo('m');
  mirrored.points = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];
  mirrored.triangles = [[1, 2, 3]];
  mirrored.makeMirrorTriangles();
  assert.deepEqual(mirrored.points, [[0, 0, 0], [10, 0, 0], [0, 10, 0], [-10, 0, 0]]);
  assert.deepEqual(mirrored.triangles, [[1, 2, 3], [3, 4, 1]]);
  const reloaded = parsePlantFile(plantToText(tulip())).plants[0];
  assert.equal(reloaded.pLeaf.leafTdoParams.object3D.originPointIndex, tulip().pLeaf.leafTdoParams.object3D.originPointIndex);
});
