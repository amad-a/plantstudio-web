// The live examples on how-plants-grow.html. Every picture and number comes from the
// engine in src/model, run on the bundled plant libraries; nothing here re-implements
// growth or drawing. Code excerpts are read from the source files when the page loads.

import { parsePlantFile, breed, Plant } from './src/model/plant.js';
import { Random, calcSCurveCoeffs, scurve, safediv } from './src/model/support.js';
import { Internode, Leaf, Meristem, Inflorescence, FlowerFruit, Mode, POSING, FEMALE } from './src/model/parts.js';
import { Turtle, DRAW_MODES } from './src/model/turtle.js';
import { Raster, RasterSurface, quicksort } from './src/model/surface.js';
import { fitPlant, paintPlant, paintTdo } from './src/ui/thumbnail.js';

const LIBRARIES = ['Garden flowers', 'Wildflowers', 'Garden plants', 'Bushes and shrubs', 'Grassy plants', 'New version 2 plants', 'Strange breeder plants'];
const decoder = new TextDecoder('windows-1252');
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ plants

const plants = []; // { key, name, library, plant } with each plant grown to maturity

async function loadPlants() {
  const files = await Promise.all(LIBRARIES.map(async (library) => {
    const response = await fetch(`data/${encodeURIComponent(library)}.pla`);
    return { library, file: parsePlantFile(decoder.decode(await response.arrayBuffer())) };
  }));
  for (const { library, file } of files) {
    for (const plant of file.plants) {
      plant.setAge(plant.pGeneral.ageAtMaturity);
      plants.push({ key: `${library}/${plant.name}`, name: plant.name, library, plant });
    }
  }
}

const plantByKey = (key) => plants.find((entry) => entry.key === key)?.plant;

function fillPlantSelect(select, defaultName) {
  for (const library of LIBRARIES) {
    const group = document.createElement('optgroup');
    group.label = library;
    for (const entry of plants.filter((e) => e.library === library)) group.append(new Option(entry.name, entry.key));
    select.append(group);
  }
  select.value = plants.find((entry) => entry.name === defaultName)?.key ?? plants[0].key;
}

// A copy of a plant with some of its numbers changed, regrown to the same age.
function variant(base, change) {
  const plant = base.copy();
  change(plant);
  plant.finishLoading();
  return plant;
}

const grownTo = (base, day) => {
  const plant = base.copy();
  plant.setAge(day);
  return plant;
};

// Every part of the plant, reached the way the traverser reaches them.
function partsOf(plant) {
  const out = [];
  const stack = [plant.firstPhytomer];
  while (stack.length) {
    const part = stack.pop();
    if (!part) continue;
    out.push(part);
    if (part instanceof Internode) stack.push(part.nextPlantPart, part.rightBranchPlantPart, part.leftBranchPlantPart, part.rightLeaf, part.leftLeaf);
    else if (part instanceof Inflorescence) stack.push(...part.flowers);
  }
  return out;
}

const STAGE_NAMES = ['', 'buds', 'open', 'unripe', 'ripe'];

function tally(plant) {
  const t = { internodes: 0, leaves: 0, meristems: 0, growingBuds: 0, inflorescences: 0, buds: 0, open: 0, unripe: 0, ripe: 0, dropped: 0, branches: 0 };
  for (const part of partsOf(plant)) {
    if (part instanceof Internode) {
      t.internodes++;
      const parent = part.phytomerAttachedTo;
      if (parent && (parent.leftBranchPlantPart === part || parent.rightBranchPlantPart === part)) t.branches++;
    } else if (part instanceof Leaf) {
      if (!part.hasFallenOff) t.leaves++;
    } else if (part instanceof Meristem) {
      t.meristems++;
      if (part.isActive && !part.isApical) t.growingBuds++;
    } else if (part instanceof Inflorescence) {
      t.inflorescences++;
    } else if (part instanceof FlowerFruit) {
      if (part.hasFallenOff) t.dropped++;
      else t[STAGE_NAMES[part.stage]]++;
    }
  }
  return t;
}

// The frame a plant is drawn in: its mature size fitted to the canvas, so it grows
// within a fixed picture instead of being rescaled every day.
const frameFor = (plant, canvas) => fitPlant(plant, canvas.width, canvas.height);

// ------------------------------------------------------------------ small helpers

function bindRange(input, format = (v) => v) {
  const output = input.parentElement.querySelector('output');
  const show = () => { if (output) output.textContent = format(Number(input.value)); };
  input.addEventListener('input', show);
  show();
  return show;
}

const fmt = (n, digits = 1) => Number(n).toFixed(digits);
const turnDegrees = (steps) => `${steps} (${Math.round((steps * 360) / 256)}°)`;
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

// Plays a plant from day 0 to maturity, a day per tick, growing one copy forward
// rather than regrowing from zero each frame.
function player(button, slider, getBase, render) {
  let timer = null;
  const stop = () => {
    clearInterval(timer);
    timer = null;
    button.textContent = 'Play';
  };
  button.addEventListener('click', () => {
    if (timer) return stop();
    const base = getBase();
    const plant = base.copy();
    plant.reset();
    button.textContent = 'Stop';
    timer = setInterval(() => {
      if (plant.age >= plant.pGeneral.ageAtMaturity) return stop();
      plant.nextDay();
      slider.value = plant.age;
      render(plant);
    }, 70);
  });
  slider.addEventListener('pointerdown', stop);
  return stop;
}

// ------------------------------------------------------------------ code excerpts

const sources = new Map();

