// The plant as a whole, from uplant.pas: parameters, the daily growth step,
// .pla reading and writing, and breeding.

import { PARAMS } from './params.js';
import { Internode, Leaf, Meristem, Traverser, Mode, MALE, FEMALE, POSING } from './parts.js';
import { Tdo } from './tdo.js';
import { Turtle, DRAW_MODES } from './turtle.js';
import { NullSurface } from './surface.js';
import { Random, round, scurve, safediv, calcSCurveCoeffs, clamp, rgb } from './support.js';

const blankCurve = () => ({ x1: 0, y1: 0, x2: 0, y2: 0, c1: 0, c2: 0 });
const blankTdoParams = () => ({
  object3D: new Tdo(), xRotationBeforeDraw: 0, yRotationBeforeDraw: 0, zRotationBeforeDraw: 0,
  faceColor: 0, backfaceColor: 0, alternateFaceColor: 0, alternateBackfaceColor: 0,
  scaleAtFullSize: 0, repetitions: 0, radiallyArranged: false, pullBackAngle: 0,
});
const nineTdoParams = () => Array.from({ length: 9 }, blankTdoParams);

const measuringTurtle = new Turtle(new NullSurface());

export class Plant {
  constructor(name = '') {
    this.name = name;
    this.age = 0;
    this.basePoint_mm = { x: 0, y: 0 };
    this.xRotation = 0;
    this.yRotation = 0;
    this.zRotation = 0;
    this.drawingScale_PixelsPerMm = 1;
    this.hidden = false;
    this.selectedWhenLastSaved = false;
    this.noteLines = [];
    this.amendments = [];
    this.selectedPartID = -1;
    this.random = new Random();
    this.turtle = null;
    this.firstPhytomer = null;

    this.pGeneral = { growthSCurve: blankCurve() };
    this.pMeristem = {};
    this.pInternode = {
      lengthMultiplierDueToBiomassAccretion: 2, widthMultiplierDueToBiomassAccretion: 2,
      lengthMultiplierDueToExpansion: 1, widthMultiplierDueToExpansion: 1,
    };
    this.pLeaf = { leafTdoParams: blankTdoParams(), stipuleTdoParams: blankTdoParams(), sCurveParams: blankCurve() };
    this.pSeedlingLeaf = { leafTdoParams: blankTdoParams() };
    this.pAxillaryBud = { tdoParams: blankTdoParams() };
    this.pInflor = [{ bractTdoParams: blankTdoParams() }, { bractTdoParams: blankTdoParams() }];
    this.pFlower = [{ tdoParams: nineTdoParams() }, { tdoParams: nineTdoParams() }];
    this.pFruit = { tdoParams: blankTdoParams(), sCurveParams: blankCurve() };
    this.pRoot = { tdoParams: blankTdoParams() };

    this.reset();
  }

  // -------------------------------------------------------------- growth

  reset() {
    this.age = 0;
    this.firstPhytomer = null;
    this.partsCreated = 0;
    this.totalBiomass_pctMPB = 0;
    this.reproBiomass_pctMPB = 0;
    this.shootBiomass_pctMPB = 0;
    this.changeInShootBiomassToday_pctMPB = 0;
    this.changeInReproBiomassToday_pctMPB = 0;
    this.floweringHasStarted = false;
    this.ageAtWhichFloweringStarted = 0;
    this.numApicalActiveReproductive = 0;
    this.numAxillaryActiveReproductive = 0;
    this.numApicalInactiveReproductive = 0;
    this.numAxillaryInactiveReproductive = 0;
    this.unallocatedNewVegetativeBiomass_pctMPB = 0;
    this.unremovedDeadVegetativeBiomass_pctMPB = 0;
    this.unallocatedNewReproductiveBiomass_pctMPB = 0;
    this.unremovedDeadReproductiveBiomass_pctMPB = 0;
    this.random.seed = (this.pGeneral.startingSeedForRandomNumberGenerator ?? 0) << 16 >> 16;
  }

  setAge(newAge) {
    const target = clamp(newAge, 0, this.pGeneral.ageAtMaturity);
    this.reset();
    while (this.age < target) this.nextDay();
  }

