// The Plant Wizard, from uwizard.pas: a few plain questions set many parameters.
// A question that's switched off keeps its default parameters, as in the original.

import { newDefaultPlant } from '../model/plant.js';
import { Random, colorToHex, darkerColor, hexToColor, rgb } from '../model/support.js';
import { el, openDialog } from './dom.js';
import { fitPlant, paintPlant, paintTdo } from './thumbnail.js';

const PREVIEW = 240, TDO_THUMB = 48;
const FEMALE = 1;
const FIRST_PETALS = 3, BUD = 0;
const ALTERNATE = 0, OPPOSITE = 1;
const PINNATE = 0, PALMATE = 1;
const NO_FRUIT_DAYS = 200, FRUIT_DAYS = 3;
const TURN_DEGREES = 10;
const DEFAULT_PETAL_COLOR = rgb(255, 0, 255), DEFAULT_FRUIT_COLOR = rgb(255, 0, 0);

const SIZES = ['tiny', 'small', 'medium', 'large', 'huge'];
const LENGTHS = ['very short', 'short', 'medium', 'long', 'very long'];
const WIDTHS = ['very thin', 'thin', 'medium', 'thick', 'very thick'];
const THICKNESS_MM = [0.5, 1, 2, 3, 10];
const zip = (labels, values) => labels.map((label, i) => [label, values[i]]);
const COUNTS = zip(['one', 'three', 'four', 'five', 'ten'], [1, 3, 4, 5, 10]);

const hasInflorescences = (a) => a.apical !== 0 || a.axillary !== 0;
const showsFruit = (a) => a.showFruit;

