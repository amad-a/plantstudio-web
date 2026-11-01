// Writes each bundled plant's parameters for the Python reference run.
// usage: node test/dump-for-diff.mjs spec.json [--posed]
// With --posed, each plant gets a spread of poses on its parts, chosen by part number.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { parsePlantFile } from '../src/model/plant.js';

const GROUPS = ['pGeneral', 'pMeristem', 'pInternode', 'pLeaf', 'pSeedlingLeaf', 'pAxillaryBud', 'pInflor', 'pFlower', 'pFruit', 'pRoot'];
const posed = process.argv.includes('--posed');
const out = [];

function posesFor(plant) {
  const age = plant.age;
  plant.setAge(plant.pGeneral.ageAtMaturity);
  const amendments = [];
  for (let partID = 2; partID <= plant.partsCreated; partID += 3) {
    amendments.push({
      partID, typeOfPart: 'part', hide: partID % 29 === 2,
      addRotations: partID % 2 === 0, xRotation: (partID * 7) % 90, yRotation: -((partID * 11) % 60), zRotation: (partID * 13) % 45,
      multiplyScale: partID % 5 === 0, propagateScale: partID % 10 === 0,
      scaleMultiplier_pct: 50 + partID % 150, lengthMultiplier_pct: 60 + partID % 90, widthMultiplier_pct: 70 + partID % 80,
    });
  }
  plant.setAge(age);
  return amendments;
}
for (const file of readdirSync('data').filter((n) => n.endsWith('.pla'))) {
  for (const plant of parsePlantFile(readFileSync('data/' + file, 'latin1')).plants) {
    const params = { xRotation: plant.xRotation, yRotation: plant.yRotation, zRotation: plant.zRotation };
    for (const group of GROUPS) {
      params[group] = JSON.parse(JSON.stringify(plant[group], (key, value) => (key === 'zForSorting' || key === 'originPointIndex' ? undefined : value)));
    }
    const maturity = plant.pGeneral.ageAtMaturity;
    const entry = { file, name: plant.name, params, ages: [...new Set([plant.age, Math.round(maturity / 2), maturity])] };
    out.push(posed ? { ...entry, amendments: posesFor(plant), modes: ['output', 'screen'] } : entry);
  }
}
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(out.length, 'plants');