  regrow() {
    this.setAge(this.age);
  }

  nextDay() {
    const g = this.pGeneral;
    const fractionToMaturity = safediv(this.age, g.ageAtMaturity, 0);
    const newTotal = clamp(100 * scurve(fractionToMaturity, g.growthSCurve.c1, g.growthSCurve.c2), 0, 100);
    const changeInTotal = newTotal - this.totalBiomass_pctMPB;
    this.totalBiomass_pctMPB = newTotal;
    if (this.floweringHasStarted) {
      const fractionRepro = Math.max(0, g.fractionReproductiveAllocationAtMaturity_frn
        * safediv(this.age - this.ageAtWhichFloweringStarted, g.ageAtMaturity - this.ageAtWhichFloweringStarted, 0));
      const newRepro = fractionRepro * this.totalBiomass_pctMPB;
      this.changeInReproBiomassToday_pctMPB = newRepro - this.reproBiomass_pctMPB;
      this.reproBiomass_pctMPB = newRepro;
      const newShoot = this.totalBiomass_pctMPB - this.reproBiomass_pctMPB;
      this.changeInShootBiomassToday_pctMPB = newShoot - this.shootBiomass_pctMPB;
      this.shootBiomass_pctMPB = newShoot;
    } else {
      this.changeInReproBiomassToday_pctMPB = 0;
      this.changeInShootBiomassToday_pctMPB = changeInTotal;
      this.shootBiomass_pctMPB = this.totalBiomass_pctMPB;
    }
    const traverser = new Traverser(this);
    if (!this.firstPhytomer) {
      const firstMeristem = new Meristem(this);
      this.firstPhytomer = firstMeristem.createFirstPhytomer();
      this.firstPhytomer.setAsFirstPhytomer();
      this.changeInShootBiomassToday_pctMPB -= firstMeristem.optimalInitialPhytomerBiomass();
    }
    if (!this.floweringHasStarted && this.age >= g.ageAtWhichFloweringStarts) {
      this.floweringHasStarted = true;
      this.ageAtWhichFloweringStarted = this.age;
      traverser.traverseWholePlant(Mode.StartReproduction);
    }
    this.allocateOrRemoveBiomass(traverser);
    traverser.traverseWholePlant(Mode.NextDay);
    this.age++;
  }

  // The reductions are negative here and so are skipped: the original's plants
  // never lose biomass this way, and removing it would change them.
  allocateOrRemoveBiomass(traverser) {
    let shootAdd = 0, shootCut = 0, reproAdd = 0, reproCut = 0;
    if (this.changeInShootBiomassToday_pctMPB > 0) {
      shootAdd = this.changeInShootBiomassToday_pctMPB + this.unallocatedNewVegetativeBiomass_pctMPB;
      this.unallocatedNewVegetativeBiomass_pctMPB = 0;
    } else {
      shootCut = this.changeInShootBiomassToday_pctMPB + this.unremovedDeadVegetativeBiomass_pctMPB;
      this.unremovedDeadVegetativeBiomass_pctMPB = 0;
    }
    if (this.changeInReproBiomassToday_pctMPB > 0) {
      reproAdd = this.changeInReproBiomassToday_pctMPB + this.unallocatedNewReproductiveBiomass_pctMPB;
      this.unallocatedNewReproductiveBiomass_pctMPB = 0;
    } else {
      reproCut = this.changeInReproBiomassToday_pctMPB + this.unremovedDeadReproductiveBiomass_pctMPB;
      this.unremovedDeadReproductiveBiomass_pctMPB = 0;
    }
    [shootAdd, shootCut] = cancelOutOppositeAmounts(shootAdd, shootCut);
    [reproAdd, reproCut] = cancelOutOppositeAmounts(reproAdd, reproCut);
    if (shootAdd > 0) this.unallocatedNewVegetativeBiomass_pctMPB = this.allocate(shootAdd, this.unallocatedNewVegetativeBiomass_pctMPB, Mode.DemandVegetative, Mode.GrowVegetative, traverser);
    if (shootCut > 0) this.unremovedDeadVegetativeBiomass_pctMPB = this.allocate(shootCut, this.unremovedDeadVegetativeBiomass_pctMPB, Mode.VegetativeBiomassThatCanBeRemoved, Mode.RemoveVegetativeBiomass, traverser);
    if (reproAdd > 0) this.unallocatedNewReproductiveBiomass_pctMPB = this.allocate(reproAdd, this.unallocatedNewReproductiveBiomass_pctMPB, Mode.DemandReproductive, Mode.GrowReproductive, traverser);
    if (reproCut > 0) this.unremovedDeadReproductiveBiomass_pctMPB = this.allocate(reproCut, this.unremovedDeadReproductiveBiomass_pctMPB, Mode.ReproductiveBiomassThatCanBeRemoved, Mode.RemoveReproductiveBiomass, traverser);
  }

