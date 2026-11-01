// The growing plant: upart, uintern, uleaf, umerist, uinflor and ufruit.pas in one
// file, since they all reference each other. Every call that draws from plant.random
// has to stay in its original order, or a saved plant grows into a different shape.

import { round, trunc, safediv, scurve, linearGrowthResult, linearGrowth, darkerColor, rgb } from './support.js';

export const MALE = 0, FEMALE = 1;
export const ALTERNATE = 0, OPPOSITE = 1;
const PINNATE = 0;
const LEFT = 0, RIGHT = 1;
const FLOWER_BUD = 1, OPEN_FLOWER = 2, UNRIPE_FRUIT = 3, RIPE_FRUIT = 4;
const BUD = 0, PISTILS = 1, STAMENS = 2, FIRST_PETALS = 3, SEPALS = 8;
const DRAW_NO_BUD = 0, DRAW_SINGLE_TDO_BUD = 1, DRAW_OPENING_FLOWER = 2;
const DONT_TAPER = -1;
const MAX_PARTS = 10000;
const COMPOUND_SWAY_COUNT = 49;
const USE_POSE = true;
const STEM_CYLINDER_FACES = 5;

// How poses show, from the original's domain options. drawingForOutput is on for
// thumbnails, printing and export, which show a pose but never its highlight colors.
export const POSING = {
  showPosingAtAll: true,
  showGhostingForHiddenParts: false,
  showHighlightingForNonHiddenPosedParts: true,
  drawingForOutput: false,
  ghostingColor: rgb(192, 192, 192),
  nonHiddenPosedColor: rgb(0, 0, 255),
  selectedPosedColor: rgb(255, 0, 0),
};

export const Mode = {
  NextDay: 1, DemandVegetative: 2, DemandReproductive: 3, GrowVegetative: 4,
  GrowReproductive: 5, StartReproduction: 6, Draw: 8, FindPartForPartID: 20,
  VegetativeBiomassThatCanBeRemoved: 12, RemoveVegetativeBiomass: 13,
  ReproductiveBiomassThatCanBeRemoved: 14, RemoveReproductiveBiomass: 15,
};

class Part {
  plant = null;
  liveBiomass = 0;
  deadBiomass = 0;
  biomassDemand = 0;
  gender = FEMALE;
  age = 0;
  randomSwayIndex = 0;
  hasFallenOff = false;
  isSeedlingLeaf = false;
  partID = 0;
  amendment = null;
  parentAmendment = null;

  initialize(plant) {
    this.plant = plant;
    this.partID = ++plant.partsCreated;
    this.randomSwayIndex = plant.random.zeroToOne();
  }

  nextDay() { this.age++; }
  isPhytomer() { return false; }
  totalBiomass() { return this.liveBiomass + this.deadBiomass; }

  // Shared start of traverseActivity. Returns false when the part should be skipped.
  beginActivity(mode, traverser) {
    if (mode === Mode.DemandVegetative || mode === Mode.DemandReproductive) this.biomassDemand = 0;
    if (mode === Mode.Draw) {
      traverser.totalPlantParts++;
      this.determineAmendment();
    }
    if (mode === Mode.FindPartForPartID && traverser.partID === this.partID) traverser.foundPlantPart = this;
    return !this.hasFallenOff;
  }

  // Poses. A pose on this part wins; otherwise a part inherits one from what it grew on.
  determineAmendment() {
    this.amendment = this.plant.amendmentForPartID(this.partID);
  }

  amendmentToPass() {
    return this.amendment ?? this.parentAmendment;
  }

  hiddenByAmendment() {
    if (!POSING.showPosingAtAll) return false;
    const { amendment, parentAmendment } = this;
    const hidden = amendment ? amendment.hide : parentAmendment?.hide;
    if (!hidden) return false;
    return POSING.drawingForOutput || !POSING.showGhostingForHiddenParts;
  }

  applyAmendmentRotations() {
    if (!this.amendment?.addRotations || !POSING.showPosingAtAll) return;
    const turtle = this.plant.turtle;
    turtle.rotateX((this.amendment.xRotation * 256) / 360);
    turtle.rotateY((this.amendment.yRotation * 256) / 360);
    turtle.rotateZ((this.amendment.zRotation * 256) / 360);
  }

  // Returns true if the part should use its own colors.
  setColorsWithAmendment(drawingTdo) {
    if (!POSING.showPosingAtAll) return true;
    const { amendment, parentAmendment, plant } = this;
    if (!amendment && !parentAmendment) return true;
    const showHighlights = POSING.showHighlightingForNonHiddenPosedParts && !POSING.drawingForOutput;
    let color;
    if (amendment && plant.selectedPartID === this.partID && showHighlights) color = POSING.selectedPosedColor;
    else if (amendment ? amendment.hide : parentAmendment.hide) color = POSING.ghostingColor;
    else if (amendment && showHighlights) color = POSING.nonHiddenPosedColor;
    else return true;
    if (drawingTdo) {
      plant.turtle.setForeColorBackColor(color, color);
      plant.turtle.setLineColor(darkerColor(color));
    } else {
      plant.turtle.setLineColor(color);
    }
    return false;
  }

  angleConsideringAmendment(axisRotation, useAmendment, angle) {
    if (!useAmendment || !this.amendment?.addRotations || !POSING.showPosingAtAll) return angle;
    return angle + (this.amendment[axisRotation] * 256) / 360;
  }

  multiplierFromAmendment(field) {
    if (!POSING.showPosingAtAll) return 1;
    const { amendment, parentAmendment } = this;
    const applies = amendment?.multiplyScale || (parentAmendment?.multiplyScale && parentAmendment.propagateScale);
    return applies ? (amendment ?? parentAmendment)[field] / 100 : 1;
  }

  removeBiomass(traverser) {
    const amount = this.liveBiomass * traverser.fractionOfPotentialBiomass;
    this.liveBiomass -= amount;
    this.deadBiomass += amount;
  }

  angleWithSway(angle) {
    return angle + (this.randomSwayIndex - 0.5) * this.plant.pGeneral.randomSway;
  }

  draw3DObject(tdo, scale, faceColor, backfaceColor) {
    if (!tdo) return;
    const turtle = this.plant.turtle;
    if (this.setColorsWithAmendment(true)) {
      turtle.setForeColorBackColor(faceColor, backfaceColor);
      turtle.setLineColor(darkerColor(faceColor));
    }
    turtle.setLineWidth(1);
    tdo.draw(turtle, scale * this.multiplierFromAmendment('scaleMultiplier_pct'), this.partID);
  }

  drawStemSegment(length, width, angleZ, angleY, color, taperIndex, useAmendment = false) {
    const turtle = this.plant.turtle;
    const exporting = turtle.options.exporting;
    if (this.setColorsWithAmendment(false)) turtle.setLineColor(color);
    const realLength = length * this.multiplierFromAmendment('lengthMultiplier_pct');
    const realWidth = width * this.multiplierFromAmendment('widthMultiplier_pct');
    if (exporting) turtle.surface.startStemSegment(color);
    const lineDivisions = this.plant.pGeneral.lineDivisions;
    const realAngleX = this.angleConsideringAmendment('xRotation', useAmendment, 0);
    const realAngleY = this.angleConsideringAmendment('yRotation', useAmendment, angleY);
    const realAngleZ = this.angleConsideringAmendment('zRotation', useAmendment, angleZ);
    const divided = lineDivisions > 1;
    const turnPortionZ = divided ? realAngleZ / lineDivisions : realAngleZ;
    const turnPortionY = divided ? realAngleY / lineDivisions : realAngleY;
    const drawPortion = divided ? realLength / lineDivisions : realLength;
    const endWidth = taperIndex > 0 ? (realWidth * taperIndex) / 100 : realWidth;
    let startPortionWidth = realWidth, endPortionWidth = realWidth;
    if (realAngleX !== 0) turtle.rotateX(realAngleX);
    for (let i = 0; i < lineDivisions; i++) {
      const isLast = i >= lineDivisions - 1;
      const segmentTurnZ = isLast ? realAngleZ - turnPortionZ * (lineDivisions - 1) : turnPortionZ;
      const segmentTurnY = isLast ? realAngleY - turnPortionY * (lineDivisions - 1) : turnPortionY;
      const segmentLength = isLast ? realLength - drawPortion * (lineDivisions - 1) : drawPortion;
      if (taperIndex > 0 && divided) {
        startPortionWidth = realWidth - (i / (lineDivisions - 1)) * (realWidth - endWidth);
        endPortionWidth = isLast ? endWidth : realWidth - ((i + 1) / (lineDivisions - 1)) * (realWidth - endWidth);
      }
      turtle.setLineWidth(startPortionWidth);
      turtle.rotateY(segmentTurnY);
      turtle.rotateZ(segmentTurnZ);
      if (exporting) this.write3DExportLine(segmentLength, startPortionWidth, endPortionWidth, i);
      else turtle.drawInMillimeters(segmentLength, this.partID);
    }
    if (exporting) turtle.surface.endStemSegment();
  }