const PAGES = [
  {
    title: 'Start',
    text: [
      'Welcome to the Plant Wizard!',
      'This wizard will help you create a new plant by asking you some simple questions.',
      'Click Next to start, or Cancel to stop.',
    ],
    questions: [],
  },
  {
    title: 'Meristems',
    text: ['Meristems are buds from which leaves and branches grow. Where they are placed and whether they develop determines how the plant branches.'],
    questions: [
      { key: 'branching', label: 'How much should the plant branch?', default: 0, choices: zip(['none', 'a little', 'medium', 'a lot'], [0, 10, 30, 80]) },
      { key: 'arrangement', label: 'How should leaves and branches be arranged?', default: ALTERNATE, choices: [['alternate', ALTERNATE], ['opposite', OPPOSITE]] },
      { key: 'branchAngle', label: 'What angle should branches make with the stem?', default: 20, when: (a) => a.branching !== 0, choices: zip(['small', 'medium', 'large'], [20, 40, 60]) },
      { key: 'secondary', label: 'Should secondary branching (off branches) occur?', default: false, when: (a) => a.branching !== 0, choices: [['yes', true], ['no', false]] },
    ],
  },
  {
    title: 'Internodes',
    text: ['Internodes are portions of plant stem between leaves. They determine how tall and leggy the plant is.'],
    questions: [
      { key: 'curviness', label: 'How curvy should the plant stem be?', default: 1, choices: zip(['none', 'a little', 'some', 'a lot'], [0, 1, 2, 3]) },
      { key: 'internodeLength', label: 'How long should internodes be?', default: 15, choices: zip(LENGTHS, [1, 10, 15, 25, 50]) },
      { key: 'internodeWidth', label: 'How thick should internodes be?', default: 1, choices: zip(WIDTHS, THICKNESS_MM) },
    ],
  },
  {
    title: 'Leaves',
    text: ['PlantStudio draws leaves using a "3D object" that represents a 3D shape.'],
    questions: [
      { key: 'leafTdo', label: 'What 3D object should be used to draw leaves?', tdo: 'leaf' },
      { key: 'leafScale', label: 'How big should a full-sized leaf be drawn?', default: 40, choices: zip(SIZES, [5, 20, 40, 60, 100]) },
      { key: 'leafAngle', label: 'What angle should each leaf make with the stem?', default: 40, choices: zip(['small', 'medium', 'large'], [20, 40, 60]) },
      { key: 'petiole', label: 'How long should the petiole (leaf stalk) be?', default: 20, choices: zip(LENGTHS, [1, 10, 20, 30, 60]) },
    ],
  },
  {
    title: 'Compound leaves',
    text: ['A compound leaf is a leaf made up of two or more small parts called leaflets.'],
    questions: [
      { key: 'leaflets', label: 'How many leaflets should make up each leaf?', default: 1, choices: zip(['one (simple)', 'three', 'four', 'five', 'seven'], [1, 3, 4, 5, 7]) },
      { key: 'leafletShape', label: 'What shape should the compound leaves take?', default: PINNATE, when: (a) => a.leaflets !== 1, choices: [['pinnate', PINNATE], ['palmate', PALMATE]] },
      { key: 'leafletSpread', label: 'How spread out should the leaflets be?', default: 30, when: (a) => a.leaflets !== 1, choices: zip(['close', 'medium', 'far'], [10, 30, 50]) },
    ],
  },
  {
    title: 'Inflorescence placement',
    text: ['An inflorescence is a structure that holds the flowers. Apical ones grow at the tips of branches, and axillary ones between leaf and stem.'],
    questions: [
      { key: 'apical', label: 'How many apical inflorescences should there be?', default: 0, choices: zip(['none', 'one', 'two', 'three', 'five'], [0, 1, 2, 3, 5]) },
      { key: 'apicalStalk', label: 'How long should their primary stems be?', default: 30, when: (a) => a.apical !== 0, choices: zip(LENGTHS, [1, 10, 30, 50, 100]) },
      { key: 'axillary', label: 'How many axillary inflorescences should there be?', default: 0, choices: zip(['none', 'three', 'five', 'ten', 'twenty'], [0, 3, 5, 10, 20]) },
      { key: 'axillaryStalk', label: 'How long should their primary stems be?', default: 10, when: (a) => a.axillary !== 0, choices: zip(LENGTHS, [1, 5, 10, 15, 40]) },
    ],
  },
  {
    title: 'Inflorescences',
    text: ['These choices set how each inflorescence holds its flowers.'],
    when: hasInflorescences,
    questions: [
      { key: 'flowers', label: 'How many flowers should each inflorescence have?', default: 3, choices: zip(['one', 'two', 'three', 'five', 'ten', 'twenty'], [1, 2, 3, 5, 10, 20]) },
      { key: 'inflorShape', label: 'What shape should each inflorescence have?', default: 'raceme', when: (a) => a.flowers !== 1, choices: ['spike', 'raceme', 'panicle', 'umbel', 'cluster', 'head'].map((shape) => [shape, shape]) },
      { key: 'inflorWidth', label: 'How thick should each inflorescence stem be?', default: 1, choices: zip(WIDTHS, THICKNESS_MM) },
    ],
  },
  {
    title: 'Flowers',
    text: ['Flowers are drawn with a 3D object for each petal.'],
    when: hasInflorescences,
    questions: [
      { key: 'petalTdo', label: 'What 3D object should be used for a flower petal?', tdo: 'petal' },
      { key: 'petals', label: 'How many flower petals should a flower have?', default: 5, choices: COUNTS },
      { key: 'petalScale', label: 'How big should a flower petal be drawn?', default: 10, choices: zip(SIZES, [4, 10, 20, 30, 60]) },
      { key: 'petalColor', label: 'What color should flowers be drawn?', color: DEFAULT_PETAL_COLOR },
    ],
  },
  {
    title: 'Fruit',
    text: ['Fruits are drawn with a 3D object, usually rotated around in sections to form a solid-looking shape.'],
    when: hasInflorescences,
    questions: [
      { key: 'showFruit', label: 'Do you want to see fruits on your plant?', default: true, choices: [['yes', true], ['no', false]] },
      { key: 'fruitTdo', label: 'What 3D object should be used to draw each fruit section?', tdo: 'section', when: showsFruit },
      { key: 'fruitSections', label: 'How many fruit sections should be used to draw the fruit?', default: 5, when: showsFruit, choices: COUNTS },
      { key: 'fruitScale', label: 'How big should fruit sections be drawn?', default: 10, when: showsFruit, choices: zip(SIZES, [4, 10, 20, 30, 60]) },
      { key: 'fruitColor', label: 'What color should fruits be drawn?', color: DEFAULT_FRUIT_COLOR, when: showsFruit },
    ],
  },
  { title: 'Finish', text: ['Congratulations! You have made a new plant. Name it, and turn it or randomize it until you like it.'], questions: [] },
];