  allocate(amount, undistributed, askingMode, tellingMode, traverser) {
    traverser.traverseWholePlant(askingMode);
    const available = traverser.total;
    if (available > 0) {
      if (amount > available) {
        undistributed = amount - available;
        traverser.fractionOfPotentialBiomass = 1;
      } else {
        traverser.fractionOfPotentialBiomass = safediv(amount, available, 0);
      }
      traverser.traverseWholePlant(tellingMode);
    } else {
      undistributed += amount;
    }
    return undistributed;
  }

  // -------------------------------------------------------------- drawing

  draw(turtle) {
    this.turtle = turtle;
    turtle.setLineColor(rgb(0, 128, 0));
    turtle.push();
    turtle.rotateZ(64);
    turtle.rotateX((this.xRotation * 256) / 360);
    turtle.rotateY((this.yRotation * 256) / 360);
    turtle.rotateZ((this.zRotation * 256) / 360);
    if (this.firstPhytomer) new Traverser(this).traverseWholePlant(Mode.Draw);
    turtle.pop();
    this.turtle = null;
  }

  drawOn(turtle, options, scale, x, y) {
    turtle.reset(options, scale, x, y);
    this.draw(turtle);
    turtle.surface.finish?.();
  }

  // -------------------------------------------------------------- posing

  amendmentForPartID(partID) {
    if (!this.amendments.length) return null;
    return this.amendments.find((amendment) => amendment.partID === partID) ?? null;
  }

  plantPartForPartID(partID) {
    const traverser = new Traverser(this);
    traverser.partID = partID;
    traverser.foundPlantPart = null;
    traverser.traverseWholePlant(Mode.FindPartForPartID);
    return traverser.foundPlantPart;
  }

  // The pixel rectangle the plant covers when its base is at (x, y).
  measure(scale, x, y) {
    measuringTurtle.reset(DRAW_MODES.bounds, scale, x, y);
    this.draw(measuringTurtle);
    const b = measuringTurtle.bounds;
    const extra = round(this.maximumLineWidth() * scale) + 1;
    return {
      left: round(b.left) - extra, top: round(b.top) - extra,
      right: round(b.right) + extra, bottom: round(b.bottom) + extra + (this.pRoot.showsAboveGround ? 2 : 0),
    };
  }

  maximumLineWidth() {
    return Math.max(0, this.pLeaf.petioleWidthAtOptimalBiomass_mm, this.pInternode.widthAtOptimalFinalBiomassAndExpansion_mm,
      this.pInflor[MALE].internodeWidth_mm, this.pInflor[FEMALE].internodeWidth_mm);
  }

  countParts() {
    return this.partsCreated;
  }

  // -------------------------------------------------------------- parameters

  get(param) {
    let target = this;
    for (const key of param.path) target = target[key];
    return target;
  }

  set(param, value) {
    let target = this;
    for (const key of param.path.slice(0, -1)) target = target[key];
    target[param.path.at(-1)] = value;
  }

  finishLoading() {
    const g = this.pGeneral;
    g.ageAtWhichFloweringStarts = Math.min(g.ageAtWhichFloweringStarts, g.ageAtMaturity);
    this.age = Math.min(this.age, g.ageAtMaturity);
    calcSCurveCoeffs(g.growthSCurve);
    calcSCurveCoeffs(this.pFruit.sCurveParams);
    calcSCurveCoeffs(this.pLeaf.sCurveParams);
    this.regrow();
  }