  // For export a stem is a five-sided pipe rather than a line.
  write3DExportLine(length, startWidth, endWidth, segmentNumber) {
    const turtle = this.plant.turtle;
    const ring = (width) => {
      const points = [];
      for (let i = 0; i < STEM_CYLINDER_FACES; i++) {
        turtle.push();
        turtle.rotateX((i * 256) / STEM_CYLINDER_FACES);
        turtle.rotateZ(64);
        turtle.moveInMillimeters(0.5 * width);
        points.push(turtle.position());
        turtle.pop();
      }
      return points;
    };
    const startPoints = segmentNumber <= 0 ? ring(startWidth) : turtle.surface.lastPipeEnd;
    turtle.moveInMillimeters(length);
    turtle.surface.drawPipeFaces(startPoints, ring(endWidth), segmentNumber);
  }
}

// ---------------------------------------------------------------- internode

export class Internode extends Part {
  leftBranchPlantPart = null;
  rightBranchPlantPart = null;
  nextPlantPart = null;
  phytomerAttachedTo = null;
  leftLeaf = null;
  rightLeaf = null;
  internodeAngle = 0;
  lengthExpansion = 1;
  widthExpansion = 1;
  boltingExpansion = 1;
  fractionOfOptimalInitialBiomass = 0;
  traversingDirection = 0;
  isFirstPhytomer = false;
  newBiomassForDay = 0;

  constructor(plant, fraction) {
    super();
    this.initialize(plant);
    this.calculateInternodeAngle();
    this.fractionOfOptimalInitialBiomass = fraction;
    this.liveBiomass = fraction * Internode.optimalInitialBiomass(plant);
    this.leftLeaf = new Leaf(plant, fraction);
    if (plant.pMeristem.branchingAndLeafArrangement === OPPOSITE) this.rightLeaf = new Leaf(plant, fraction);
  }

  static optimalInitialBiomass(plant) {
    const p = plant.pInternode;
    return safediv(p.optimalFinalBiomass_pctMPB, p.lengthMultiplierDueToBiomassAccretion * p.widthMultiplierDueToBiomassAccretion, 0);
  }

  isPhytomer() { return true; }
  getName() { return 'internode'; }

  // The leaf line is as it is in uintern.pas: a right leaf's left neighbour gets
  // the pose again, and the right leaf never inherits one.
  determineAmendment() {
    super.determineAmendment();
    const amendment = this.amendmentToPass();
    if (this.leftBranchPlantPart) this.leftBranchPlantPart.parentAmendment = amendment;
    if (this.rightBranchPlantPart) this.rightBranchPlantPart.parentAmendment = amendment;
    if (this.nextPlantPart) this.nextPlantPart.parentAmendment = amendment;
    if (this.leftLeaf) this.leftLeaf.parentAmendment = amendment;
    if (this.rightLeaf) this.leftLeaf.parentAmendment = amendment;
  }

  makeSecondSeedlingLeaf(fraction) {
    if (!this.rightLeaf) this.rightLeaf = new Leaf(this.plant, fraction);
    this.rightLeaf.isSeedlingLeaf = true;
  }

  setAsFirstPhytomer() {
    this.isFirstPhytomer = true;
    if (this.leftLeaf) this.leftLeaf.isSeedlingLeaf = true;
    if (this.rightLeaf) this.rightLeaf.isSeedlingLeaf = true;
    this.calculateInternodeAngle();
  }

  calculateInternodeAngle() {
    const p = this.plant.pInternode;
    const index = this.isFirstPhytomer ? p.firstInternodeCurvingIndex : p.curvingIndex;
    this.internodeAngle = index === 0 ? 0 : (64 / 100) * this.plant.random.normalPercent(index);
    this.internodeAngle = this.angleWithSway(this.internodeAngle);
  }

  nextDay() {
    super.nextDay();
    if (this.liveBiomass > 0) {
      const old = safediv(this.liveBiomass - this.newBiomassForDay, this.liveBiomass, 0);
      const fresh = safediv(this.newBiomassForDay, this.liveBiomass, 0);
      this.lengthExpansion = Math.max(0, Math.min(500, old * this.lengthExpansion + fresh));
      this.widthExpansion = Math.max(0, Math.min(50, old * this.widthExpansion + fresh));
      if (this.plant.floweringHasStarted) {
        const p = this.plant.pInternode;
        this.boltingExpansion = linearGrowth(this.boltingExpansion, p.lengthMultiplierDueToBolting, p.minDaysToBolt);
      }
    }
    this.checkIfSeedlingLeavesHaveAbscissed();
  }

  checkIfSeedlingLeavesHaveAbscissed() {
    if (!this.isFirstPhytomer) return;
    const plant = this.plant;
    if (plant.pMeristem.branchingIsSympodial) {
      if (this.age < 10) return;
    } else if (this.distanceFromApicalMeristem() <= plant.pSeedlingLeaf.nodesOnStemWhenFallsOff) {
      return;
    }
    if (safediv(plant.age, plant.pGeneral.ageAtMaturity, 0) < 0.25) return;
    if (this.leftLeaf) this.leftLeaf.hasFallenOff = true;
    if (this.rightLeaf) this.rightLeaf.hasFallenOff = true;
  }

  distanceFromApicalMeristem() {
    let result = 0;
    let phytomer = this.nextPlantPart.isPhytomer() ? this.nextPlantPart : null;
    while (phytomer) {
      result++;
      phytomer = phytomer.nextPlantPart.isPhytomer() ? phytomer.nextPlantPart : null;
    }
    return result;
  }

  firstPhytomerOnBranch() {
    let result = this;
    while (result.phytomerAttachedTo && result.phytomerAttachedTo.nextPlantPart === result) {
      result = result.phytomerAttachedTo;
    }
    return result === this ? null : result;
  }

  traverseActivity(mode, traverser) {
    if (!this.beginActivity(mode, traverser)) return;
    if (mode !== Mode.Draw) {
      this.leftLeaf?.traverseActivity(mode, traverser);
      this.rightLeaf?.traverseActivity(mode, traverser);
    }
    const p = this.plant.pInternode;
    switch (mode) {
      case Mode.NextDay:
        this.nextDay();
        break;
      case Mode.DemandVegetative: {
        if (this.age > p.maxDaysToAccumulateBiomass) {
          this.biomassDemand = 0;
          return;
        }
        const target = p.canRecoverFromStuntingDuringCreation ? p.optimalFinalBiomass_pctMPB : p.optimalFinalBiomass_pctMPB * this.fractionOfOptimalInitialBiomass;
        this.biomassDemand = linearGrowthResult(this.liveBiomass, target, p.minDaysToAccumulateBiomass);
        traverser.total += this.biomassDemand;
        break;
      }
      case Mode.GrowVegetative:
        if (this.age > p.maxDaysToAccumulateBiomass) return;
        this.newBiomassForDay = Math.max(0, this.biomassDemand * traverser.fractionOfPotentialBiomass);
        this.liveBiomass += this.newBiomassForDay;
        break;
      case Mode.Draw:
        this.draw();
        break;
      case Mode.VegetativeBiomassThatCanBeRemoved:
        traverser.total += this.liveBiomass;
        break;
      case Mode.RemoveVegetativeBiomass:
        this.removeBiomass(traverser);
        break;
    }
  }

