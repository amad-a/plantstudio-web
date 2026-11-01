// The tabs under the plant list: Arrangement, Parameters, Age, Posing, Stats and Note.

import { PARAMS, SECTIONS } from '../model/params.js';
import { Internode, Leaf, newAmendment, POSING } from '../model/plant.js';
import { Inflorescence, FlowerFruit, Meristem } from '../model/parts.js';
import { scurve, safediv, clamp, colorToHex, hexToColor, calcSCurveCoeffs, round } from '../model/support.js';
import { $, el } from './dom.js';
import { openTdoEditor } from './tdo-editor.js';

const ROTATIONS = [['X', 'xRotation'], ['Y', 'yRotation'], ['Z', 'zRotation']];
const TRANSVERSE = ['Numbers of things', 'Lengths', 'Widths', 'Angles', 'Rotations', 'Colors', '3D objects', 'Biomass', 'Timing', 'Arrangement'];
const PICKABLE_SECTIONS = SECTIONS.filter((section) => section !== '(no section)');

function numberField(label, value, onChange, props = {}) {
  const id = `field-${label.replace(/\W/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
  const input = el('input', { id, type: 'number', value, ...props, onchange: () => onChange(Number(input.value)) });
  return [el('label', { for: id }, label), input];
}

export const TABS = {
  arrangement: {
    title: 'Arrangement',
    render(app, plant) {
      if (!plant) return [el('p', {}, '(no plants selected)')];
      const applyToSelected = (change) => {
        for (const each of app.selected) change(each);
        app.view.requestDraw();
      };
      return [
        el('p', {}, el('b', {}, app.selected.size > 1 ? `${app.selected.size} plants selected` : plant.name)),
        el('div', { class: 'row' }, 'Location',
          ...numberField('X', round(plant.basePoint_mm.x), (v) => applyToSelected((p) => { p.basePoint_mm.x = v; })),
          ...numberField('Y', round(plant.basePoint_mm.y), (v) => applyToSelected((p) => { p.basePoint_mm.y = v; })),
          'mm'),
        el('div', { class: 'row' },
          ...numberField('Size', plant.drawingScale_PixelsPerMm, (v) => applyToSelected((p) => { p.drawingScale_PixelsPerMm = v > 0 ? v : p.drawingScale_PixelsPerMm; }), { step: 0.01, min: 0.01 }),
          'pixels/mm'),
        el('div', { class: 'row' }, 'Rotation',
          ...ROTATIONS.flatMap(([axis, key]) => numberField(axis, round(plant[key]), (v) => applyToSelected((p) => { p[key] = v; }), { min: -360, max: 360 }))),
        el('div', { class: 'row' },
          el('button', { onclick: () => app.run('resetRotations') }, 'Reset Rotations'),
          el('button', { onclick: () => app.run('randomize') }, 'Randomize')),
        el('div', { class: 'row' },
          el('button', { onclick: () => app.run('alignTops') }, 'Tops'),
          el('button', { onclick: () => app.run('alignBottoms') }, 'Bottoms'),
          el('button', { onclick: () => app.run('alignLeft') }, 'Lefts'),
          el('button', { onclick: () => app.run('alignRight') }, 'Rights')),
        el('div', { class: 'row' },
          el('button', { onclick: () => app.run('equalScale') }, 'Equal Size'),
          el('button', { onclick: () => app.run('pack') }, 'Pack')),
      ];
    },
  },

  parameters: {
    title: 'Parameters',
    section: PICKABLE_SECTIONS[0],
    render(app, plant) {
      if (!plant) return [el('p', {}, '(no plants selected)')];
      const select = el('select', { 'aria-label': 'Parameter section', onchange: () => { this.section = select.value; app.refreshPanel(); } },
        ...[...PICKABLE_SECTIONS, ...TRANSVERSE].map((name) => el('option', { selected: name === this.section }, name)));
      const hint = el('p', { class: 'hint' }, 'Point at a parameter to read about it.');
      const grid = el('div', { class: 'params' });
      const isTransverse = TRANSVERSE.includes(this.section);
      for (const param of PARAMS) {
        const belongs = isTransverse ? param.also?.includes(this.section) && param.section !== '(no section)' : param.section === this.section;
        if (!belongs) continue;
        if (param.type === 'header') {
          grid.append(el('h4', { onmouseenter: () => { hint.textContent = param.hint; } }, param.name));
        } else {
          grid.append(...editorFor(app, plant, param, hint));
        }
      }
      return [el('div', { class: 'row' }, select), hint, grid];
    },
  },

  age: {
    title: 'Age',
    render(app, plant) {
      if (!plant) return [el('p', {}, '(no plants selected)')];
      const max = plant.pGeneral.ageAtMaturity;
      const graph = el('canvas', { id: 'ageGraph', width: 300, height: 90, 'aria-label': 'Life cycle graph' });
      const setAge = (age) => {
        app.setAge(plant, age);
        days.value = plant.age;
        slider.value = plant.age;
        label.textContent = ageLabel(plant);
        drawLifeCycle(graph, plant);
      };
      const days = el('input', { type: 'number', value: plant.age, min: 0, max, onchange: () => setAge(Number(days.value)) });
      const slider = el('input', { type: 'range', 'aria-label': 'Age', min: 0, max, value: plant.age, oninput: () => setAge(Number(slider.value)), style: 'width:100%' });
      const label = el('span', {}, ageLabel(plant));
      const dragGraph = (event) => {
        const rect = graph.getBoundingClientRect();
        setAge(round(clamp((event.clientX - rect.left) / rect.width, 0, 1) * max));
      };
      graph.addEventListener('pointerdown', (event) => {
        graph.setPointerCapture(event.pointerId);
        dragGraph(event);
        graph.addEventListener('pointermove', dragGraph);
      });
      graph.addEventListener('pointerup', () => graph.removeEventListener('pointermove', dragGraph));
      drawLifeCycle(graph, plant);
      return [
        el('p', {}, el('b', {}, plant.name)),
        graph,
        el('p', { style: 'text-align:center;margin:2px 0 6px' }, 'time (days)'),
        slider,
        el('div', { class: 'row spacer-top' }, 'Age', days, label),
        el('div', { class: 'row' },
          el('button', { id: 'animate', onclick: () => app.run('animate') }, app.animation ? 'Stop' : 'Animate'),
          app.animation ? el('span', {}, 'Animating! Press space bar to stop.') : null),
      ];
    },
  },

  posing: {
    title: 'Posing',
    render(app, plant) {
      if (!plant) return [el('p', {}, '(no plants selected)')];
      const partID = plant.selectedPartID;
      const amendment = partID >= 0 ? plant.amendmentForPartID(partID) : null;
      const partName = (id, type) => `${id} (${type})`;
      const selectedType = amendment?.typeOfPart ?? plant.plantPartForPartID(partID)?.getName() ?? 'part';
      const redraw = () => {
        app.view.requestDraw();
        app.refreshPanel();
      };
      const posedParts = el('select', {
        'aria-label': 'Posed parts',
        onchange: () => {
          plant.selectedPartID = Number(posedParts.value);
          redraw();
        },
      },
      el('option', { value: -1, selected: !amendment }, plant.amendments.length ? '< Select None >' : '(none)'),
      ...plant.amendments.map((each) => el('option', { value: each.partID, selected: each === amendment }, partName(each.partID, each.typeOfPart))));
      const displayButton = (key, icon, title, pressedWhen) => el('button', {
        class: `tool${pressedWhen() ? ' pressed' : ''}`, title,
        onclick: () => {
          POSING[key] = !POSING[key];
          redraw();
        },
      }, el('img', { src: `icons/MainForm_${icon}.png`, alt: title }));
      const pose = () => {
        plant.amendments.push(newAmendment(partID, selectedType));
        app.markChanged();
        redraw();
      };
      const unpose = () => {
        plant.amendments.splice(plant.amendments.indexOf(amendment), 1);
        app.markChanged();
        redraw();
      };
      const controls = [
        el('p', {}, el('b', {}, `Posing for ${plant.name}`)),
        el('div', { class: 'row' }, 'Posed parts', posedParts,
          displayButton('showHighlightingForNonHiddenPosedParts', 'posingHighlight', 'Highlight posed parts', () => POSING.showHighlightingForNonHiddenPosedParts),
          displayButton('showGhostingForHiddenParts', 'posingGhost', 'Ghost hidden parts', () => POSING.showGhostingForHiddenParts),
          displayButton('showPosingAtAll', 'posingNotShown', 'Ignore all posing', () => !POSING.showPosingAtAll)),
        el('p', {}, partID >= 0 ? `Selected part: ${partName(partID, selectedType)}` : 'Selected part: (none). Use the posing tool in the toolbar, then click a part of this plant.'),
        el('div', { class: 'row' },
          el('button', { disabled: partID < 0 || amendment !== null, onclick: pose }, 'Pose'),
          el('button', { disabled: amendment === null, onclick: unpose }, 'Unpose')),
      ];
      return amendment ? [...controls, ...poseDetails(app, amendment)] : controls;
    },
  },

  stats: {
    title: 'Stats',
    render(app, plant) {
      if (!plant) return [el('p', {}, '(no plants selected)')];
      const counts = countParts(plant);
      const percent = (n) => `${n.toFixed(1)}%`;
      const rows = [
        ['Age', `${plant.age} of ${plant.pGeneral.ageAtMaturity} days`],
        ['Parts created', plant.partsCreated],
        ['Internodes', counts.internodes],
        ['Leaves', counts.leaves],
        ['Meristems', counts.meristems],
        ['Inflorescences', counts.inflorescences],
        ['Flowers and buds', counts.flowers],
        ['Fruits', counts.fruits],
        ['Total biomass', percent(plant.totalBiomass_pctMPB)],
        ['Shoot biomass', percent(plant.shootBiomass_pctMPB)],
        ['Reproductive biomass', percent(plant.reproBiomass_pctMPB)],
      ];
      return [
        el('p', {}, el('b', {}, plant.name)),
        el('table', { class: 'stats' }, ...rows.map(([name, value]) => el('tr', {}, el('td', {}, name), el('td', {}, String(value))))),
      ];
    },
  },

  note: {
    title: 'Note',
    render(app, plant) {
      if (!plant) return [el('p', {}, '(no plants selected)')];
      const text = el('textarea', { id: 'noteText', 'aria-label': 'Note', value: plant.noteLines.join('\n'), onchange: () => { plant.noteLines = text.value ? text.value.split('\n') : []; app.markChanged(); } });
      return [el('p', {}, el('b', {}, `Note for ${plant.name}`)), text];
    },
  },
};

function poseDetails(app, amendment) {
  const update = (key, value, rerender = false) => {
    amendment[key] = value;
    app.markChanged();
    app.view.requestDraw();
    if (rerender) app.refreshPanel();
  };
  const check = (label, key) => {
    const id = `pose-${key}`;
    return [el('input', { id, type: 'checkbox', checked: amendment[key], onchange: (event) => update(key, event.target.checked, true) }), el('label', { for: id }, label)];
  };
  const number = (label, key, min, max, enabled) => numberField(label, amendment[key], (value) => update(key, clamp(round(value), min, max)), { min, max, disabled: !enabled });
  const rotated = amendment.addRotations, scaled = amendment.multiplyScale;
  return [
    el('div', { class: 'row' }, ...check('Hide this part and all parts that depend on it', 'hide')),
    el('div', { class: 'row' }, ...check('Add an extra rotation to this part', 'addRotations')),
    el('div', { class: 'row' },
      ...number('X', 'xRotation', -360, 360, rotated), ...number('Y', 'yRotation', -360, 360, rotated), ...number('Z', 'zRotation', -360, 360, rotated), 'degrees'),
    el('div', { class: 'row' }, ...check("Multiply this part's size", 'multiplyScale')),
    el('div', { class: 'row' },
      ...number('3D object scale %', 'scaleMultiplier_pct', 0, 1000, scaled),
      ...number('line length %', 'lengthMultiplier_pct', 0, 1000, scaled),
      ...number('line width %', 'widthMultiplier_pct', 0, 1000, scaled)),
    el('div', { class: 'row' }, el('input', { id: 'pose-propagateScale', type: 'checkbox', disabled: !scaled, checked: amendment.propagateScale, onchange: (event) => update('propagateScale', event.target.checked) }),
      el('label', { for: 'pose-propagateScale' }, 'Keep doing this up to the next posed part, with dependents')),
  ];
}

const ageLabel = (plant) => {
  const curve = plant.pGeneral.growthSCurve;
  const size = clamp(100 * scurve(safediv(plant.age, plant.pGeneral.ageAtMaturity, 0), curve.c1, curve.c2), 0, 100);
  return `days, ${round(size)}% max size`;
};

function drawLifeCycle(canvas, plant) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  const curve = plant.pGeneral.growthSCurve;
  const max = plant.pGeneral.ageAtMaturity;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#008000';
  for (let x = 0; x < width; x++) {
    const size = clamp(scurve(x / (width - 1), curve.c1, curve.c2), 0, 1);
    const h = round(size * (height - 6));
    context.fillRect(x, height - 3 - h, 1, h);
  }
  const marker = round((safediv(plant.age, max, 0) * (width - 1)));
  context.fillStyle = '#000080';
  context.fillRect(marker, 0, 2, height);
}

function editorFor(app, plant, param, hint) {
  const value = plant.get(param);
  const id = `param-${param.id}`;
  const props = {
    id,
    onmouseenter: () => { hint.textContent = param.hint; },
    onfocus: () => { hint.textContent = param.hint; },
  };
  const label = el('label', { for: id, title: param.hint, onmouseenter: props.onmouseenter }, param.name + (param.unit && !['(no unit)', 'fraction', 'True/False'].includes(param.unit) ? ` (${param.unit})` : ''));
  const apply = (next) => app.setParameter(plant, param, next);
  if (param.scurve) {
    const change = (key) => (event) => {
      const next = { ...plant.get(param), [key]: Number(event.target.value) };
      calcSCurveCoeffs(next);
      apply(next);
    };
    return [label, el('span'), el('div', { class: 'scurve' }, ...['x1', 'y1', 'x2', 'y2'].map((key) =>
      el('input', { type: 'number', step: 0.01, min: 0.01, max: 0.99, 'aria-label': `${param.name} ${key}`, value: value[key], onchange: change(key) })))];
  }
  switch (param.type) {
    case 'bool':
      return [label, el('input', { ...props, type: 'checkbox', checked: value, onchange: (event) => apply(event.target.checked) })];
    case 'enum':
      return [label, el('select', { ...props, onchange: (event) => apply(Number(event.target.value)) },
        ...param.choices.map((choice, index) => el('option', { value: index, selected: index === value }, choice)))];
    case 'color':
      return [label, el('input', { ...props, type: 'color', value: colorToHex(value), onchange: (event) => apply(hexToColor(event.target.value)) })];
    case 'tdo': {
      const library = app.tdoLibrary;
      const names = library.map((tdo) => tdo.name);
      const select = el('select', { ...props, onchange: () => apply(library.find((tdo) => tdo.name === select.value).copy()) },
        ...(names.includes(value.name) ? [] : [el('option', { selected: true }, value.name)]),
        ...names.map((name) => el('option', { selected: name === value.name }, name)));
      const edit = el('button', {
        class: 'tool wide', title: 'Edit this 3D object',
        onclick: () => openTdoEditor(plant.get(param), (edited) => {
          app.setParameter(plant, param, edited);
          app.refreshPanel();
        }),
      }, 'Edit...');
      return [label, el('div', { class: 'tdo-field' }, select, edit)];
    }
    default: {
      const input = el('input', {
        ...props, type: 'number', value: param.type === 'float' ? Number(value.toFixed(4)) : value,
        min: param.lower, max: param.upper, step: param.type === 'int' ? 1 : 'any',
        onchange: () => {
          let next = Number(input.value);
          if (param.lower !== undefined || param.upper !== undefined) next = clamp(next, param.lower ?? -Infinity, param.upper ?? Infinity);
          apply(param.type === 'int' ? round(next) : next);
        },
      });
      return [label, input];
    }
  }
}

function countParts(plant) {
  const counts = { internodes: 0, leaves: 0, meristems: 0, inflorescences: 0, flowers: 0, fruits: 0 };
  const seen = new Set();
  const walk = (part) => {
    if (!part || seen.has(part)) return;
    seen.add(part);
    if (part instanceof Internode) {
      counts.internodes++;
      for (const leaf of [part.leftLeaf, part.rightLeaf]) {
        if (leaf instanceof Leaf && !leaf.hasFallenOff) counts.leaves++;
      }
      walk(part.leftBranchPlantPart);
      walk(part.rightBranchPlantPart);
      walk(part.nextPlantPart);
    } else if (part instanceof Meristem) {
      counts.meristems++;
    } else if (part instanceof Inflorescence) {
      counts.inflorescences++;
      for (const flower of part.flowers) {
        if (flower instanceof FlowerFruit && !flower.hasFallenOff) {
          if (flower.stage > 2) counts.fruits++;
          else counts.flowers++;
        }
      }
    }
  };
  walk(plant.firstPhytomer);
  return counts;
}

export function renderTabs(app, active) {
  const tabs = $('tabs');
  tabs.replaceChildren(...Object.entries(TABS).map(([key, tab]) =>
    el('li', { role: 'tab', 'aria-selected': String(key === active) },
      el('a', { href: `#${key}`, onclick: (event) => { event.preventDefault(); app.showTab(key); } }, tab.title))));
}