  copy() {
    const plant = new Plant(this.name);
    for (const param of FIELDS) {
      const value = this.get(param);
      plant.set(param, param.type === 'tdo' ? value.copy() : param.scurve ? { ...value } : value);
    }
    plant.noteLines = [...this.noteLines];
    plant.amendments = this.amendments.map((amendment) => ({ ...amendment }));
    plant.finishLoading();
    return plant;
  }
}

export function newDefaultPlant(name) {
  const plant = new Plant(name);
  setDefaultParameters(plant);
  plant.age = plant.pGeneral.ageAtMaturity;
  plant.finishLoading();
  return plant;
}

function cancelOutOppositeAmounts(added, taken) {
  if (added > 0 && taken > 0) {
    if (added === taken) return [0, 0];
    return added > taken ? [added - taken, 0] : [0, taken - added];
  }
  return [added, taken];
}

// ------------------------------------------------------------------ .pla files

const FIELDS = PARAMS.filter((p) => p.type !== 'header');
const FIELD_BY_ID = new Map(FIELDS.map((p) => [p.id, p]));

function parseScurve(text) {
  const [x1, y1, x2, y2] = text.trim().split(/\s+/).map(Number);
  return { x1, y1, x2, y2, c1: 0, c2: 0 };
}

function parseDefault(param) {
  const text = param.def;
  switch (param.type) {
    case 'bool': return /^t/i.test(text);
    case 'color': {
      const [r, g, b] = text.trim().split(/\s+/).map(Number);
      return rgb(r, g, b);
    }
    case 'tdo': return Tdo.fromInputString(text);
    case 'float':
      return param.scurve ? parseScurve(text) : parseFloat(text) || 0;
    default:
      return parseInt(text, 10) || 0;
  }
}

const clampToParam = (param, value) => (param.lower || param.upper ? clamp(value, param.lower ?? 0, param.upper ?? 0) : value);

function parseValue(param, text) {
  switch (param.type) {
    case 'bool': return /^\s*t/i.test(text);
    case 'color': return parseInt(text, 10) || 0;
    case 'float':
      if (param.scurve) return parseScurve(text);
      return clampToParam(param, parseFloat(text) || 0);
    default:
      return clampToParam(param, parseInt(text, 10) || 0);
  }
}

export const newAmendment = (partID, typeOfPart) => ({
  partID, typeOfPart, hide: false, addRotations: false, xRotation: 0, yRotation: 0, zRotation: 0,
  multiplyScale: false, propagateScale: false,
  scaleMultiplier_pct: 100, lengthMultiplier_pct: 100, widthMultiplier_pct: 100,
});

// Label in the file, field on the amendment, and how the value reads.
const AMENDMENT_FIELDS = [
  ['part number', 'partID', 'int'], ['part type', 'typeOfPart', 'text'], ['hide', 'hide', 'bool'],
  ['rotate', 'addRotations', 'bool'], ['x rotation', 'xRotation', 'int'], ['y rotation', 'yRotation', 'int'],
  ['z rotation', 'zRotation', 'int'], ['change scale', 'multiplyScale', 'bool'],
  ['propagate scale change up stem', 'propagateScale', 'bool'],
  ['3d object scale multiplier', 'scaleMultiplier_pct', 'int'],
  ['line length multiplier', 'lengthMultiplier_pct', 'int'],
  ['line width multiplier', 'widthMultiplier_pct', 'int'],
];

function readAmendmentLine(amendment, line) {
  const separator = line.indexOf('=');
  if (separator < 0) return;
  const label = line.slice(0, separator).trim().toLowerCase();
  const value = line.slice(separator + 1).trim();
  const field = AMENDMENT_FIELDS.find(([name]) => name === label);
  if (!field) return;
  const [, key, kind] = field;
  amendment[key] = kind === 'bool' ? /^t/i.test(value) : kind === 'int' ? parseInt(value, 10) || 0 : value;
}