  propFullLength() {
    return safediv(this.totalBiomass() * this.lengthExpansion * this.boltingExpansion, this.plant.pInternode.optimalFinalBiomass_pctMPB, 0);
  }

  propFullWidth() {
    return safediv(this.totalBiomass() * this.widthExpansion, this.plant.pInternode.optimalFinalBiomass_pctMPB, 0);
  }

  draw() {
    if (!this.hiddenByAmendment()) {
      if (this.isFirstPhytomer && this.plant.pRoot.showsAboveGround) this.drawRootTop();
      this.drawInternode();
    }
    this.leftLeaf?.drawWithDirection(LEFT);
    this.rightLeaf?.drawWithDirection(RIGHT);
  }

  drawInternode() {
    const { plant } = this;
    let zAngle = this.internodeAngle;
    const parent = this.phytomerAttachedTo;
    if (parent) {
      if (parent.leftBranchPlantPart === this) {
        zAngle += plant.pMeristem.branchingAngle;
      } else if (parent.rightBranchPlantPart === this) {
        zAngle += plant.pMeristem.branchingAngle;
        plant.turtle.rotateX(128);
      }
    }
    const p = plant.pInternode;
    const length = Math.max(0, this.propFullLength() * p.lengthAtOptimalFinalBiomassAndExpansion_mm);
    const width = Math.max(0, this.propFullWidth() * p.widthAtOptimalFinalBiomassAndExpansion_mm);
    this.drawStemSegment(length, width, zAngle, 0, p.faceColor, DONT_TAPER, USE_POSE);
  }

  drawRootTop() {
    const { plant } = this;
    const turtle = plant.turtle;
    const params = plant.pRoot.tdoParams;
    const numParts = 5;
    const scale = (safediv(plant.age, plant.pGeneral.ageAtMaturity, 0) * params.scaleAtFullSize) / 100;
    const tdo = params.object3D;
    let minZ = 0;
    turtle.push();
    for (let i = 1; i <= numParts; i++) {
      turtle.rotateX(trunc(256 / numParts));
      turtle.push();
      turtle.rotateZ(64);
      turtle.rotateY(-64);
      if (tdo) {
        turtle.rotateX(this.angleWithSway(params.xRotationBeforeDraw));
        turtle.rotateY(this.angleWithSway(params.yRotationBeforeDraw));
        turtle.rotateZ(this.angleWithSway(params.zRotationBeforeDraw));
        this.draw3DObject(tdo, scale, params.faceColor, params.backfaceColor);
        minZ = i === 1 ? tdo.zForSorting : Math.min(minZ, tdo.zForSorting);
      }
      turtle.pop();
    }
    if (tdo) tdo.zForSorting = minZ;
    turtle.pop();
  }
}

// ---------------------------------------------------------------- leaf

export class Leaf extends Part {
  propFullSize = 0;
  compoundLeafRandomSwayIndexes = [];

  constructor(plant, fraction) {
    super();
    this.initialize(plant);
    const p = plant.pLeaf;
    this.liveBiomass = fraction * Leaf.optimalInitialBiomass(plant);
    this.propFullSize = safediv(this.liveBiomass, p.optimalBiomass_pctMPB, 1);
    if (p.compoundNumLeaflets > 1) {
      for (let i = 0; i <= COMPOUND_SWAY_COUNT; i++) this.compoundLeafRandomSwayIndexes[i] = plant.random.zeroToOne();
    }
  }

  static optimalInitialBiomass(plant) {
    return plant.pLeaf.optimalFractionOfOptimalBiomassAtCreation_frn * plant.pLeaf.optimalBiomass_pctMPB;
  }

  getName() { return 'leaf'; }

  traverseActivity(mode, traverser) {
    if (!this.beginActivity(mode, traverser)) return;
    const p = this.plant.pLeaf;
    switch (mode) {
      case Mode.NextDay:
        this.nextDay();
        break;
      case Mode.DemandVegetative: {
        if (this.age > p.maxDaysToGrow) {
          this.biomassDemand = 0;
          return;
        }
        const fractionOfMaxAge = safediv(this.age + 1, p.maxDaysToGrow, 0);
        const wanted = Math.max(0, Math.min(1, scurve(fractionOfMaxAge, p.sCurveParams.c1, p.sCurveParams.c2)));
        this.biomassDemand = linearGrowthResult(this.liveBiomass, wanted * p.optimalBiomass_pctMPB, p.minDaysToGrow);
        traverser.total += this.biomassDemand;
        break;
      }
      case Mode.GrowVegetative:
        if (this.age > p.maxDaysToGrow) return;
        this.liveBiomass += this.biomassDemand * traverser.fractionOfPotentialBiomass;
        this.propFullSize = Math.min(1, safediv(this.totalBiomass(), p.optimalBiomass_pctMPB, 0));
        break;
      case Mode.VegetativeBiomassThatCanBeRemoved:
        traverser.total += this.liveBiomass;
        break;
      case Mode.RemoveVegetativeBiomass:
        this.removeBiomass(traverser);
        break;
    }
  }

  drawWithDirection(direction) {
    if (this.hasFallenOff) return;
    const { plant } = this;
    const turtle = plant.turtle;
    const p = plant.pLeaf;
    turtle.push();
    this.determineAmendment();
    if (this.hiddenByAmendment()) {
      turtle.pop();
      return;
    }
    turtle.push();
    if (direction === RIGHT) turtle.rotateX(128);
    let length = p.petioleLengthAtOptimalBiomass_mm * this.propFullSize;
    if (this.isSeedlingLeaf) length /= 2;
    const width = p.petioleWidthAtOptimalBiomass_mm * this.propFullSize;
    const angle = this.angleWithSway(p.petioleAngle);
    if (this.isSeedlingLeaf) {
      this.drawStemSegment(length, width, angle, 0, p.petioleColor, p.petioleTaperIndex, USE_POSE);
      this.drawLeafOrLeaflet(this.propFullSize * (plant.pSeedlingLeaf.leafTdoParams.scaleAtFullSize / 100));
    } else {
      if (p.stipuleTdoParams.scaleAtFullSize > 0) this.drawStipule();
      if (p.compoundNumLeaflets <= 1) {
        this.drawStemSegment(length, width, angle, 0, p.petioleColor, p.petioleTaperIndex, USE_POSE);
        this.drawLeafOrLeaflet((this.propFullSize * p.leafTdoParams.scaleAtFullSize) / 100);
      } else {
        this.drawStemSegment(length, width, angle, 0, p.petioleColor, DONT_TAPER, USE_POSE);
        if (p.compoundPinnateOrPalmate === PINNATE) this.drawCompoundLeafPinnate();
        else this.drawCompoundLeafPalmate();
      }
    }
    turtle.pop();
    turtle.pop();
  }

  drawStipule() {
    const turtle = this.plant.turtle;
    const params = this.plant.pLeaf.stipuleTdoParams;
    turtle.push();
    turtle.rotateX(this.angleWithSway(params.xRotationBeforeDraw));
    turtle.rotateY(this.angleWithSway(params.yRotationBeforeDraw));
    turtle.rotateZ(this.angleWithSway(params.zRotationBeforeDraw));
    const scale = this.propFullSize * (params.scaleAtFullSize / 100);
    const object3D = params.object3D;
    if (params.repetitions > 1) {
      const turns = new TurnSharer(params.repetitions);
      for (let i = 0; i < params.repetitions; i++) {
        turtle.rotateY(turns.next());
        this.draw3DObject(object3D, scale, params.faceColor, params.backfaceColor);
      }
    } else {
      this.draw3DObject(object3D, scale, params.faceColor, params.backfaceColor);
    }
    turtle.pop();
  }

  drawLeafOrLeaflet(scale) {
    const turtle = this.plant.turtle;
    const params = this.isSeedlingLeaf ? this.plant.pSeedlingLeaf.leafTdoParams : this.plant.pLeaf.leafTdoParams;
    turtle.setLineWidth(1);
    turtle.rotateX(this.angleWithSway(params.xRotationBeforeDraw));
    turtle.rotateY(this.angleWithSway(params.yRotationBeforeDraw));
    turtle.rotateZ(this.angleWithSway(params.zRotationBeforeDraw));
    turtle.rotateZ(-64);
    this.draw3DObject(params.object3D, scale, params.faceColor, params.backfaceColor);
  }