async function fillExcerpts() {
  for (const pre of document.querySelectorAll('pre.code')) {
    const file = pre.dataset.file;
    if (!sources.has(file)) sources.set(file, fetch(file).then((r) => r.text()));
    const lines = (await sources.get(file)).split('\n');
    const from = pre.dataset.from;
    const to = pre.dataset.to;
    const start = lines.findIndex((line) => line === from);
    if (start < 0) {
      pre.textContent = `(couldn't find "${from.trim()}" in ${file})`;
      continue;
    }
    const indentOf = (line) => line.match(/^\s*/)[0].length;
    let end;
    if (to) {
      end = lines.findIndex((line, i) => i > start && line.startsWith(to));
    } else {
      const indent = indentOf(from);
      end = lines.findIndex((line, i) => i > start && line.trim().startsWith('}') && indentOf(line) === indent) + 1;
    }
    let body = lines.slice(start, end);
    while (body.length && (!body.at(-1).trim() || (to && indentOf(body.at(-1)) < indentOf(from)))) body.pop();
    const cut = to && indentOf(lines[end]) > indentOf(from);
    const common = Math.min(...body.filter((line) => line.trim()).map(indentOf));
    body = body.map((line) => line.slice(common));

    pre.textContent = '';
    const label = document.createElement('a');
    label.className = 'file';
    label.href = file;
    label.textContent = `${file}, line ${start + 1}`;
    pre.append(label);
    for (const line of body) {
      const comment = line.indexOf('//');
      if (comment >= 0 && !line.slice(0, comment).includes("'")) {
        pre.append(line.slice(0, comment));
        const span = document.createElement('span');
        span.className = 'comment';
        span.textContent = line.slice(comment);
        pre.append(span);
      } else {
        pre.append(line);
      }
      pre.append('\n');
    }
    if (cut) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = '  …';
      pre.append(more);
    }
  }
}

// ------------------------------------------------------------------ 1. days

function setupDays() {
  const select = $('daysPlant'), canvas = $('daysCanvas'), slider = $('daysAge'), out = $('daysAgeOut');
  let base, frame;
  const render = (plant) => {
    paintPlant(canvas, plant, frame);
    out.textContent = `${plant.age} / ${plant.pGeneral.ageAtMaturity}`;
    const t = tally(plant);
    $('daysStats').innerHTML = `
      <li>Weighs <b>${fmt(plant.totalBiomass_pctMPB)}%</b> of its mature biomass</li>
      <li>${plant.partsCreated} parts made so far</li>
      <li>${t.internodes} internodes, ${t.leaves} leaves</li>
      <li>${t.buds + t.open} flowers, ${t.unripe + t.ripe} fruit</li>`;
  };
  const choose = () => {
    base = plantByKey(select.value);
    frame = frameFor(base, canvas);
    slider.max = base.pGeneral.ageAtMaturity;
    slider.value = slider.max;
    render(base);
  };
  const stop = player($('daysPlay'), slider, () => base, render);
  slider.addEventListener('input', () => render(grownTo(base, Number(slider.value))));
  select.addEventListener('change', () => { stop(); choose(); });
  choose();
}

// ------------------------------------------------------------------ 2. seed

function setupSeed() {
  const select = $('seedPlant');
  let seed = 7;
  const draw = () => {
    const base = plantByKey(select.value);
    const own = base.pGeneral.startingSeedForRandomNumberGenerator;
    const frame = frameFor(base, $('seedA'));
    paintPlant($('seedA'), base, frame);
    $('seedACap').textContent = `Its own seed, ${own}`;
    const other = variant(base, (p) => { p.pGeneral.startingSeedForRandomNumberGenerator = seed; });
    paintPlant($('seedB'), other, frameFor(other, $('seedB')));
    $('seedBCap').textContent = `Seed ${seed}`;
    const random = new Random(seed);
    $('seedNumbers').textContent = Array.from({ length: 6 }, () => random.zeroToOne().toFixed(4)).join(', ') + ', …';
  };
  $('seedNew').addEventListener('click', () => {
    seed = 1 + Math.floor(Math.random() * 32000);
    draw();
  });
  select.addEventListener('change', draw);
  draw();
}

// ------------------------------------------------------------------ 3. growth curve