function setDefaultParameters(plant) {
  for (const param of FIELDS) plant.set(param, parseDefault(param));
}

function readEmbeddedTdo(lines, index, tdo) {
  // A plant file holds "start 3D object", Name/Point/Triangle lines, "end 3D object".
  while (index < lines.length && !/start 3D object/i.test(lines[index])) index++;
  index++;
  for (; index < lines.length; index++) {
    const line = lines[index].trim();
    if (/end 3D object/i.test(line)) break;
    if (!line) continue;
    if (line.startsWith(';')) {
      const origin = /origin=(\d+)/i.exec(line);
      if (origin) tdo.originPointIndex = Number(origin[1]);
      continue;
    }
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1);
    if (key === 'point') tdo.addPointString(value);
    else if (key === 'triangle') tdo.addTriangleString(value);
    else if (key === 'name') tdo.name = value.trim();
    else if (key === 'origin') tdo.originPointIndex = Number(value);
  }
  tdo.adjustForOrigin();
  return index;
}

export function parsePlantFile(text) {
  const lines = text.split(/\r?\n/);
  const file = { plants: [], offset_mm: { x: 0, y: 0 }, scale: 1, concentrated: false, boxes: true };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('offset=')) {
      const [x, y] = line.slice(7).trim().split(/\s+/).map(Number);
      file.offset_mm = { x, y };
    } else if (line.startsWith('scale=')) {
      file.scale = round(parseFloat(line.slice(6)) * 100) / 100 || 1;
    } else if (line.startsWith('concentrated=')) {
      file.concentrated = /true/i.test(line);
    } else if (line.startsWith('boxes=')) {
      file.boxes = /true/i.test(line);
    } else if (line.startsWith('[') && /start PlantStudio plant/.test(line)) {
      const plant = new Plant(line.slice(1, line.indexOf(']')));
      setDefaultParameters(plant);
      index = readPlant(plant, lines, index + 1);
      plant.finishLoading();
      file.plants.push(plant);
    }
    index++;
  }
  return file;
}

function readPlant(plant, lines, index) {
  for (; index < lines.length; index++) {
    const line = lines[index];
    if (/end PlantStudio plant/.test(line)) break;
    if (!line.trim() || line.startsWith(';')) continue;
    if (line.includes('=== start note')) {
      plant.noteLines = [];
      for (index++; index < lines.length && !lines[index].includes('=== end note'); index++) plant.noteLines.push(lines[index]);
      continue;
    }
    if (line.includes('start posing change')) {
      const amendment = newAmendment(0, '');
      for (index++; index < lines.length && !lines[index].includes('end posing change'); index++) {
        readAmendmentLine(amendment, lines[index]);
      }
      plant.amendments.push(amendment);
      continue;
    }
    const fieldID = /\[(\w+)\]/.exec(line.slice(0, line.indexOf('=')))?.[1];
    const param = FIELD_BY_ID.get(fieldID);
    if (!param) continue;
    const value = line.slice(line.indexOf('=') + 1);
    if (param.type === 'tdo') {
      const tdo = new Tdo(value.trim());
      index = readEmbeddedTdo(lines, index + 1, tdo);
      plant.set(param, tdo);
    } else {
      plant.set(param, parseValue(param, value));
    }
  }
  return index;
}

const formatFloat = (n) => String(Number(n.toPrecision(7)));

export function plantToText(plant) {
  const out = [`[${plant.name}] start PlantStudio plant <v2.0>`];
  let section = null;
  for (const param of FIELDS) {
    if (param.section !== section) {
      section = param.section;
      out.push(`; ------------------------- ${section}`);
    }
    const value = plant.get(param);
    const label = `${param.name} [${param.id}] =`;
    if (param.type === 'tdo') {
      out.push(label + value.name, '  start 3D object', ...value.toFileLines(), '  end 3D object');
    } else if (param.scurve) {
      out.push(label + [value.x1, value.y1, value.x2, value.y2].join(' '));
    } else if (param.type === 'float') {
      out.push(label + formatFloat(value));
    } else {
      out.push(label + value);
    }
  }
  if (plant.noteLines.length) out.push('=== start note', ...plant.noteLines, '=== end note');
  for (const amendment of plant.amendments) {
    out.push('start posing change',
      ...AMENDMENT_FIELDS.map(([label, key, kind]) => `  ${label} =${kind === 'int' ? round(amendment[key]) : amendment[key]}`),
      'end posing change');
  }
  out.push(`[${plant.name}] end PlantStudio plant`, '');
  return out.join('\r\n');
}