  drawCompoundLeafPinnate() {
    const turtle = this.plant.turtle;
    const p = this.plant.pLeaf;
    for (let i = p.compoundNumLeaflets; i >= 1; i--) {
      if (p.compoundPinnateLeafletArrangement === OPPOSITE) {
        if (i !== 1 && i % 2 === 1) this.drawCompoundLeafInternode(i);
      } else if (i !== 1) {
        this.drawCompoundLeafInternode(i);
      }
      turtle.push();
      const scale = (this.propFullSize * p.leafTdoParams.scaleAtFullSize) / 100;
      this.drawCompoundLeafPetiolet(scale, i);
      this.drawLeafOrLeaflet(scale);
      turtle.pop();
    }
  }

  drawCompoundLeafInternode(count) {
    const p = this.plant.pLeaf;
    const length = (p.petioleLengthAtOptimalBiomass_mm * this.propFullSize * p.compoundRachisToPetioleRatio) / 100;
    const width = p.petioleWidthAtOptimalBiomass_mm * this.propFullSize;
    const angleZ = this.compoundLeafAngleWithSway(this.bendAngleForCompoundLeaf(count), count);
    const angleY = this.compoundLeafAngleWithSway(0, count);
    this.drawStemSegment(length, width, angleZ, angleY, p.petioleColor, DONT_TAPER);
  }

  bendAngleForCompoundLeaf(count) {
    const p = this.plant.pLeaf;
    const difference = Math.abs(p.compoundCurveAngleAtFullSize - p.compoundCurveAngleAtStart);
    const leafletNumberEffect = 0.75 + 0.25 * safediv(count, p.compoundNumLeaflets - 1, 0);
    const prop = Math.max(0, Math.min(1, (0.25 + 0.75 * this.propFullSize) * leafletNumberEffect));
    return p.compoundCurveAngleAtFullSize > p.compoundCurveAngleAtStart
      ? p.compoundCurveAngleAtStart + difference * prop
      : p.compoundCurveAngleAtStart - difference * prop;
  }

  drawCompoundLeafPetiolet(scale, count) {
    const p = this.plant.pLeaf;
    const length = scale * p.petioleLengthAtOptimalBiomass_mm * this.propFullSize;
    const width = scale * p.petioleWidthAtOptimalBiomass_mm * this.propFullSize;
    const angle = count === 1 ? 0 : count % 2 === 1 ? 32 : -32;
    this.drawStemSegment(length, width, 0, this.compoundLeafAngleWithSway(angle, count), p.petioleColor, p.petioleTaperIndex);
  }

  compoundLeafAngleWithSway(angle, count) {
    const index = Math.max(0, count) % COMPOUND_SWAY_COUNT;
    return angle + (this.compoundLeafRandomSwayIndexes[index] - 0.5) * this.plant.pGeneral.randomSway;
  }

  drawCompoundLeafPalmate() {
    const turtle = this.plant.turtle;
    const p = this.plant.pLeaf;
    const angleOne = safediv(64, p.compoundNumLeaflets, 0);
    for (let i = p.compoundNumLeaflets; i >= 1; i--) {
      turtle.push();
      const angle = i === 1 ? 0 : i % 2 === 1 ? -angleOne * i : angleOne * i;
      const length = (p.petioleLengthAtOptimalBiomass_mm * this.propFullSize * p.compoundRachisToPetioleRatio) / 100;
      const width = p.petioleWidthAtOptimalBiomass_mm * this.propFullSize;
      this.drawStemSegment(length, width, 0, angle, p.petioleColor, p.petioleTaperIndex);
      this.drawLeafOrLeaflet((this.propFullSize * p.leafTdoParams.scaleAtFullSize) / 100);
      turtle.pop();
    }
  }
}

// Shares out the turns of a whorl so that n parts use the whole 256, with the
// remainder of 256 div n carried along.
class TurnSharer {
  constructor(count) {
    this.turnPortion = trunc(256 / count);
    const leftOver = 256 - this.turnPortion * count;
    this.addition = leftOver > 0 ? leftOver / count : 0;
    this.carryOver = 0;
  }

  next() {
    const addThisTime = trunc(this.addition + this.carryOver);
    this.carryOver = Math.max(0, this.carryOver + this.addition - addThisTime);
    return this.turnPortion + addThisTime;
  }
}

// ---------------------------------------------------------------- meristem

export class Meristem extends Part {
  phytomerAttachedTo = null;
  daysCreatingThisPlantPart = 0;
  isActive = false;
  isApical = true;
  isReproductive = false;

  constructor(plant) {
    super();
    this.initialize(plant);
    if (plant.floweringHasStarted && plant.random.zeroToOne() <= plant.pMeristem.determinateProbability) {
      this.setIfReproductive(true);
    }
  }

  getName() { return 'meristem'; }

  nextDay() {
    super.nextDay();
    if (this.isActive) {
      this.daysCreatingThisPlantPart++;
      if (!this.isReproductive) this.accumulateOrCreatePhytomer();
      else this.accumulateOrCreateInflorescence();
    } else if (!this.isApical && !this.isReproductive && this.contemplateBranching()) {
      this.setIfActive(true);
    }
  }

  contemplateBranching() {
    const { plant } = this;
    const p = plant.pMeristem;
    if (p.branchingIndex === 0) return false;
    if (!p.secondaryBranchingIsAllowed && this.phytomerAttachedTo.firstPhytomerOnBranch() !== plant.firstPhytomer) return false;
    if (p.branchingIndex === 100) return true;
    const distance = this.phytomerAttachedTo.distanceFromApicalMeristem();
    let decisionPercent = p.branchingIndex;
    if (distance < p.branchingDistance) {
      decisionPercent = p.branchingIndex * Math.min(1, Math.max(0, safediv(distance, p.branchingDistance, 0)));
    }
    return plant.random.percent() < decisionPercent;
  }

  optimalInitialPhytomerBiomass() {
    const { plant } = this;
    let result = Internode.optimalInitialBiomass(plant) + Leaf.optimalInitialBiomass(plant);
    if (plant.pMeristem.branchingAndLeafArrangement === OPPOSITE) result += Leaf.optimalInitialBiomass(plant);
    return result;
  }

  accumulateOrCreatePhytomer() {
    const p = this.plant.pInternode;
    const optimal = this.optimalInitialPhytomerBiomass();
    const shouldCreate = this.liveBiomass >= optimal
      || (this.liveBiomass >= optimal * p.minFractionOfOptimalInitialBiomassToCreateInternode_frn
        && this.daysCreatingThisPlantPart >= p.maxDaysToCreateInternodeIfOverMinFraction);
    if (shouldCreate) {
      this.createPhytomer(safediv(this.liveBiomass, optimal, 0));
      this.liveBiomass = 0;
      this.daysCreatingThisPlantPart = 0;
    }
  }

  accumulateOrCreateInflorescence() {
    if (this.phytomerAttachedTo.isFirstPhytomer || !this.isReproductive || !this.isActive) return;
    const { plant } = this;
    const optimal = Inflorescence.optimalInitialBiomass(plant, this.gender);
    const shouldCreate = this.liveBiomass >= optimal
      || (this.liveBiomass >= optimal * plant.pInternode.minFractionOfOptimalInitialBiomassToCreateInternode_frn
        && this.daysCreatingThisPlantPart >= plant.pInflor[this.gender].maxDaysToCreateInflorescenceIfOverMinFraction);
    if (shouldCreate) {
      this.createInflorescence(safediv(this.liveBiomass, optimal, 0));
      this.liveBiomass = 0;
      this.daysCreatingThisPlantPart = 0;
    }
  }