const CURVING = [[0, 0], [10, 5], [30, 10], [50, 20]];
// main branch flowers, flowers per branch, branches
const PANICLE_LAYOUTS = { 1: [1, 0, 0], 2: [0, 1, 2], 3: [1, 1, 2], 5: [1, 2, 2], 10: [1, 3, 3], 20: [4, 4, 4] };

function setInflorescenceShape(p, a) {
  const flowers = a.flowers;
  const flowersOnBranches = () => Object.assign(p, { numFlowersOnMainBranch: 0, numFlowersPerBranch: 1, numBranches: flowers });
  switch (a.inflorShape) {
    case 'spike':
      Object.assign(p, { pedicelLength_mm: 1, pedicelAngle: 30, internodeLength_mm: 10, flowersSpiralOnStem: true });
      break;
    case 'raceme':
      Object.assign(p, { pedicelLength_mm: 20, pedicelAngle: 45, internodeLength_mm: 10, flowersSpiralOnStem: true });
      break;
    case 'panicle': {
      const [main, perBranch, branches] = PANICLE_LAYOUTS[flowers];
      Object.assign(p, {
        numFlowersOnMainBranch: main, numFlowersPerBranch: perBranch, numBranches: branches,
        pedicelLength_mm: 15, pedicelAngle: 30, branchAngle: 35, branchesAreAlternate: true,
        internodeLength_mm: 7, flowersSpiralOnStem: true,
      });
      break;
    }
    case 'umbel':
      flowersOnBranches();
      Object.assign(p, { pedicelLength_mm: 20, pedicelAngle: 20, internodeLength_mm: 0, flowersSpiralOnStem: true });
      break;
    case 'cluster':
      flowersOnBranches();
      Object.assign(p, { flowersSpiralOnStem: true, internodeLength_mm: 3, pedicelLength_mm: 1, pedicelAngle: 25 });
      break;
    case 'head':
      Object.assign(p, { pedicelLength_mm: 10, pedicelAngle: 0, internodeLength_mm: 10, isHead: true, flowersSpiralOnStem: false });
      break;
  }
}