export function plantsToFile(plants, offset_mm, scale) {
  const header = [
    '; PlantStudio version 2.0 plant file',
    `offset=${formatFloat(offset_mm.x)}  ${formatFloat(offset_mm.y)}`,
    `scale=${formatFloat(scale)}`,
    'concentrated=false',
    'orientation (top/side)=0',
    'boxes=true',
    '',
  ];
  return header.join('\r\n') + '\r\n' + plants.map(plantToText).join('\r\n');
}

// ------------------------------------------------------------------ breeding

export const MUTATION = { none: 0, low: 20, medium: 60, high: 100 };

const FROM_FIRST = 0, FROM_SECOND = 1, FROM_WEIGHTED = 2;

// One child of one or two parents. A section-by-section version of
// useBreedingOptionsAndPlantsToSetParameters, with a single mutation strength.
export function breed(first, second, options, generator, tdoLibrary = []) {
  const child = first.copy();
  const { mutation, firstWeight = 50, blendColors = true, randomTdos = false, nonNumeric = FROM_WEIGHTED } = options;
  const weight = firstWeight / 100;
  const fromFirst = () => {
    if (nonNumeric === FROM_FIRST) return true;
    if (nonNumeric === FROM_SECOND) return false;
    return generator.zeroToOne() < weight;
  };
  const age = first.age;
  child.amendments = [];
  child.reset();
  for (const param of FIELDS) {
    if (param.section === '(no section)') continue;
    const a = first.get(param);
    const b = second ? second.get(param) : a;
    switch (param.type) {
      case 'bool':
      case 'enum':
        child.set(param, !second || fromFirst() ? a : b);
        break;
      case 'int': {
        const mixed = a === b ? a : round(a * weight + b * (1 - weight));
        const stdDev = (0.5 * mixed * mutation) / 100;
        child.set(param, round(clamp(round(generator.normalWithStdDev(mixed, stdDev)), param.lower ?? -32768, param.upper ?? 32767)));
        break;
      }
      case 'float': {
        if (param.scurve) {
          child.set(param, { ...(!second || fromFirst() ? a : b) });
          break;
        }
        const mixed = a === b ? a : a * weight + b * (1 - weight);
        const stdDev = (0.5 * mixed * mutation) / 100;
        child.set(param, clamp(generator.normalWithStdDev(mixed, stdDev), param.lower ?? -Infinity, param.upper ?? Infinity));
        break;
      }
      case 'color':
        if (blendColors) {
          child.set(param, blendAndMutateColor(a, second ? b : null, weight, mutation, generator));
        } else {
          child.set(param, !second || fromFirst() ? a : b);
        }
        break;
      case 'tdo': {
        const picked = randomTdos && tdoLibrary.length
          ? tdoLibrary[Math.floor(generator.zeroToOne() * tdoLibrary.length) % tdoLibrary.length]
          : !second || fromFirst() ? a : b;
        child.set(param, picked.copy());
        break;
      }
    }
  }
  child.age = age;
  child.finishLoading();
  return child;
}

// The original blends the TColor as one big number, which is why bred colors
// drift across channels. Colors at mutation zero still shift by the low strength.
function blendAndMutateColor(first, second, weight, mutation, generator) {
  const a = first & 0xffffff;
  let result = a;
  if (second !== null) result = a * weight + (second & 0xffffff) * (1 - weight);
  const strength = mutation > 0 ? mutation : MUTATION.low;
  const fraction = (strength / 100) * 0.1;
  return clamp(round(generator.normalWithStdDev(result, result * fraction)), 0, 0xffffff);
}

export { Internode, Leaf, POSING };