function setupCurve() {
  const select = $('curvePlant'), canvas = $('curveCanvas'), chart = $('curveChart'), age = $('curveAge');
  const inputs = { x1: $('curveX1'), y1: $('curveY1'), x2: $('curveX2'), y2: $('curveY2') };
  const shows = Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, bindRange(input, (v) => fmt(v, 2))]));
  let base, frame;

  const W = 360, H = 240, L = 40, R = 14, T = 14, B = 34;
  const sx = (x) => L + x * (W - L - R);
  const sy = (y) => H - B - y * (H - T - B);
  const pathOf = (curve) => {
    let d = '';
    for (let i = 0; i <= 100; i++) {
      const x = i / 100;
      d += `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(scurve(x, curve.c1, curve.c2)).toFixed(1)}`;
    }
    return d;
  };

  const draw = () => {
    const curve = Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, Number(input.value)]));
    calcSCurveCoeffs(curve);
    const own = base.pGeneral.growthSCurve;
    const day = Number(age.value);
    const maturity = base.pGeneral.ageAtMaturity;
    const fraction = day / maturity;

    chart.replaceChildren();
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      chart.append(el('line', { x1: sx(0), x2: sx(1), y1: sy(v), y2: sy(v), stroke: '#e2e2e2' }));
      chart.append(el('text', { x: L - 6, y: sy(v) + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#555' }, `${v * 100}%`));
      chart.append(el('text', { x: sx(v), y: H - B + 14, 'text-anchor': 'middle', 'font-size': 10, fill: '#555' }, `${Math.round(v * maturity)}`));
    }
    chart.append(el('text', { x: (sx(0) + sx(1)) / 2, y: H - 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#333' }, 'day'));
    chart.append(el('path', { d: pathOf(own), fill: 'none', stroke: '#9a9a9a', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
    chart.append(el('path', { d: pathOf(curve), fill: 'none', stroke: '#0a6b2a', 'stroke-width': 2.5 }));
    chart.append(el('line', { x1: sx(fraction), x2: sx(fraction), y1: sy(0), y2: sy(1), stroke: '#000080', 'stroke-dasharray': '2 2' }));
    const target = scurve(fraction, curve.c1, curve.c2);
    chart.append(el('circle', { cx: sx(fraction), cy: sy(target), r: 4, fill: '#000080' }));
    for (const [x, y] of [[curve.x1, curve.y1], [curve.x2, curve.y2]]) {
      chart.append(el('rect', { x: sx(x) - 4, y: sy(y) - 4, width: 8, height: 8, fill: '#fff', stroke: '#0a6b2a', 'stroke-width': 2 }));
    }
    chart.append(el('text', { x: sx(0) + 6, y: T + 10, 'font-size': 10, fill: '#0a6b2a' }, 'this curve'));
    chart.append(el('text', { x: sx(0) + 6, y: T + 22, 'font-size': 10, fill: '#777' }, '- - plant\'s own'));

    const plant = variant(base, (p) => { Object.assign(p.pGeneral.growthSCurve, { x1: curve.x1, y1: curve.y1, x2: curve.x2, y2: curve.y2 }); });
    plant.setAge(day);
    paintPlant(canvas, plant, frame);
    $('curveAgeOut').textContent = `${day} / ${maturity}`;
    $('curveReadout').textContent = `On day ${day} the curve's target is ${fmt(100 * target)}% of the mature weight. Grown under this curve, the plant below weighs ${fmt(plant.totalBiomass_pctMPB)}% and has ${plant.partsCreated} parts.`;
  };

  const ownCurve = () => {
    const own = base.pGeneral.growthSCurve;
    for (const k of Object.keys(inputs)) {
      inputs[k].value = own[k];
      shows[k]();
    }
  };
  const choose = () => {
    base = plantByKey(select.value);
    frame = frameFor(base, canvas);
    age.max = base.pGeneral.ageAtMaturity;
    age.value = Math.round(base.pGeneral.ageAtMaturity / 2);
    ownCurve();
    draw();
  };
  // Keeps the first point to the left of the second, which the formula needs.
  for (const [k, input] of Object.entries(inputs)) {
    input.addEventListener('input', () => {
      if (k === 'x1' && Number(input.value) > Number(inputs.x2.value) - 0.05) input.value = Number(inputs.x2.value) - 0.05;
      if (k === 'x2' && Number(input.value) < Number(inputs.x1.value) + 0.05) input.value = Number(inputs.x1.value) + 0.05;
      shows[k]();
      draw();
    });
  }
  age.addEventListener('input', draw);
  $('curveReset').addEventListener('click', () => { ownCurve(); draw(); });
  select.addEventListener('change', choose);
  choose();
}

// ------------------------------------------------------------------ 4. allocation

const KINDS = [
  ['stems', 'Internodes (stem)', '#8b5a2b'],
  ['leaves', 'Leaves', '#2e8b2e'],
  ['buds', 'Meristems (buds)', '#c99a00'],
  ['stalks', 'Inflorescences (flower stalks)', '#6a3d9a'],
  ['flowers', 'Flowers', '#d6409f'],
  ['fruit', 'Fruit', '#d9541e'],
];
const KIND_COLOR = Object.fromEntries(KINDS.map(([k, , c]) => [k, c]));
const KIND_NAME = Object.fromEntries(KINDS.map(([k, n]) => [k, n]));

function kindOf(part) {
  if (part instanceof Internode) return 'stems';
  if (part instanceof Leaf) return 'leaves';
  if (part instanceof Meristem) return 'buds';
  if (part instanceof Inflorescence) return 'stalks';
  return part.stage <= 2 ? 'flowers' : 'fruit';
}

// Runs one day of the plant with a probe on allocate(): before each share-out, the
// asking walk is run once more to read each part's demand.
function probeDay(base, day) {
  const plant = grownTo(base, day);
  const log = [];
  plant.allocate = function (amount, undistributed, askingMode, tellingMode, traverser) {
    traverser.traverseWholePlant(askingMode);
    const byKind = {};
    for (const part of partsOf(this)) {
      if (part.biomassDemand > 0) byKind[kindOf(part)] = (byKind[kindOf(part)] ?? 0) + part.biomassDemand;
    }
    log.push({ askingMode, amount, available: traverser.total, byKind });
    return Plant.prototype.allocate.call(this, amount, undistributed, askingMode, tellingMode, traverser);
  };
  plant.nextDay();
  return log;
}

function setupAllocation() {
  const select = $('allocPlant'), chart = $('allocChart'), age = $('allocAge');
  let base, series;

  const drawDay = () => {
    const day = Number(age.value);
    $('allocAgeOut').textContent = `${day} / ${base.pGeneral.ageAtMaturity}`;
    const log = probeDay(base, day).filter((entry) => entry.askingMode === Mode.DemandVegetative || entry.askingMode === Mode.DemandReproductive);
    chart.replaceChildren();
    const W = 360, L = 92, R = 12;
    const max = Math.max(1e-9, ...log.flatMap((e) => [e.amount, e.available]));
    const sx = (v) => (v / max) * (W - L - R);
    let y = 12;
    const lines = [];
    for (const entry of log) {
      const shoot = entry.askingMode === Mode.DemandVegetative;
      chart.append(el('text', { x: 4, y: y + 10, 'font-size': 11, 'font-weight': 'bold' }, shoot ? 'Shoot growth' : 'Reproduction'));
      y += 18;
      chart.append(el('text', { x: L - 6, y: y + 12, 'text-anchor': 'end', 'font-size': 10 }, 'available'));
      chart.append(el('rect', { x: L, y, width: Math.max(1, sx(entry.amount)), height: 16, fill: '#4a4a4a' }));
      y += 22;
      chart.append(el('text', { x: L - 6, y: y + 12, 'text-anchor': 'end', 'font-size': 10 }, 'asked for'));
      let x = L;
      for (const [kind] of KINDS) {
        const value = entry.byKind[kind];
        if (!value) continue;
        chart.append(el('rect', { x, y, width: Math.max(1, sx(value)), height: 16, fill: KIND_COLOR[kind] }, ''));
        x += sx(value);
      }
      y += 30;
      const share = Math.min(1, safediv(entry.amount, entry.available, 0));
      const parts = KINDS.filter(([k]) => entry.byKind[k]).map(([k]) => `${KIND_NAME[k].toLowerCase()} ${fmt(entry.byKind[k], 2)}`);
      lines.push(`<b>${shoot ? 'Shoot' : 'Reproduction'}:</b> ${fmt(entry.amount, 2)}% available, ${fmt(entry.available, 2)}% asked for (${parts.join(', ')}). Each part gets <b>${fmt(100 * share, 0)}%</b> of what it asked for${entry.amount > entry.available ? ', and the rest waits for tomorrow' : ''}.`);
    }
    if (!log.length) lines.push('Nothing to share out on this day.');
    // Legend.
    let lx = 4;
    y = Math.max(y, 150);
    for (const [kind, name, color] of KINDS) {
      if (!log.some((e) => e.byKind[kind])) continue;
      chart.append(el('rect', { x: lx, y, width: 10, height: 10, fill: color }));
      const label = name.split(' (')[0];
      chart.append(el('text', { x: lx + 14, y: y + 9, 'font-size': 10 }, label));
      lx += 22 + label.length * 5.6;
      if (lx > 300) { lx = 4; y += 16; }
    }
    chart.setAttribute('viewBox', `0 0 360 ${y + 20}`);
    $('allocReadout').innerHTML = lines.join('<br><br>') + `<br><br>Amounts are % of the mature plant's biomass, for day ${day}.`;
    drawSeries(day);
  };

  const drawSeries = (day) => {
    const svg = $('seriesChart');
    svg.replaceChildren();
    const W = 720, H = 260, L = 44, R = 50, T = 16, B = 36;
    svg.setAttribute('viewBox', `0 0 ${W} ${H + 22}`);
    const n = series.length;
    const maxCount = Math.max(1, ...series.flatMap((s) => [s.internodes, s.leaves, s.flowers, s.fruit]));
    const sx = (d) => L + (d / n) * (W - L - R);
    const sy = (v) => H - B - (v / maxCount) * (H - T - B);
    const sy2 = (v) => H - B - (v / 100) * (H - T - B);
    for (let i = 0; i <= 4; i++) {
      const v = Math.round((maxCount * i) / 4);
      svg.append(el('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), stroke: '#e2e2e2' }));
      svg.append(el('text', { x: L - 6, y: sy(v) + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#555' }, v));
      svg.append(el('text', { x: W - R + 6, y: sy2(25 * i) + 4, 'font-size': 10, fill: '#777' }, `${25 * i}%`));
    }
    for (let d = 0; d <= n; d += n > 60 ? 20 : 10) svg.append(el('text', { x: sx(d), y: H - B + 14, 'text-anchor': 'middle', 'font-size': 10, fill: '#555' }, d));
    svg.append(el('text', { x: (L + W - R) / 2, y: H - 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#333' }, 'day'));
    const flowering = base.pGeneral.ageAtWhichFloweringStarts;
    svg.append(el('line', { x1: sx(flowering), x2: sx(flowering), y1: T, y2: H - B, stroke: '#d6409f', 'stroke-dasharray': '3 3' }));
    svg.append(el('text', { x: sx(flowering) + 4, y: T + 8, 'font-size': 10, fill: '#d6409f' }, 'flowering starts'));
    svg.append(el('line', { x1: sx(day), x2: sx(day), y1: T, y2: H - B, stroke: '#000080', 'stroke-width': 1.5 }));
    const line = (key, color, scale = sy, dash) => {
      const d = series.map((s, i) => `${i ? 'L' : 'M'}${sx(i + 1).toFixed(1)},${scale(s[key]).toFixed(1)}`).join('');
      svg.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, ...(dash ? { 'stroke-dasharray': dash } : {}) }));
    };
    line('biomass', '#8a8a8a', sy2, '5 3');
    line('internodes', KIND_COLOR.stems);
    line('leaves', KIND_COLOR.leaves);
    line('flowers', KIND_COLOR.flowers);
    line('fruit', KIND_COLOR.fruit);
    let lx = L;
    for (const [label, color] of [['internodes', KIND_COLOR.stems], ['leaves', KIND_COLOR.leaves], ['flowers', KIND_COLOR.flowers], ['fruit', KIND_COLOR.fruit], ['biomass, % (right scale)', '#8a8a8a']]) {
      svg.append(el('rect', { x: lx, y: H + 6, width: 10, height: 10, fill: color }));
      svg.append(el('text', { x: lx + 14, y: H + 15, 'font-size': 10 }, label));
      lx += 26 + label.length * 5.6;
    }
    svg.append(el('text', { x: 4, y: T - 4, 'font-size': 10, fill: '#555' }, 'count'));
  };

  const choose = () => {
    base = plantByKey(select.value);
    const maturity = base.pGeneral.ageAtMaturity;
    age.max = maturity - 1;
    if (Number(age.value) > maturity - 1) age.value = Math.round(maturity / 2);
    const plant = base.copy();
    plant.reset();
    series = [];
    while (plant.age < maturity) {
      plant.nextDay();
      const t = tally(plant);
      series.push({ internodes: t.internodes, leaves: t.leaves, flowers: t.buds + t.open, fruit: t.unripe + t.ripe, biomass: plant.totalBiomass_pctMPB });
    }
    const name = plants.find((e) => e.key === select.value).name;
    $('seriesNote').textContent = `Above: the ${name} over its ${maturity} days, counted from the same engine after each day. The blue line is the day shown in the bars.`;
    drawDay();
  };
  age.addEventListener('input', drawDay);
  select.addEventListener('change', choose);
  choose();
}

// ------------------------------------------------------------------ 5. part tree

const TREE_COLORS = {
  stem: '#8b5a2b', leaf: '#2e8b2e', dropped: '#c8d8c0', apical: '#d02020', waiting: '#ffffff', growing: '#c99a00',
  stalk: '#6a3d9a', bud: '#f2a7d0', open: '#d6409f', unripe: '#7fb800', ripe: '#d9541e',
};

function setupTree() {
  const select = $('treePlant'), svg = $('treeChart'), age = $('treeAge');
  let base;
  const legend = [
    ['stem', 'Internode'], ['leaf', 'Leaf'], ['apical', 'Apical meristem'], ['waiting', 'Side bud, waiting'],
    ['growing', 'Side bud, growing'], ['stalk', 'Flower stalk'], ['bud', 'Flower bud'], ['open', 'Open flower'],
    ['unripe', 'Unripe fruit'], ['ripe', 'Ripe fruit'],
  ];
  $('treeLegend').innerHTML = legend.map(([k, n]) => `<li><i style="background:${TREE_COLORS[k]}"></i>${n}</li>`).join('');

  let scale = 1; // the view's units per pixel, so markers keep their size on screen
  const render = (plant) => {
    svg.replaceChildren();
    $('treeAgeOut').textContent = `${plant.age} / ${plant.pGeneral.ageAtMaturity}`;
    const first = plant.firstPhytomer;
    if (!first) return;
    const unit = 20;
    const k = scale;
    const rad = (deg) => (deg * Math.PI) / 180;
    const lines = svg.appendChild(el('g'));
    const dots = svg.appendChild(el('g'));

    const marker = (x, y, kind, r = 3.2) => dots.append(el('circle', { cx: x, cy: y, r: r * k, fill: TREE_COLORS[kind], stroke: '#000', 'stroke-width': 0.8 * k }));
    const flowerHead = (part, x, y, angle, length) => {
      const x2 = x + length * Math.sin(angle), y2 = y - length * Math.cos(angle);
      lines.append(el('line', { x1: x, y1: y, x2, y2, stroke: TREE_COLORS.stalk, 'stroke-width': 1.5 * k }));
      part.flowers.forEach((flower, i) => {
        if (flower.hasFallenOff) return;
        const a = angle + rad(-40 + (80 * (i + 0.5)) / Math.max(1, part.flowers.length));
        marker(x2 + 6 * k * Math.sin(a), y2 - 6 * k * Math.cos(a), STAGE_NAMES[flower.stage] === 'buds' ? 'bud' : STAGE_NAMES[flower.stage], 2.6);
      });
      if (!part.flowers.length) marker(x2, y2, 'stalk', 2.4);
    };
    const side = (part, x, y, angle, length, depth) => {
      if (!part) return;
      if (part instanceof Internode) stem(part, x, y, angle, length, depth);
      else if (part instanceof Meristem) {
        const x2 = x + 5 * k * Math.sin(angle), y2 = y - 5 * k * Math.cos(angle);
        marker(x2, y2, part.isApical ? 'apical' : part.isActive ? 'growing' : 'waiting', 2.6);
      } else if (part instanceof Inflorescence) flowerHead(part, x, y, angle, length * 0.7);
    };
    const stem = (node, x, y, angle, length, depth) => {
      let index = 0;
      for (let p = node; p instanceof Internode; p = p.nextPlantPart, index++) {
        const x2 = x + length * Math.sin(angle), y2 = y - length * Math.cos(angle);
        lines.append(el('line', { x1: x, y1: y, x2, y2, stroke: TREE_COLORS.stem, 'stroke-width': Math.max(1, 3 - depth) * k, 'stroke-linecap': 'round' }));
        const flip = index % 2 ? -1 : 1;
        for (const [leaf, sign] of [[p.leftLeaf, flip], [p.rightLeaf, -flip]]) {
          if (!leaf) continue;
          const a = angle + sign * rad(70);
          const lx = x2 + 7 * k * Math.sin(a), ly = y2 - 7 * k * Math.cos(a);
          dots.append(el('ellipse', { cx: lx, cy: ly, rx: 4.5 * k, ry: 2.2 * k, transform: `rotate(${(a * 180) / Math.PI - 90} ${lx} ${ly})`, fill: leaf.hasFallenOff ? TREE_COLORS.dropped : TREE_COLORS.leaf, stroke: leaf.hasFallenOff ? '#9aa' : 'none' }));
        }
        const spread = rad(depth === 0 ? 52 : 40);
        side(p.leftBranchPlantPart, x2, y2, angle + flip * spread, length * 0.72, depth + 1);
        side(p.rightBranchPlantPart, x2, y2, angle - flip * spread, length * 0.72, depth + 1);
        x = x2;
        y = y2;
        if (!(p.nextPlantPart instanceof Internode)) side(p.nextPlantPart, x, y, angle, length, depth);
      }
    };
    stem(first, 0, 0, 0, unit, 0);
    const t = tally(plant);
    $('treeReadout').textContent = `${t.internodes} internodes (${t.branches} starting a branch), ${t.leaves} leaves, ${t.meristems} meristems, ${t.inflorescences} flower stalks, ${t.buds + t.open} flowers, ${t.unripe + t.ripe} fruit.`;
  };
  // The picture is framed on the mature plant's tree, so it grows into a fixed view.
  const choose = () => {
    base = plantByKey(select.value);
    scale = 1;
    render(base);
    let box = svg.getBBox();
    // Once more at roughly the final scale, since marker sizes add to the outline.
    scale = Math.max(box.width / 336, box.height / 356);
    render(base);
    box = svg.getBBox();
    const pad = 12 * scale;
    const width = Math.max(box.width + 2 * pad, ((box.height + 2 * pad) * 360) / 380);
    const height = Math.max(box.height + 2 * pad, (width * 380) / 360);
    svg.setAttribute('viewBox', `${box.x + box.width / 2 - width / 2} ${box.y + box.height + pad - height} ${width} ${height}`);
    scale = width / 360;
    age.max = base.pGeneral.ageAtMaturity;
    age.value = Math.min(Number(age.value), base.pGeneral.ageAtMaturity);
    render(grownTo(base, Number(age.value)));
  };
  const stop = player($('treePlay'), age, () => base, render);
  age.addEventListener('input', () => render(grownTo(base, Number(age.value))));
  select.addEventListener('change', () => { stop(); choose(); });
  choose();
}

// ------------------------------------------------------------------ 6. branching

function setupBranching() {
  const select = $('branchPlant'), canvas = $('branchCanvas');
  const index = $('branchIndex'), distance = $('branchDistance'), angle = $('branchAngle');
  const shows = [bindRange(index, (v) => `${v}%`), bindRange(distance), bindRange(angle, turnDegrees)];
  let base;
  const draw = () => {
    const plant = variant(base, (p) => {
      p.pMeristem.branchingIndex = Number(index.value);
      p.pMeristem.branchingDistance = Number(distance.value);
      p.pMeristem.branchingAngle = Number(angle.value);
    });
    paintPlant(canvas, plant, frameFor(plant, canvas));
    const t = tally(plant);
    $('branchReadout').textContent = `At maturity: ${t.branches} branches, ${t.internodes} internodes, ${plant.partsCreated} parts in all. The angle is in the turtle's 256-step turns.`;
  };
  const own = () => {
    index.value = base.pMeristem.branchingIndex;
    distance.value = base.pMeristem.branchingDistance;
    angle.value = base.pMeristem.branchingAngle;
    shows.forEach((show) => show());
  };
  const choose = () => {
    base = plantByKey(select.value);
    own();
    draw();
  };
  for (const input of [index, distance, angle]) input.addEventListener('input', draw);
  $('branchReset').addEventListener('click', () => { own(); draw(); });
  select.addEventListener('change', choose);
  choose();
}

// ------------------------------------------------------------------ 7. flowering

function setupFlowering() {
  const select = $('flowerPlant'), canvas = $('flowerCanvas'), age = $('flowerAge');
  let base, frame;
  const render = (plant) => {
    paintPlant(canvas, plant, frame);
    $('flowerAgeOut').textContent = `${plant.age} / ${plant.pGeneral.ageAtMaturity}`;
    const t = tally(plant);
    $('flowerStages').innerHTML = [['Buds', t.buds, 'bud'], ['Open', t.open, 'open'], ['Unripe fruit', t.unripe, 'unripe'], ['Ripe fruit', t.ripe, 'ripe']]
      .map(([name, n, k]) => `<div style="border-top:4px solid ${TREE_COLORS[k]}"><b>${n}</b>${name}</div>`).join('');
    const g = plant.pGeneral;
    $('flowerReadout').textContent = plant.floweringHasStarted
      ? `Flowering started on day ${plant.ageAtWhichFloweringStarted}. ${t.inflorescences} flower stalks so far; ${t.dropped} flowers have dropped. ${fmt(plant.reproBiomass_pctMPB)}% of the plant's biomass is now in flowers and fruit.`
      : `Flowering starts on day ${g.ageAtWhichFloweringStarts}. Until then all growth goes to stems and leaves.`;
  };
  const choose = () => {
    base = plantByKey(select.value);
    frame = frameFor(base, canvas);
    age.max = base.pGeneral.ageAtMaturity;
    age.value = Math.min(age.max, base.pGeneral.ageAtWhichFloweringStarts + 15);
    render(grownTo(base, Number(age.value)));
  };
  const stop = player($('flowerPlay'), age, () => base, render);
  age.addEventListener('input', () => render(grownTo(base, Number(age.value))));
  select.addEventListener('change', () => { stop(); choose(); });
  choose();
}

// ------------------------------------------------------------------ 8. turtle

function setupTurtle() {
  const select = $('turtlePlant'), canvas = $('turtleCanvas');
  const phyllo = $('turtlePhyllo'), divisions = $('turtleDivisions'), curving = $('turtleCurving'), spin = $('turtleSpin');
  const shows = [bindRange(phyllo, (v) => `${v}°`), bindRange(divisions), bindRange(curving), bindRange(spin, (v) => `${v}°`)];
  let base, frame;
  const draw = () => {
    const plant = variant(base, (p) => {
      p.pGeneral.phyllotacticRotationAngle = Number(phyllo.value);
      p.pGeneral.lineDivisions = Number(divisions.value);
      p.pInternode.curvingIndex = Number(curving.value);
      p.xRotation = Number(spin.value);
    });
    paintPlant(canvas, plant, frame);
  };
  const own = () => {
    phyllo.value = base.pGeneral.phyllotacticRotationAngle;
    divisions.value = base.pGeneral.lineDivisions;
    curving.value = base.pInternode.curvingIndex;
    spin.value = 0;
    shows.forEach((show) => show());
  };
  const choose = () => {
    base = plantByKey(select.value);
    // A little room around the plant, since turning it changes its outline.
    const fit = frameFor(base, canvas);
    frame = { ...fit, scale: fit.scale * 0.85, x: canvas.width / 2 + (fit.x - canvas.width / 2) * 0.85, y: canvas.height / 2 + (fit.y - canvas.height / 2) * 0.85 };
    own();
    draw();
  };
  for (const input of [phyllo, divisions, curving, spin]) input.addEventListener('input', draw);
  $('turtleReset').addEventListener('click', () => { own(); draw(); });
  select.addEventListener('change', choose);
  choose();
}

// ------------------------------------------------------------------ 9. 3D objects

function setupObjects() {
  const select = $('tdoPlant');
  const show = (canvas, caption, label, tdo) => {
    const context = canvas.getContext('2d');
    if (!tdo || !tdo.points.length) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      caption.textContent = `${label}: none`;
      return;
    }
    paintTdo(canvas, tdo);
    caption.textContent = `${label}: "${tdo.name}", ${tdo.points.length} points, ${tdo.triangles.length} triangles`;
  };
  const draw = () => {
    const plant = plantByKey(select.value);
    show($('tdoLeaf'), $('tdoLeafCap'), 'Leaf', plant.pLeaf.leafTdoParams.object3D);
    show($('tdoPetal'), $('tdoPetalCap'), 'Petal', plant.pFlower[FEMALE].tdoParams[3].object3D);
    show($('tdoFruit'), $('tdoFruitCap'), 'Fruit', plant.pFruit.tdoParams.object3D);
  };
  select.addEventListener('change', draw);
  draw();
}

// The plant drawn into a raster that remembers which part made each pixel, to find
// where its highest flower is.
function topFlowerBox(plant, width, height, frame) {
  const raster = new Raster(width, height);
  const turtle = new Turtle(new RasterSurface(raster));
  raster.clear(0xffffff);
  POSING.drawingForOutput = true;
  try {
    plant.drawOn(turtle, DRAW_MODES.solids, frame.scale, frame.x, frame.y);
  } finally {
    POSING.drawingForOutput = false;
  }
  const flowers = new Set(partsOf(plant).filter((p) => p instanceof FlowerFruit && p.stage === 2).map((p) => p.partID));
  const boxes = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = raster.parts[y * width + x];
      if (!flowers.has(id)) continue;
      const box = boxes.get(id) ?? { left: x, right: x, top: y, bottom: y };
      box.left = Math.min(box.left, x); box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
      boxes.set(id, box);
    }
  }
  return [...boxes.values()].sort((a, b) => a.top - b.top)[0] ?? null;
}

function setupPetals() {
  const select = $('petalPlant'), canvas = $('petalCanvas');
  const count = $('petalCount'), pull = $('petalPull');
  const shows = [bindRange(count), bindRange(pull, turnDegrees)];
  let base, frame;
  const petals = (p) => p.pFlower[FEMALE].tdoParams[3];
  const draw = () => {
    const plant = variant(base, (p) => {
      petals(p).repetitions = Number(count.value);
      petals(p).pullBackAngle = Number(pull.value);
    });
    paintPlant(canvas, plant, frame);
  };
  const own = () => {
    count.value = petals(base).repetitions;
    pull.value = petals(base).pullBackAngle;
    shows.forEach((show) => show());
  };
  const choose = () => {
    base = plantByKey(select.value);
    const W = canvas.width, H = canvas.height;
    // Fit the whole plant into a big raster, find its top flower there, and zoom onto it.
    const big = 1200;
    const fit = fitPlant(base, big, big);
    const box = topFlowerBox(base, big, big, fit);
    if (box) {
      const zoom = Math.min(W / (box.right - box.left + 1), H / (box.bottom - box.top + 1)) * 0.45;
      const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
      frame = { scale: fit.scale * zoom, x: W / 2 - (cx - fit.x) * zoom, y: H / 2 - (cy - fit.y) * zoom };
    } else {
      frame = frameFor(base, canvas);
    }
    own();
    draw();
  };
  for (const input of [count, pull]) input.addEventListener('input', draw);
  $('petalReset').addEventListener('click', () => { own(); draw(); });
  select.addEventListener('change', choose);
  choose();
}

// ------------------------------------------------------------------ 10. painter's algorithm

function setupPainter() {
  const select = $('paintPlant'), canvas = $('paintCanvas'), mode = $('paintMode');
  const context = canvas.getContext('2d');
  const raster = new Raster(canvas.width, canvas.height);
  const surface = new RasterSurface(raster);
  const turtle = new Turtle(surface);
  let walk = [], sorted = [], timer = null;

  const show = () => {
    const pixels = new Uint8ClampedArray(raster.pixels.slice().buffer);
    context.putImageData(new ImageData(pixels, raster.width, raster.height), 0, 0);
  };
  // The walk's primitives, kept in the order the turtle made them instead of being
  // painted, and a copy sorted the way finish() sorts them.
  const record = () => {
    const plant = plantByKey(select.value);
    const frame = frameFor(plant, canvas);
    const options = DRAW_MODES[mode.value];
    POSING.drawingForOutput = true;
    try {
      turtle.reset(options, frame.scale, frame.x, frame.y);
      surface.recording = true;
      plant.draw(turtle);
    } finally {
      POSING.drawingForOutput = false;
    }
    walk = surface.primitives;
    surface.primitives = [];
    surface.recording = false;
    sorted = walk.slice();
    if (options.sortTdosAsOneItem) {
      for (const item of sorted) if (!item.isLine && item.tdo) item.zForSorting = item.tdo.zForSorting + item.zForSorting * 0.01;
    }
    quicksort(sorted, 0, sorted.length - 1);
  };
  const counts = () => {
    const lines = walk.filter((item) => item.isLine).length;
    return `${lines} lines and ${walk.length - lines} triangles`;
  };
  const paintAll = (list) => {
    raster.clear(0xffffff);
    for (const item of list) surface.paint(item);
    show();
  };
  const animate = (list, label) => {
    clearInterval(timer);
    raster.clear(0xffffff);
    let i = 0;
    const step = Math.max(1, Math.ceil(list.length / 240));
    timer = setInterval(() => {
      for (let k = 0; k < step && i < list.length; k++, i++) surface.paint(list[i]);
      show();
      $('paintReadout').textContent = `${label}: ${i} of ${list.length} painted (${counts()}).`;
      if (i >= list.length) clearInterval(timer);
    }, 1000 / 60);
  };
  const choose = () => {
    clearInterval(timer);
    record();
    paintAll(sorted);
    $('paintReadout').textContent = `${counts()}, painted back to front. Watch the two orders: in walk order, later parts cover earlier ones whatever their depth.`;
  };
  $('paintWalk').addEventListener('click', () => animate(walk, 'Walk order'));
  $('paintSorted').addEventListener('click', () => animate(sorted, 'Back to front'));
  select.addEventListener('change', choose);
  mode.addEventListener('change', choose);
  choose();
}

// ------------------------------------------------------------------ 11. breeding

function setupBreeding() {
  const a = $('breedPlantA'), b = $('breedPlantB'), mutation = $('breedMutation'), weight = $('breedWeight');
  bindRange(weight, (v) => `${v}%`);
  const draw = () => {
    const first = plantByKey(a.value), second = plantByKey(b.value);
    paintPlant($('breedA'), first, frameFor(first, $('breedA')));
    paintPlant($('breedB'), second, frameFor(second, $('breedB')));
    const children = $('breedChildren');
    children.replaceChildren();
    for (let i = 0; i < 6; i++) {
      const generator = new Random(1 + Math.floor(Math.random() * 2147483000));
      const child = breed(first, second, { mutation: Number(mutation.value), firstWeight: Number(weight.value) }, generator);
      const figure = document.createElement('figure');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 150;
      figure.append(canvas);
      children.append(figure);
      paintPlant(canvas, child, frameFor(child, canvas));
    }
  };
  for (const input of [a, b, mutation]) input.addEventListener('change', draw);
  weight.addEventListener('change', draw);
  $('breedAgain').addEventListener('click', draw);
  draw();
}

// ------------------------------------------------------------------ 12. overgrowth

function setupOvergrowth() {
  const select = $('overPlant'), canvas = $('overCanvas'), chart = $('overChart'), age = $('overAge');
  const days = $('overDays'), rate = $('overRate'), fixed = $('overFixed');
  const shows = [bindRange(days, (v) => `+${v}`), bindRange(rate, (v) => `${fmt(v)}%`)];
  // The plant is drawn at one scale for every day: by default the scale that fits it on
  // its last day, so it grows across the canvas instead of the view zooming out.
  let base, matureFrame, lastFrame, plant, series, timer = null, pending = false;

  const settings = () => {
    const mode = document.querySelector('input[name="overMode"]:checked').value;
    return { days: Number(days.value), rate: Number(rate.value) / 100, swell: mode === 'swell', wake: mode === 'wake' };
  };
  const overgrown = () => {
    const p = base.copy();
    Object.assign(p.overgrowth, settings());
    p.reset();
    return p;
  };

  // One pass from day 0 to the last day, recording weight and parts for the chart.
  const record = () => {
    const p = overgrown();
    series = [];
    while (p.age < p.lastDay()) {
      p.nextDay();
      series.push({ day: p.age, weight: p.totalBiomass_pctMPB, parts: p.partsCreated, piled: p.unallocatedNewVegetativeBiomass_pctMPB });
    }
    lastFrame = frameFor(p, canvas);
  };

  const W = 360, H = 240, L = 44, R = 14, T = 14, B = 34;
  const drawChart = (day) => {
    const last = series.length;
    const maturity = base.pGeneral.ageAtMaturity;
    const top = Math.max(2, Math.ceil(Math.log10(Math.max(...series.map((d) => Math.max(d.weight, d.parts))))));
    const sx = (d) => L + (d / Math.max(1, last)) * (W - L - R);
    const sy = (v) => H - B - (Math.log10(Math.max(1, v)) / top) * (H - T - B);
    chart.replaceChildren();
    for (let e = 0; e <= top; e++) {
      chart.append(el('line', { x1: sx(0), x2: sx(last), y1: sy(10 ** e), y2: sy(10 ** e), stroke: '#e2e2e2' }));
      chart.append(el('text', { x: L - 6, y: sy(10 ** e) + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#555' }, Number(10 ** e).toLocaleString('en')));
    }
    for (const d of [0, maturity, last]) {
      chart.append(el('text', { x: sx(d), y: H - B + 14, 'text-anchor': 'middle', 'font-size': 10, fill: '#555' }, `${d}`));
    }
    chart.append(el('text', { x: (sx(0) + sx(last)) / 2, y: H - 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#333' }, 'day (log scale up the side)'));
    chart.append(el('rect', { x: sx(maturity), y: T, width: Math.max(0, sx(last) - sx(maturity)), height: H - T - B, fill: '#f3ece0' }));
    chart.append(el('line', { x1: sx(maturity), x2: sx(maturity), y1: T, y2: H - B, stroke: '#9a9a9a', 'stroke-dasharray': '4 3' }));
    const line = (key, stroke, dash) => {
      const d = series.map((point, i) => `${i ? 'L' : 'M'}${sx(point.day).toFixed(1)},${sy(point[key]).toFixed(1)}`).join('');
      chart.append(el('path', { d, fill: 'none', stroke, 'stroke-width': 2, ...(dash ? { 'stroke-dasharray': dash } : {}) }));
    };
    line('weight', '#0a6b2a');
    line('parts', '#000080');
    line('piled', '#b03000', '3 2');
    chart.append(el('line', { x1: sx(day), x2: sx(day), y1: T, y2: H - B, stroke: '#000', 'stroke-dasharray': '2 2' }));
    const labels = [['weight, % of mature', '#0a6b2a'], ['parts', '#000080'], ['unallocated, %', '#b03000']];
    labels.forEach(([text, fill], i) => chart.append(el('text', { x: sx(0) + 6, y: T + 10 + 12 * i, 'font-size': 10, fill }, text)));
    chart.append(el('text', { x: sx(maturity) + 4, y: H - B - 6, 'font-size': 10, fill: '#777' }, 'past maturity'));
  };

  const render = () => {
    const day = plant.age;
    const frame = fixed.checked ? matureFrame : lastFrame;
    paintPlant(canvas, plant, frame);
    const shrink = matureFrame.scale / frame.scale;
    drawChart(day);
    const maturity = base.pGeneral.ageAtMaturity;
    $('overAgeOut').textContent = day > maturity ? `${maturity} + ${day - maturity}` : `${day} / ${maturity}`;
    const t = tally(plant);
    const piled = plant.unallocatedNewVegetativeBiomass_pctMPB;
    $('overReadout').innerHTML = `On day ${day} the plant weighs <b>${Math.round(plant.totalBiomass_pctMPB).toLocaleString('en')}%</b> of its mature weight `
      + `and has ${plant.partsCreated.toLocaleString('en')} parts: ${t.internodes} internodes, ${t.leaves} leaves, ${t.buds + t.open} flowers, ${t.unripe + t.ripe} fruit. `
      + (piled > 1 ? `${Math.round(piled).toLocaleString('en')}% of it is weight no part could take.` : 'Every bit of its weight has gone into a part.')
      + (plant.partsCreated > 10000 ? ' It has hit the 10,000-part limit.' : '')
      + (shrink > 1.2 ? ` Drawn at 1/${fmt(shrink, shrink < 10 ? 1 : 0)} of the mature plant's scale.` : '');
  };

  // Regrowing a big plant takes a moment, so slider moves are coalesced into one per frame.
  const regrowLater = (again) => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      again();
    });
  };
  const showDay = () => regrowLater(() => {
    plant = overgrown();
    plant.setAge(Number(age.value));
    render();
  });
  const rebuild = () => regrowLater(() => {
    stop();
    record();
    plant = overgrown();
    age.max = plant.lastDay();
    age.value = age.max;
    plant.setAge(plant.lastDay());
    render();
  });

  function stop() {
    clearTimeout(timer);
    timer = null;
    $('overPlay').textContent = 'Play';
  }
  $('overPlay').addEventListener('click', () => {
    if (timer) return stop();
    plant = overgrown();
    $('overPlay').textContent = 'Stop';
    const step = () => {
      if (plant.age >= plant.lastDay()) return stop();
      plant.nextDay();
      age.value = plant.age;
      render();
      timer = setTimeout(step, 40);
    };
    step();
  });
  age.addEventListener('pointerdown', stop);

  const choose = () => {
    base = plantByKey(select.value);
    matureFrame = frameFor(base, canvas);
    rebuild();
  };
  age.addEventListener('input', showDay);
  for (const input of [days, rate]) input.addEventListener('input', rebuild);
  for (const radio of document.querySelectorAll('input[name="overMode"]')) radio.addEventListener('change', rebuild);
  fixed.addEventListener('change', render);
  select.addEventListener('change', choose);
  shows.forEach((show) => show());
  choose();
}

// ------------------------------------------------------------------ start

await loadPlants();
const DEFAULTS = {
  daysPlant: 'phlox', seedPlant: 'thistle', curvePlant: 'sunflower', allocPlant: 'tomato', treePlant: 'tomato',
  branchPlant: 'thistle', flowerPlant: 'tomato', turtlePlant: 'sunflower', tdoPlant: 'tomato', petalPlant: 'rose',
  paintPlant: 'phlox', breedPlantA: 'phlox', breedPlantB: 'gilia', overPlant: 'thistle',
};
for (const [id, name] of Object.entries(DEFAULTS)) fillPlantSelect($(id), name);
fillExcerpts();
for (const setup of [setupDays, setupSeed, setupCurve, setupAllocation, setupTree, setupBranching, setupFlowering, setupTurtle, setupObjects, setupPetals, setupPainter, setupBreeding, setupOvergrowth]) {
  try {
    setup();
  } catch (error) {
    console.error(setup.name, error);
  }
}