  traverseActivity(mode, traverser) {
    if (!this.beginActivity(mode, traverser)) return;
    const { plant } = this;
    switch (mode) {
      case Mode.NextDay:
        this.nextDay();
        break;
      case Mode.DemandVegetative: {
        if (!this.isActive || this.isReproductive) return;
        if (!this.isApical && this.phytomerAttachedTo.isFirstPhytomer && !plant.pMeristem.branchingIsSympodial) return;
        this.biomassDemand = linearGrowthResult(this.liveBiomass, this.optimalInitialPhytomerBiomass(), plant.pInternode.minDaysToCreateInternode);
        traverser.total += this.biomassDemand;
        break;
      }
      case Mode.DemandReproductive: {
        if (!this.isActive || !this.isReproductive) return;
        if (this.phytomerAttachedTo.isFirstPhytomer && !this.isApical) return;
        const p = plant.pInflor[this.gender];
        this.biomassDemand = linearGrowthResult(this.liveBiomass, p.optimalBiomass_pctMPB, p.minDaysToCreateInflorescence);
        traverser.total += this.biomassDemand;
        break;
      }
      case Mode.GrowVegetative:
        if (!this.isActive || this.isReproductive) return;
        this.liveBiomass += this.biomassDemand * traverser.fractionOfPotentialBiomass;
        break;
      case Mode.GrowReproductive:
        if (!this.isActive || !this.isReproductive) return;
        this.liveBiomass += this.biomassDemand * traverser.fractionOfPotentialBiomass;
        break;
      case Mode.StartReproduction:
        this.startReproduction();
        break;
      case Mode.Draw:
        this.draw();
        break;
      case Mode.VegetativeBiomassThatCanBeRemoved:
        if (this.isActive && !this.isReproductive) traverser.total += this.liveBiomass;
        break;
      case Mode.ReproductiveBiomassThatCanBeRemoved:
        if (this.isActive && this.isReproductive) traverser.total += this.liveBiomass;
        break;
      case Mode.RemoveVegetativeBiomass:
        if (this.isActive && !this.isReproductive) this.removeBiomass(traverser);
        break;
      case Mode.RemoveReproductiveBiomass:
        if (this.isActive && this.isReproductive) this.removeBiomass(traverser);
        break;
    }
  }

  createAxillaryMeristem(direction) {
    const meristem = new Meristem(this.plant);
    meristem.setIfApical(false);
    meristem.phytomerAttachedTo = this.phytomerAttachedTo;
    if (direction === LEFT) this.phytomerAttachedTo.leftBranchPlantPart = meristem;
    else this.phytomerAttachedTo.rightBranchPlantPart = meristem;
    return meristem;
  }

  // The plant keeps four running counts of reproductive meristems; these setters
  // are the only place they move.
  count(apical, active, change) {
    const { plant } = this;
    if (active) {
      if (apical) plant.numApicalActiveReproductive += change;
      else plant.numAxillaryActiveReproductive += change;
    } else if (apical) {
      plant.numApicalInactiveReproductive += change;
    } else {
      plant.numAxillaryInactiveReproductive += change;
    }
  }

  setIfActive(active) {
    if (this.isActive === active) return;
    this.isActive = active;
    if (this.isReproductive) {
      this.count(this.isApical, active, 1);
      this.count(this.isApical, !active, -1);
    }
  }

  setIfApical(apical) {
    if (this.isApical === apical) return;
    this.isApical = apical;
    if (this.isReproductive) {
      this.count(apical, this.isActive, 1);
      this.count(!apical, this.isActive, -1);
    }
  }

  setIfReproductive(reproductive) {
    if (this.isReproductive === reproductive) return;
    this.isReproductive = reproductive;
    this.count(this.isApical, this.isActive, 1);
  }

  createFirstPhytomer() {
    this.createPhytomer(1);
    const phytomer = this.phytomerAttachedTo;
    if (this.plant.pGeneral.isDicot) phytomer.makeSecondSeedlingLeaf(this.optimalInitialPhytomerBiomass());
    return phytomer;
  }

  createInflorescence(fractionOfOptimalSize) {
    const { plant } = this;
    if (plant.partsCreated > MAX_PARTS) return;
    const inflorescence = new Inflorescence(plant, this.gender, this.isApical, fractionOfOptimalSize);
    inflorescence.phytomerAttachedTo = this.phytomerAttachedTo;
    const parent = this.phytomerAttachedTo;
    if (this.isApical) parent.nextPlantPart = inflorescence;
    else if (parent.leftBranchPlantPart === this) parent.leftBranchPlantPart = inflorescence;
    else if (parent.rightBranchPlantPart === this) parent.rightBranchPlantPart = inflorescence;
    this.phytomerAttachedTo = null;
  }

  createPhytomer(fractionOfFullSize) {
    const { plant } = this;
    if (plant.partsCreated > MAX_PARTS) return;
    const p = plant.pMeristem;
    const phytomer = new Internode(plant, fractionOfFullSize);
    const parent = this.phytomerAttachedTo;
    phytomer.phytomerAttachedTo = parent;
    const alternate = p.branchingAndLeafArrangement === ALTERNATE;
    if (parent) {
      if (this.isApical) {
        parent.nextPlantPart = phytomer;
        if (p.branchingIsSympodial) this.setIfActive(false);
      } else {
        if (parent.leftBranchPlantPart === this) parent.leftBranchPlantPart = phytomer;
        else if (parent.rightBranchPlantPart === this) parent.rightBranchPlantPart = phytomer;
        this.setIfApical(true);
      }
      this.phytomerAttachedTo = phytomer;
      phytomer.nextPlantPart = this;
      const left = this.createAxillaryMeristem(LEFT);
      if (alternate) {
        if (p.branchingIsSympodial) left.setIfActive(true);
      } else {
        const right = this.createAxillaryMeristem(RIGHT);
        if (p.branchingIsSympodial) {
          if (plant.random.zeroToOne() < 0.5) left.setIfActive(true);
          else right.setIfActive(true);
        }
      }
    } else {
      this.setIfApical(true);
      this.setIfActive(!p.branchingIsSympodial);
      this.phytomerAttachedTo = phytomer;
      phytomer.nextPlantPart = this;
      if (p.branchingIsSympodial) {
        const left = this.createAxillaryMeristem(LEFT);
        if (alternate) {
          left.setIfActive(true);
        } else {
          const right = this.createAxillaryMeristem(RIGHT);
          if (plant.random.zeroToOne() < 0.5) left.setIfActive(true);
          else right.setIfActive(true);
        }
      }
    }
  }

  draw() {
    const { plant } = this;
    const params = plant.pAxillaryBud.tdoParams;
    if (params.scaleAtFullSize === 0 || this.hiddenByAmendment()) return;
    this.applyAmendmentRotations();
    if (this.isApical) return;
    const turtle = plant.turtle;
    const daysToFullSize = 5;
    const scale = (params.scaleAtFullSize / 100) * Math.min(1, this.age / daysToFullSize);
    const numParts = 5;
    const tdo = params.object3D;
    let minZ = 0;
    for (let i = 1; i <= numParts; i++) {
      turtle.rotateX(trunc(256 / numParts));
      turtle.push();
      turtle.rotateZ(-64);
      if (tdo) {
        turtle.rotateX(this.angleWithSway(params.xRotationBeforeDraw));
        turtle.rotateY(this.angleWithSway(params.yRotationBeforeDraw));
        turtle.rotateZ(this.angleWithSway(params.zRotationBeforeDraw));
        this.draw3DObject(tdo, scale, params.faceColor, params.backfaceColor);
        minZ = i === 1 ? tdo.zForSorting : Math.min(minZ, tdo.zForSorting);
      }
      turtle.pop();
    }
    if (tdo) tdo.zForSorting = minZ;
  }

  startReproduction() {
    const { plant } = this;
    if (plant.random.zeroToOne() <= plant.pMeristem.determinateProbability) this.setIfReproductive(true);
    if (!this.isReproductive) return;
    this.setIfActive(false);
    this.gender = FEMALE;
    if (plant.pGeneral.maleFlowersAreSeparate) {
      if (this.isApical === plant.pInflor[MALE].isTerminal) this.gender = MALE;
      if (this.decideIfActiveFemale()) this.gender = FEMALE;
    }
    if (this.willCreateInflorescence()) this.setIfActive(true);
  }

  decideIfActiveFemale() {
    const { plant } = this;
    const result = this.isApical === plant.pInflor[FEMALE].isTerminal;
    return result && this.gender === MALE ? plant.random.zeroToOne() < 0.5 : result;
  }