// The finishFor... methods of uwizard.pas, in the same order.
export function applyAnswers(plant, a) {
  const { pMeristem, pInternode, pLeaf, pGeneral } = plant;
  pMeristem.branchingAndLeafArrangement = a.arrangement;
  pMeristem.branchingIndex = a.branching;
  if (a.branching !== 0) {
    pMeristem.secondaryBranchingIsAllowed = a.secondary;
    pMeristem.branchingAngle = a.branchAngle;
  }

  [pInternode.curvingIndex, pInternode.firstInternodeCurvingIndex] = CURVING[a.curviness];
  pInternode.lengthAtOptimalFinalBiomassAndExpansion_mm = a.internodeLength;
  pInternode.widthAtOptimalFinalBiomassAndExpansion_mm = a.internodeWidth;

  pLeaf.leafTdoParams.scaleAtFullSize = a.leafScale;
  pLeaf.petioleLengthAtOptimalBiomass_mm = a.petiole;
  pLeaf.petioleAngle = a.leafAngle;
  if (a.leafTdo) pLeaf.leafTdoParams.object3D = a.leafTdo.copy();

  pLeaf.compoundNumLeaflets = a.leaflets;
  if (a.leaflets !== 1) {
    pLeaf.compoundPinnateOrPalmate = a.leafletShape;
    pLeaf.compoundRachisToPetioleRatio = a.leafletSpread;
  }

  pGeneral.numApicalInflors = a.apical;
  pGeneral.numAxillaryInflors = a.axillary;
  pGeneral.ageAtWhichFloweringStarts = hasInflorescences(a) ? Math.round(pGeneral.ageAtMaturity * 0.6) : pGeneral.ageAtMaturity + 1;
  const inflorescence = plant.pInflor[FEMALE];
  if (a.apical !== 0) inflorescence.terminalStalkLength_mm = a.apicalStalk;
  if (a.axillary !== 0) inflorescence.peduncleLength_mm = a.axillaryStalk;

  if (hasInflorescences(a)) {
    Object.assign(inflorescence, { numFlowersOnMainBranch: a.flowers, numFlowersPerBranch: 0, numBranches: 0 });
    if (a.flowers !== 1) setInflorescenceShape(inflorescence, a);
    inflorescence.internodeWidth_mm = a.inflorWidth;

    const flower = plant.pFlower[FEMALE];
    const petals = flower.tdoParams[FIRST_PETALS];
    petals.repetitions = a.petals;
    petals.scaleAtFullSize = a.petalScale;
    petals.faceColor = a.petalColor;
    petals.backfaceColor = darkerColor(a.petalColor);
    flower.tdoParams[BUD].faceColor = petals.faceColor;
    flower.tdoParams[BUD].backfaceColor = petals.backfaceColor;
    if (a.petalTdo) petals.object3D = a.petalTdo.copy();

    flower.minDaysBeforeSettingFruit = a.showFruit ? FRUIT_DAYS : NO_FRUIT_DAYS;
    if (a.showFruit) {
      const fruit = plant.pFruit.tdoParams;
      fruit.repetitions = a.fruitSections;
      fruit.scaleAtFullSize = a.fruitScale;
      fruit.faceColor = a.fruitColor;
      fruit.backfaceColor = darkerColor(a.fruitColor);
      fruit.alternateFaceColor = fruit.faceColor;
      fruit.alternateBackfaceColor = fruit.backfaceColor;
      if (a.fruitTdo) fruit.object3D = a.fruitTdo.copy();
    }
  }
}

export function defaultAnswers(library) {
  const answers = {};
  for (const question of PAGES.flatMap((page) => page.questions)) {
    if (question.tdo) answers[question.key] = library.find((tdo) => tdo.name.toLowerCase().includes(question.tdo)) ?? null;
    else answers[question.key] = question.color ?? question.default;
  }
  return answers;
}

export function buildPlant(answers, name) {
  const plant = newDefaultPlant(name);
  applyAnswers(plant, answers);
  plant.setAge(plant.pGeneral.ageAtMaturity);
  return plant;
}

let lastAnswers = null;

export const haveLastWizardAnswers = () => lastAnswers !== null;
export const buildPlantFromLastAnswers = (name) => buildPlant(lastAnswers, name);