  willCreateInflorescence() {
    const { plant } = this;
    if (this.phytomerAttachedTo.isFirstPhytomer && !this.isApical) return false;
    const numExpected = this.isApical ? plant.pGeneral.numApicalInflors : plant.pGeneral.numAxillaryInflors;
    const numAlready = this.isApical ? plant.numApicalActiveReproductive : plant.numAxillaryActiveReproductive;
    const inactive = this.isApical ? plant.numApicalInactiveReproductive : plant.numAxillaryInactiveReproductive;
    const probability = numExpected <= 3 ? 1 : safediv(numExpected - numAlready, inactive, 0);
    return plant.random.zeroToOne() < probability ? numAlready < numExpected : false;
  }
}

// ---------------------------------------------------------------- inflorescence

export class Inflorescence extends Part {
  flowers = [];
  numFlowers = 0;
  numFlowersEachDay = 0;
  daysBetweenFlowerAppearances = 0;
  daysSinceLastFlowerAppeared = 0;
  daysSinceStartedMakingFlowers = 0;
  phytomerAttachedTo = null;

  constructor(plant, gender, isApical, fractionOfOptimalSize) {
    super();
    this.initialize(plant);
    this.gender = gender;
    this.isApical = isApical;
    this.fractionOfOptimalSizeWhenCreated = Math.min(1, fractionOfOptimalSize);
    const p = plant.pInflor[gender];
    const days = p.daysToAllFlowersCreated;
    this.numFlowers = p.numFlowersOnMainBranch + p.numFlowersPerBranch * p.numBranches;
    if (this.numFlowers > 0) {
      if (this.numFlowers === 1 || this.numFlowers === days) this.numFlowersEachDay = 1;
      else if (this.numFlowers > days) this.numFlowersEachDay = round(safediv(this.numFlowers, days, 0));
      else this.daysBetweenFlowerAppearances = round(safediv(days, this.numFlowers, 0));
    }
  }

  static optimalInitialBiomass(plant, gender) {
    const p = plant.pInflor[gender];
    return p.optimalBiomass_pctMPB * p.minFractionOfOptimalBiomassToCreateInflorescence_frn;
  }

  get params() { return this.plant.pInflor[this.gender]; }

  getName() { return 'inflorescence'; }

  determineAmendment() {
    super.determineAmendment();
    for (const flower of this.flowers) flower.parentAmendment = this.amendmentToPass();
  }

  // Flowers are also stepped by the traversal below, so they age twice a day.
  // Plants were tuned against that, so it stays.
  nextDay() {
    super.nextDay();
    for (const flower of this.flowers) flower.nextDay();
    const p = this.params;
    if (this.liveBiomass < p.minFractionOfOptimalBiomassToMakeFlowers_frn * p.optimalBiomass_pctMPB) return;
    this.daysSinceStartedMakingFlowers++;
    if (this.flowers.length <= 0 && this.numFlowers > 0) {
      this.createFlower();
    } else if (this.flowers.length < this.numFlowers) {
      if (this.daysBetweenFlowerAppearances > 0) {
        if (this.daysSinceLastFlowerAppeared >= this.daysBetweenFlowerAppearances) {
          this.createFlower();
          this.daysSinceLastFlowerAppeared = 0;
        } else {
          this.daysSinceLastFlowerAppeared++;
        }
      } else {
        const toCreate = Math.min(this.numFlowersEachDay, this.numFlowers - this.flowers.length);
        for (let i = 0; i < toCreate; i++) this.createFlower();
        this.daysSinceLastFlowerAppeared = 0;
      }
    }
  }

  createFlower() {
    if (this.plant.partsCreated > MAX_PARTS) return;
    this.flowers.push(new FlowerFruit(this.plant, this.gender));
  }

  traverseActivity(mode, traverser) {
    if (!this.beginActivity(mode, traverser)) return;
    if (mode !== Mode.Draw) {
      for (const flower of this.flowers) flower.traverseActivity(mode, traverser);
    }
    const p = this.params;
    switch (mode) {
      case Mode.NextDay:
        this.nextDay();
        break;
      case Mode.DemandReproductive:
        if (this.age > p.maxDaysToGrow) {
          this.biomassDemand = 0;
          return;
        }
        this.biomassDemand = linearGrowthResult(this.liveBiomass, p.optimalBiomass_pctMPB, p.minDaysToGrow);
        traverser.total += this.biomassDemand;
        break;
      case Mode.GrowReproductive:
        if (this.age > p.maxDaysToGrow) return;
        this.liveBiomass += this.biomassDemand * traverser.fractionOfPotentialBiomass;
        break;
      case Mode.Draw:
        this.draw();
        break;
      case Mode.ReproductiveBiomassThatCanBeRemoved:
        traverser.total += this.liveBiomass;
        break;
      case Mode.RemoveReproductiveBiomass:
        this.removeBiomass(traverser);
        break;
    }
  }

  allFlowersHaveBeenDrawn() {
    return this.flowers.every((flower) => flower.hasBeenDrawn);
  }

  propFullSize() {
    return safediv(this.liveBiomass, this.params.optimalBiomass_pctMPB, 0);
  }

  draw() {
    if (this.flowers.every((flower) => flower.hasFallenOff)) return;
    const turtle = this.plant.turtle;
    turtle.push();
    if (this.hiddenByAmendment()) {
      turtle.pop();
      return;
    }
    for (const flower of this.flowers) flower.hasBeenDrawn = false;
    if (this.flowers.length) {
      this.drawBracts();
      this.drawPeduncle();
      if (this.params.isHead) this.drawHead();
      else this.drawApex(this.params.numFlowersOnMainBranch, 0, true);
    }
    turtle.pop();
  }

  drawApex(internodeCount, flowerIndexOffset, mainBranch) {
    const turtle = this.plant.turtle;
    const p = this.params;
    let branchesDrawn = 0;
    let i = 0;
    if (internodeCount > 0) {
      if (mainBranch) {
        turtle.push();
        while (branchesDrawn < p.numBranches) {
          this.drawInternode();
          branchesDrawn++;
        }
      }
      for (i = internodeCount; i >= 1; i--) {
        if (p.flowersSpiralOnStem) turtle.rotateX(98);
        this.drawInternode();
        turtle.push();
        this.drawFlower(flowerIndexOffset + i);
        turtle.pop();
      }
      if (mainBranch) turtle.pop();
    }
    branchesDrawn = 0;
    if (mainBranch) {
      while (branchesDrawn < p.numBranches) {
        if (p.flowersSpiralOnStem) turtle.rotateX(98);
        this.drawInternode();
        this.drawAxillaryBud(p.numFlowersPerBranch, p.numFlowersOnMainBranch + branchesDrawn * p.numFlowersPerBranch);
        branchesDrawn++;
        if (!p.branchesAreAlternate && branchesDrawn < p.numBranches) {
          turtle.push();
          turtle.rotateX(128);
          this.drawAxillaryBud(p.numFlowersPerBranch, p.numFlowersOnMainBranch + branchesDrawn * p.numFlowersPerBranch);
          branchesDrawn++;
          turtle.pop();
        }
      }
    }
  }

  drawBracts() {
    const params = this.params.bractTdoParams;
    if (params.scaleAtFullSize <= 0) return;
    const turtle = this.plant.turtle;
    turtle.push();
    const scale = (params.scaleAtFullSize / 100) * this.propFullSize();
    turtle.rotateX(this.angleWithSway(params.xRotationBeforeDraw));
    turtle.rotateY(this.angleWithSway(params.yRotationBeforeDraw));
    turtle.rotateZ(this.angleWithSway(params.zRotationBeforeDraw));
    const drawBract = () => {
      turtle.push();
      turtle.rotateY(-64);
      turtle.rotateX(64);
      turtle.rotateX(params.pullBackAngle);
      this.draw3DObject(params.object3D, scale, params.faceColor, params.backfaceColor);
      turtle.pop();
    };
    if (params.radiallyArranged && params.repetitions > 0) {
      const turns = new TurnSharer(params.repetitions);
      for (let i = 0; i < params.repetitions; i++) {
        drawBract();
        turtle.rotateX(turns.next());
      }
    } else {
      drawBract();
    }
    turtle.pop();
  }

  drawPeduncle() {
    const p = this.params;
    const parent = this.phytomerAttachedTo;
    let zAngle = 0;
    if (parent) {
      if (parent.leftBranchPlantPart === this) {
        zAngle = p.peduncleAngleFromVegetativeStem;
      } else if (parent.rightBranchPlantPart === this) {
        zAngle = p.peduncleAngleFromVegetativeStem;
        this.plant.turtle.rotateX(128);
      } else if (this.isApical) {
        zAngle = p.apicalStalkAngleFromVegetativeStem;
      }
    }
    const prop = this.propFullSize();
    const length = this.lengthOrWidthAtAgeForFraction(this.isApical ? p.terminalStalkLength_mm : p.peduncleLength_mm, prop);
    const width = this.lengthOrWidthAtAgeForFraction(p.internodeWidth_mm, prop);
    this.drawStemSegment(length, width, zAngle, 0, p.stalkColor, DONT_TAPER, USE_POSE);
  }

  drawAxillaryBud(internodeCount, flowerIndexOffset) {
    if (this.allFlowersHaveBeenDrawn()) return;
    const turtle = this.plant.turtle;
    turtle.push();
    turtle.rotateZ(this.angleWithSway(this.params.branchAngle));
    this.drawApex(internodeCount, flowerIndexOffset, false);
    turtle.pop();
  }

  drawFlower(internodeCount) {
    if (this.allFlowersHaveBeenDrawn()) return;
    const p = this.params;
    const prop = this.propFullSize();
    const length = this.lengthOrWidthAtAgeForFraction(p.pedicelLength_mm, prop);
    const width = this.lengthOrWidthAtAgeForFraction(p.internodeWidth_mm, prop);
    const angle = this.angleWithSway(p.pedicelAngle);
    const flowerIndex = p.flowersDrawTopToBottom ? internodeCount : this.flowers.length - internodeCount + 1;
    this.drawStemSegment(length, width, angle, 0, p.pedicelColor, p.pedicelTaperIndex);
    this.flowers[flowerIndex - 1]?.draw();
  }

  drawHead() {
    const turtle = this.plant.turtle;
    turtle.rotateY(64);
    turtle.rotateZ(64);
    turtle.rotateY(32);
    if (!this.flowers.length) return;
    const turns = new TurnSharer(this.flowers.length);
    for (let i = this.flowers.length - 1; i >= 0; i--) {
      turtle.rotateZ(turns.next());
      turtle.push();
      this.drawFlower(i + 1);
      turtle.pop();
    }
  }

  drawInternode() {
    if (this.allFlowersHaveBeenDrawn()) return;
    const p = this.params;
    if (p.internodeLength_mm === 0) return;
    const prop = this.propFullSize();
    const length = this.lengthOrWidthAtAgeForFraction(p.internodeLength_mm, prop);
    const width = this.lengthOrWidthAtAgeForFraction(p.internodeWidth_mm, prop);
    const zAngle = this.angleWithSway(p.angleBetweenInternodes);
    const yAngle = this.angleWithSway(0);
    this.drawStemSegment(length, width, zAngle, yAngle, p.stalkColor, DONT_TAPER);
  }

  lengthOrWidthAtAgeForFraction(starting, fraction) {
    const days = this.params.daysToAllFlowersCreated;
    const ageBounded = Math.min(days, this.daysSinceStartedMakingFlowers);
    return days !== 0 ? safediv(starting * ageBounded, days, 0) * fraction : starting * ageBounded * fraction;
  }
}

// ---------------------------------------------------------------- flower and fruit

export class FlowerFruit extends Part {
  propFullSize = 0;
  stage = FLOWER_BUD;
  hasBeenDrawn = false;
  daysAccumulatingFruitBiomass = 0;
  daysOpen = 0;

  constructor(plant, gender) {
    super();
    this.initialize(plant);
    this.gender = gender;
  }

  get params() { return this.plant.pFlower[this.gender]; }

  getName() { return 'flower/fruit'; }

  nextDay() {
    if (this.hasFallenOff) return;
    super.nextDay();
    const p = this.params;
    const fruit = this.plant.pFruit;
    switch (this.stage) {
      case FLOWER_BUD:
        if ((this.liveBiomass >= p.minFractionOfOptimalBiomassToOpenFlower_frn * p.optimalBiomass_pctMPB || this.age > p.maxDaysToGrowIfOverMinFraction)
          && this.age > p.minDaysToOpenFlower) {
          this.stage = OPEN_FLOWER;
          this.daysOpen = 0;
        }
        break;
      case OPEN_FLOWER:
        this.daysOpen++;
        if (this.daysOpen > p.daysBeforeDrop) {
          this.hasFallenOff = true;
        } else if (this.gender !== MALE && this.age > p.minDaysBeforeSettingFruit) {
          const minDaysWithOptimalBiomass = this.age > p.minDaysToGrow && this.liveBiomass >= p.optimalBiomass_pctMPB;
          const maxDaysWithMinFraction = this.age > p.maxDaysToGrowIfOverMinFraction
            || this.liveBiomass >= p.minFractionOfOptimalBiomassToCreateFruit_frn * p.optimalBiomass_pctMPB;
          if (maxDaysWithMinFraction || minDaysWithOptimalBiomass) {
            this.stage = UNRIPE_FRUIT;
            this.daysAccumulatingFruitBiomass = 0;
            const anthesisLoss = this.liveBiomass * 0.5;
            this.liveBiomass -= anthesisLoss;
            this.deadBiomass += anthesisLoss;
            this.propFullSize = Math.min(1, safediv(this.totalBiomass(), fruit.optimalBiomass_pctMPB, 0));
          }
        }
        break;
      case UNRIPE_FRUIT:
        if (this.daysAccumulatingFruitBiomass >= fruit.daysToRipen) this.stage = RIPE_FRUIT;
        this.daysAccumulatingFruitBiomass++;
        break;
      case RIPE_FRUIT:
        this.daysAccumulatingFruitBiomass++;
        break;
    }
  }

  traverseActivity(mode, traverser) {
    if (!this.beginActivity(mode, traverser)) return;
    const p = this.params;
    const fruit = this.plant.pFruit;
    const isFlower = this.stage === FLOWER_BUD || this.stage === OPEN_FLOWER;
    switch (mode) {
      case Mode.NextDay:
        this.nextDay();
        break;
      case Mode.DemandReproductive:
        if (isFlower) {
          this.biomassDemand = linearGrowthResult(this.liveBiomass, p.optimalBiomass_pctMPB, p.minDaysToGrow);
          traverser.total += this.biomassDemand;
        } else if (this.daysAccumulatingFruitBiomass > fruit.maxDaysToGrow) {
          this.biomassDemand = 0;
        } else {
          const fractionOfMaxAge = safediv(this.daysAccumulatingFruitBiomass + 1, fruit.maxDaysToGrow, 0);
          const prop = Math.max(0, Math.min(1, scurve(fractionOfMaxAge, fruit.sCurveParams.c1, fruit.sCurveParams.c2)));
          this.biomassDemand = linearGrowthResult(this.liveBiomass, prop * fruit.optimalBiomass_pctMPB, 1);
          traverser.total += this.biomassDemand;
        }
        break;
      case Mode.GrowReproductive: {
        this.liveBiomass += this.biomassDemand * traverser.fractionOfPotentialBiomass;
        const optimal = isFlower ? p.optimalBiomass_pctMPB : fruit.optimalBiomass_pctMPB;
        this.propFullSize = Math.min(1, safediv(this.totalBiomass(), optimal, 0));
        break;
      }
      case Mode.ReproductiveBiomassThatCanBeRemoved:
        traverser.total += this.liveBiomass;
        break;
      case Mode.RemoveReproductiveBiomass:
        if (this.liveBiomass <= 0) return;
        this.removeBiomass(traverser);
        if (this.liveBiomass <= 0 && !isFlower) this.hasFallenOff = true;
        break;
    }
  }