export function openWizard(app) {
  const answers = lastAnswers ? { ...lastAnswers } : defaultAnswers(app.tdoLibrary);
  const pagesInUse = () => PAGES.filter((page) => !page.when || page.when(answers));
  let pageIndex = 0;
  let seed = 0;
  let xRotation = 0;
  const content = el('div', { class: 'wizard-page' });
  const backButton = el('button', { onclick: () => go(-1) }, '< Back');
  const nextButton = el('button', { onclick: () => advance() }, 'Next >');
  const nameInput = el('input', { type: 'text', 'aria-label': 'Plant name', value: `new plant ${app.plants.length + 1}` });
  nameInput.addEventListener('keydown', (event) => event.stopPropagation());

  const makePlant = () => {
    const plant = buildPlant(answers, nameInput.value || 'new plant');
    plant.pGeneral.startingSeedForRandomNumberGenerator = seed;
    plant.xRotation = xRotation;
    plant.regrow();
    return plant;
  };

  const go = (change) => {
    pageIndex = Math.max(0, Math.min(pagesInUse().length - 1, pageIndex + change));
    render();
  };

  const advance = () => {
    if (pagesInUse()[pageIndex].title === 'Finish') finish();
    else go(1);
  };

  const finish = () => {
    lastAnswers = { ...answers };
    const plant = makePlant();
    close();
    app.addPlant(plant);
  };

  const choiceRow = (question, enabled) => el('div', { class: 'choices' }, ...question.choices.map(([label, value]) => el('button', {
    class: `tool wide${answers[question.key] === value ? ' pressed' : ''}`, disabled: !enabled,
    onclick: () => {
      answers[question.key] = value;
      render();
    },
  }, label)));

  const tdoRow = (question, enabled) => {
    const strip = el('div', { class: 'tdo-strip' });
    const label = el('span', {}, answers[question.key]?.name ?? '');
    for (const tdo of app.tdoLibrary) {
      const canvas = el('canvas', { width: TDO_THUMB, height: TDO_THUMB });
      const button = el('button', {
        class: `thumb small${answers[question.key] === tdo ? ' chosen' : ''}`, title: tdo.name, disabled: !enabled,
        onclick: () => {
          answers[question.key] = tdo;
          strip.querySelector('.chosen')?.classList.remove('chosen');
          button.classList.add('chosen');
          label.textContent = tdo.name;
        },
      }, canvas);
      paintTdo(canvas, tdo);
      strip.append(button);
    }
    return [strip, label];
  };

  const colorRow = (question, enabled) => el('input', {
    type: 'color', 'aria-label': question.label, disabled: !enabled, value: colorToHex(answers[question.key]),
    onchange: (event) => { answers[question.key] = hexToColor(event.target.value); },
  });

  const renderQuestion = (question) => {
    const enabled = !question.when || question.when(answers);
    const control = question.tdo ? tdoRow(question, enabled) : question.choices ? [choiceRow(question, enabled)] : [colorRow(question, enabled)];
    return el('div', { class: `question${enabled ? '' : ' disabled'}` }, el('p', {}, question.label), ...control);
  };

  const renderFinish = () => {
    const canvas = el('canvas', { class: 'preview', width: PREVIEW, height: PREVIEW });
    const preview = () => {
      const plant = makePlant();
      paintPlant(canvas, plant, fitPlant(plant, PREVIEW, PREVIEW));
    };
    const turn = (degrees) => () => {
      xRotation = (xRotation + degrees + 360) % 360;
      preview();
    };
    const randomize = () => {
      seed = Math.floor(new Random(Date.now() % 2147483647).zeroToOne() * 32767);
      preview();
    };
    preview();
    return [
      el('div', { class: 'row' }, 'Name', nameInput),
      canvas,
      el('div', { class: 'row spacer-top' },
        el('button', { onclick: turn(-TURN_DEGREES) }, 'Turn Left'),
        el('button', { onclick: turn(TURN_DEGREES) }, 'Turn Right'),
        el('button', { onclick: randomize }, 'Randomize')),
    ];
  };

  const render = () => {
    const pages = pagesInUse();
    pageIndex = Math.min(pageIndex, pages.length - 1);
    const page = pages[pageIndex];
    const isLast = page.title === 'Finish';
    content.replaceChildren(
      el('h4', {}, `${page.title} (${pageIndex + 1} of ${pages.length})`),
      ...page.text.map((text) => el('p', {}, text)),
      ...page.questions.map(renderQuestion),
      ...(isLast ? renderFinish() : []));
    backButton.disabled = pageIndex === 0;
    nextButton.textContent = isLast ? 'Finish' : 'Next >';
  };

  const { body, close } = openDialog('Plant Wizard');
  body.append(content, el('div', { class: 'dialog-buttons' },
    backButton, nextButton, el('button', { onclick: () => close() }, 'Cancel')));
  render();
}