  // The early return for "no bud" skips the pop, as it does in ufruit.pas, which
  // leaves the turtle one level deeper for the rest of the branch.
  draw() {
    if (this.hasFallenOff) return;
    const turtle = this.plant.turtle;
    turtle.push();
    this.determineAmendment();
    if (this.hiddenByAmendment()) {
      turtle.pop();
      return;
    }
    this.applyAmendmentRotations();
    const p = this.params;
    if (this.stage === FLOWER_BUD) {
      if (p.budDrawingOption === DRAW_NO_BUD) return;
      if (p.budDrawingOption === DRAW_SINGLE_TDO_BUD) this.drawSingle(p.tdoParams[BUD], p.tdoParams[BUD].faceColor, p.tdoParams[BUD].backfaceColor);
      else if (p.budDrawingOption === DRAW_OPENING_FLOWER) this.drawFlower(true);
    } else if (this.stage === OPEN_FLOWER) {
      this.drawFlower(false);
    } else {
      const params = this.plant.pFruit.tdoParams;
      if (this.stage === UNRIPE_FRUIT) this.drawSingle(params, params.alternateFaceColor, params.alternateBackfaceColor);
      else this.drawSingle(params, params.faceColor, params.backfaceColor);
    }
    this.hasBeenDrawn = true;
    turtle.pop();
  }

  drawSingle(params, faceColor, backfaceColor) {
    const turtle = this.plant.turtle;
    const scale = (params.scaleAtFullSize / 100) * this.propFullSize;
    turtle.rotateX(this.angleWithSway(params.xRotationBeforeDraw));
    turtle.rotateY(this.angleWithSway(params.yRotationBeforeDraw));
    turtle.rotateZ(this.angleWithSway(params.zRotationBeforeDraw));
    this.drawCircleOfTdos(params.object3D, faceColor, backfaceColor, params.pullBackAngle, scale, params.repetitions, params.radiallyArranged, false);
  }

  drawFlower(asOpening) {
    const turtle = this.plant.turtle;
    this.drawPistilsAndStamens(asOpening);
    for (let layer = FIRST_PETALS; layer <= SEPALS; layer++) {
      const params = this.params.tdoParams[layer];
      turtle.push();
      const scale = (params.scaleAtFullSize / 100) * this.propFullSize;
      let angle = this.angleWithSway(params.pullBackAngle);
      if (asOpening) {
        angle *= this.propFullSize * 2;
        if (angle > params.pullBackAngle) angle = params.pullBackAngle;
      }
      turtle.rotateX(this.angleWithSway(params.xRotationBeforeDraw));
      turtle.rotateY(this.angleWithSway(params.yRotationBeforeDraw));
      turtle.rotateZ(this.angleWithSway(params.zRotationBeforeDraw));
      this.drawCircleOfTdos(params.object3D, params.faceColor, params.backfaceColor, angle, scale, params.repetitions, params.radiallyArranged, true);
      turtle.pop();
    }
  }

  drawPistilsAndStamens(asOpening) {
    const p = this.params;
    this.drawWhorl(asOpening, p.numPistils, p.styleLength_mm, p.styleWidth_mm, p.styleColor, p.styleTaperIndex, p.tdoParams[PISTILS]);
    this.drawWhorl(asOpening, p.numStamens, p.filamentLength_mm, p.filamentWidth_mm, p.filamentColor, p.filamentTaperIndex, p.tdoParams[STAMENS]);
  }

  drawWhorl(asOpening, count, stalkLength, stalkWidth, stalkColor, taperIndex, params) {
    const turtle = this.plant.turtle;
    turtle.push();
    if (count > 0) {
      const turns = new TurnSharer(count);
      for (let i = 0; i < count; i++) {
        turtle.push();
        if (stalkLength > 0 && stalkWidth > 0) {
          const length = Math.max(0, this.propFullSize * stalkLength);
          const width = Math.max(0, this.propFullSize * stalkWidth);
          let angle = this.angleWithSway(params.pullBackAngle);
          if (asOpening) angle *= this.propFullSize;
          this.drawStemSegment(length, width, angle, 0, stalkColor, taperIndex);
        }
        const scale = (params.scaleAtFullSize / 100) * this.propFullSize;
        turtle.rotateX(this.angleWithSway(params.xRotationBeforeDraw));
        turtle.rotateY(this.angleWithSway(params.yRotationBeforeDraw));
        turtle.rotateZ(this.angleWithSway(params.zRotationBeforeDraw));
        this.drawCircleOfTdos(params.object3D, params.faceColor, params.backfaceColor, 0, scale, params.repetitions, params.radiallyArranged, true);
        turtle.pop();
        turtle.rotateX(turns.next());
      }
    }
    turtle.pop();
  }

  drawCircleOfTdos(tdo, faceColor, backfaceColor, pullBackAngle, scale, numParts, partsArranged, open) {
    if (scale <= 0) return;
    const turtle = this.plant.turtle;
    turtle.push();
    if (partsArranged && numParts > 0) {
      const turns = new TurnSharer(numParts);
      let minZ = 0;
      for (let i = 1; i <= numParts; i++) {
        turtle.rotateX(turns.next());
        turtle.push();
        turtle.rotateZ(-64);
        if (open) turtle.rotateY(32);
        turtle.rotateX(pullBackAngle);
        if (tdo) {
          this.draw3DObject(tdo, scale, faceColor, backfaceColor);
          minZ = i === 1 ? tdo.zForSorting : Math.min(minZ, tdo.zForSorting);
        }
        turtle.pop();
      }
      if (tdo) tdo.zForSorting = minZ;
    } else {
      turtle.push();
      turtle.rotateZ(this.stage === UNRIPE_FRUIT || this.stage === RIPE_FRUIT ? -64 : -pullBackAngle);
      if (tdo) this.draw3DObject(tdo, scale, faceColor, backfaceColor);
      turtle.pop();
    }
    turtle.pop();
  }
}

// ---------------------------------------------------------------- traversal

const TRAVERSE_NONE = 0, TRAVERSE_LEFT = 1, TRAVERSE_RIGHT = 2, TRAVERSE_NEXT = 3, TRAVERSE_DONE = 4;

// Walks the plant without recursion so long stems can't overflow the stack.
// Drawing keeps the turtle in step with a push per branch.
export class Traverser {
  total = 0;
  fractionOfPotentialBiomass = 0;
  totalPlantParts = 0;

  constructor(plant) {
    this.plant = plant;
  }

  traverseWholePlant(mode) {
    this.total = 0;
    this.totalPlantParts = 0;
    let phytomer = this.plant.firstPhytomer;
    if (!phytomer) return;
    phytomer.traversingDirection = TRAVERSE_LEFT;
    phytomer.traverseActivity(mode, this);
    phytomer.traversingDirection = TRAVERSE_LEFT;

    const drawing = mode === Mode.Draw;
    const turtle = this.plant.turtle;
    // The slot is read again after the activity: a meristem can replace itself there
    // with a new phytomer, which then gets walked the same day.
    const enter = (slot, rotate) => {
      if (drawing) {
        turtle.push();
        if (rotate) turtle.rotateX((this.plant.pGeneral.phyllotacticRotationAngle * 256) / 360);
      }
      const parent = phytomer;
      parent[slot].traverseActivity(mode, this);
      if (parent[slot].isPhytomer()) {
        phytomer = parent[slot];
        phytomer.traversingDirection = TRAVERSE_LEFT;
      } else if (drawing) {
        turtle.pop();
      }
    };
    for (;;) {
      switch (phytomer.traversingDirection) {
        case TRAVERSE_LEFT:
          phytomer.traversingDirection++;
          if (phytomer.leftBranchPlantPart) enter('leftBranchPlantPart', false);
          break;
        case TRAVERSE_RIGHT:
          phytomer.traversingDirection++;
          if (phytomer.rightBranchPlantPart) enter('rightBranchPlantPart', false);
          break;
        case TRAVERSE_NEXT:
          phytomer.traversingDirection++;
          if (phytomer.nextPlantPart) enter('nextPlantPart', true);
          break;
        case TRAVERSE_DONE:
          phytomer.traversingDirection = TRAVERSE_NONE;
          phytomer = phytomer.phytomerAttachedTo;
          if (!phytomer) return;
          if (drawing) turtle.pop();
          break;
        default:
          throw new Error('Plant traversal reached a part with no direction');
      }
    }
  }
}
