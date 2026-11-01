// The main window: plants, selection, menus and commands (umain.pas).

import { parsePlantFile, plantsToFile, POSING } from '../model/plant.js';
import { exportPlantsToObj } from '../model/export.js';
import { parseTdoLibrary } from '../model/tdo.js';
import { Random, calcSCurveCoeffs } from '../model/support.js';
import { $, el, openDialog, prompt98, download, makeDraggable, makeResizable, keepOnScreen } from './dom.js';
import { View } from './view.js';
import { TABS, renderTabs } from './panels.js';
import { openBreeder } from './breeder.js';
import { openTimeSeries } from './timeseries.js';
import { openWizard, haveLastWizardAnswers, buildPlantFromLastAnswers } from './wizard.js';

const LIBRARIES = ['Wildflowers', 'Garden flowers', 'Garden plants', 'Bushes and shrubs', 'Grassy plants', 'New version 2 plants', 'Strange breeder plants'];
const MIN_WINDOW_WIDTH = 520, MIN_WINDOW_HEIGHT = 420;
const ZOOMS = [10, 25, 33, 50, 75, 100, 150, 200, 300, 400];
const ANIMATION_DELAY_MS = 60;
const decoder = new TextDecoder('windows-1252');

let listCursor = 0, listAnchor = 0;

const app = {
  plants: [],
  selected: new Set(),
  tdoLibrary: [],
  viewMode: 'all',
  area: 'top',
  tab: 'arrangement',
  fileName: 'untitled.pla',
  changed: false,
  animation: null,

  firstSelected() {
    return this.plants.find((plant) => this.selected.has(plant)) ?? null;
  },

  select(plant, adding) {
    if (!adding) this.selected.clear();
    if (adding && this.selected.has(plant)) this.selected.delete(plant);
    else this.selected.add(plant);
    this.selectionChanged();
  },

  clearSelection() {
    this.selected.clear();
    this.selectionChanged();
  },

  selectionChanged() {
    stopAnimation();
    const focused = this.firstSelected();
    if (focused && !this.selected.has(this.plants[listCursor])) listCursor = this.plants.indexOf(focused);
    for (const plant of this.plants) if (plant !== focused) plant.selectedPartID = -1;
    syncPlantList();
    if (this.viewMode === 'one') this.view.fit();
    this.view.requestDraw();
    this.refreshPanel();
    updateStatus();
  },

  refreshPanel() {
    renderTabs(this, this.tab);
    $('panel').replaceChildren(...TABS[this.tab].render(this, this.firstSelected()));
  },

  showTab(tab) {
    this.tab = tab;
    this.refreshPanel();
  },

  markChanged() {
    this.changed = true;
    updateTitle();
  },

  setAge(plant, age) {
    plant.setAge(age);
    this.view.requestDraw();
    updateStatus();
  },

  setParameter(plant, param, value) {
    plant.set(param, value);
    const g = plant.pGeneral;
    g.ageAtWhichFloweringStarts = Math.min(g.ageAtWhichFloweringStarts, g.ageAtMaturity);
    if (param.scurve) calcSCurveCoeffs(value);
    plant.regrow();
    this.markChanged();
    this.view.requestDraw();
    updateStatus();
  },

  addPlant(plant) {
    const widest = this.plants.reduce((x, each) => Math.max(x, each.basePoint_mm.x), 0);
    plant.basePoint_mm = { x: widest + 40, y: 100 };
    this.plants.push(plant);
    this.selected = new Set([plant]);
    this.markChanged();
    this.selectionChanged();
    this.view.fit();
  },

  // Posing only works on solids, and on the plant that has the focus.
  pickPart(hit) {
    if (this.view.drawMode !== 'solids') {
      this.view.drawMode = 'solids';
      setStatus('Posing needs solids, so Draw Using is now Solids');
    }
    this.tab = 'posing';
    if (hit && hit.plant !== this.firstSelected()) this.select(hit.plant, false);
    const plant = this.firstSelected();
    if (plant) plant.selectedPartID = hit ? hit.partID : -1;
    this.view.requestDraw();
    this.refreshPanel();
  },

  syncZoom() {
    const percent = Math.round(this.view.scale * 100);
    const zoom = $('zoom');
    let option = [...zoom.options].find((each) => each.dataset.custom);
    if (ZOOMS.includes(percent)) {
      option?.remove();
      zoom.value = String(percent);
    } else {
      if (!option) option = zoom.appendChild(el('option', { dataset: { custom: '1' } }));
      option.value = String(percent);
      option.textContent = `${percent}%`;
      zoom.value = String(percent);
    }
  },

  run(command) {
    commands[command]?.();
  },
};

function stopAnimation() {
  if (!app.animation) return;
  clearTimeout(app.animation);
  app.animation = null;
  app.refreshPanel();
}

function animate() {
  if (app.animation) {
    stopAnimation();
    return;
  }
  const plant = app.firstSelected();
  if (!plant) return;
  plant.setAge(0);
  const step = () => {
    if (plant.age >= plant.pGeneral.ageAtMaturity) {
      stopAnimation();
      return;
    }
    plant.nextDay();
    app.view.draw();
    updateStatus();
    app.animation = setTimeout(step, ANIMATION_DELAY_MS);
  };
  app.animation = setTimeout(step, 0);
  if (app.tab !== 'age') app.tab = 'age';
  app.refreshPanel();
}

function loadFile(text, name) {
  stopAnimation();
  const file = parsePlantFile(text);
  app.plants = file.plants;
  app.selected = new Set(file.plants.slice(0, 1));
  app.fileName = name;
  app.changed = false;
  app.view.fit();
  app.selectionChanged();
  updateTitle();
}

async function openLibrary(name) {
  setStatus(`Opening ${name}`);
  const response = await fetch(`data/${encodeURIComponent(name)}.pla`);
  loadFile(decoder.decode(await response.arrayBuffer()), `${name}.pla`);
}

function setStatus(text) {
  $('status').textContent = text;
}

function updateTitle() {
  document.title = `${app.fileName} - PlantStudio`;
  $('title').textContent = `PlantStudio - ${app.fileName}${app.changed ? ' (changed)' : ''}`;
  $('statusFile').textContent = app.fileName;
}

function updateStatus() {
  const plant = app.firstSelected();
  setStatus(`${app.plants.length} plants`);
  $('statusPlant').textContent = plant ? `${plant.name}: ${plant.age} days, ${plant.partsCreated} parts` : '';
}

function syncPlantList() {
  const list = $('plantList');
  const current = app.plants[listCursor];
  list.replaceChildren(...app.plants.map((plant, index) => {
    const row = el('li', { role: 'option', 'aria-selected': String(app.selected.has(plant)) }, plant.name + (plant.hidden ? ' (hidden)' : ''));
    row.dataset.index = index;
    if (plant === current) row.dataset.current = '1';
    return row;
  }));
  list.querySelector('[data-current]')?.scrollIntoView({ block: 'nearest' });
}

// Windows list behavior: a click picks one, shift picks a range from the last click,
// and control or command adds or removes one.
function clickPlantInList(index, event) {
  listCursor = index;
  if (event.shiftKey) {
    const [from, to] = [listAnchor, index].sort((a, b) => a - b);
    app.selected = new Set(app.plants.slice(from, to + 1));
    app.selectionChanged();
    return;
  }
  listAnchor = index;
  app.select(app.plants[index], event.ctrlKey || event.metaKey);
}

function moveListCursor(index, extending) {
  const next = Math.max(0, Math.min(app.plants.length - 1, index));
  if (next === listCursor && app.selected.size === 1) return;
  clickPlantInList(next, { shiftKey: extending });
}

const baseFileName = () => app.fileName.replace(/\.pla$/i, '');

const eachSelected = (change) => {
  for (const plant of app.selected) change(plant);
  app.markChanged();
  app.view.requestDraw();
  app.refreshPanel();
};

// The selected plants' edges in millimeters, for the Align commands.
function alignSelected(edge) {
  const plants = [...app.selected];
  if (plants.length < 2) return;
  const { view } = app;
  const bounds = new Map(plants.map((plant) => [plant, view.boundsOf(plant)]));
  const values = plants.map((plant) => bounds.get(plant)[edge]);
  const target = edge === 'left' || edge === 'top' ? Math.min(...values) : Math.max(...values);
  const axis = edge === 'left' || edge === 'right' ? 'x' : 'y';
  for (const plant of plants) plant.basePoint_mm[axis] += (target - bounds.get(plant)[edge]) / view.scale;
  app.markChanged();
  view.requestDraw();
  app.refreshPanel();
}

// Lays the selected plants side by side along a common ground line.
function packSelected() {
  const plants = [...app.selected];
  const { view } = app;
  let x = 0;
  const groundY = plants[0]?.basePoint_mm.y ?? 0;
  for (const plant of plants) {
    const b = view.boundsOf(plant);
    const base = view.baseFor(plant);
    plant.basePoint_mm.x = x + (base.x - b.left) / view.scale;
    plant.basePoint_mm.y = groundY;
    x += (b.right - b.left) / view.scale;
  }
  app.markChanged();
  view.fit(app.plants.filter((plant) => !plant.hidden));
  app.refreshPanel();
}

function moveInList(direction) {
  const plant = app.firstSelected();
  const index = app.plants.indexOf(plant);
  const target = index + direction;
  if (!plant || target < 0 || target >= app.plants.length) return;
  [app.plants[index], app.plants[target]] = [app.plants[target], app.plants[index]];
  syncPlantList();
  app.view.requestDraw();
}

function setHidden(plants, hidden) {
  for (const plant of plants) plant.hidden = hidden;
  syncPlantList();
  app.view.requestDraw();
}

function about() {
  const { body, close } = openDialog('About PlantStudio', { small: true });
  body.append(
    el('img', { class: 'splash', src: 'icons/splash.png', alt: 'PlantStudio splash screen' }),
    el('p', {}, 'A web port of PlantStudio Botanical Illustration Software 2.10 by Cynthia F. Kurtz and Paul D. Fernhout, Kurtz-Fernhout Software.'),
    el('p', {}, 'PlantStudio source code copyright 1993-2011 Cynthia F. Kurtz and Paul D. Fernhout. This port is free software under the GNU GPL version 3 or later, with no warranty; see COPYING. "PlantStudio" is a trademark of Cynthia F. Kurtz and Paul D. Fernhout.'),
    el('p', {}, 'Source code: ', el('a', { href: 'https://github.com/amad-a/plantstudio-web', target: '_blank', rel: 'noopener' }, 'github.com/amad-a/plantstudio-web')),
    el('p', {}, 'Undo, the plant and 3D object movers, Painter nozzles and 3D export formats other than OBJ are not ported.'),
    el('div', { class: 'dialog-buttons' }, el('button', { onclick: close }, 'OK')));
}

const commands = {
  fit: () => app.view.fit(),
  about,
  newFile() {
    stopAnimation();
    app.plants = [];
    app.selected.clear();
    app.fileName = 'untitled.pla';
    app.changed = false;
    app.selectionChanged();
    updateTitle();
  },
  openFile: () => $('fileInput').click(),
  saveAs() {
    download(app.fileName, [plantsToFile(app.plants, app.view.offset_mm, app.view.scale)], 'text/plain');
    app.changed = false;
    updateTitle();
  },
  async exportPng() {
    app.view.drawForOutput();
    download(`${baseFileName()}.png`, [await app.view.toPngBlob()], 'image/png');
    app.view.requestDraw();
  },
  exportObj() {
    const plants = app.selected.size ? app.plants.filter((plant) => app.selected.has(plant)) : app.view.visible();
    if (!plants.length) {
      setStatus('No plants to export');
      return;
    }
    const name = baseFileName();
    const { obj, mtl } = exportPlantsToObj(plants, `${name}.mtl`);
    download(`${name}.obj`, [obj], 'text/plain');
    download(`${name}.mtl`, [mtl], 'text/plain');
    setStatus(`Exported ${plants.length} plant${plants.length === 1 ? '' : 's'} as OBJ`);
  },
  async print() {
    app.view.drawForOutput();
    const picture = $('printPicture');
    picture.src = $('canvas').toDataURL('image/png');
    app.view.requestDraw();
    await picture.decode();
    window.print();
  },
  createPlant: () => openWizard(app),
  createSameAsLast() {
    if (haveLastWizardAnswers()) app.addPlant(buildPlantFromLastAnswers(`new plant ${app.plants.length + 1}`));
    else openWizard(app);
  },
  timeSeries() {
    const plant = app.firstSelected();
    if (plant) openTimeSeries(app, plant);
    else setStatus('Select a plant for a time series');
  },
  deletePlants() {
    app.plants = app.plants.filter((plant) => !app.selected.has(plant));
    app.selected.clear();
    app.markChanged();
    app.selectionChanged();
  },
  duplicate() {
    const plant = app.firstSelected();
    if (!plant) return;
    const copy = plant.copy();
    Object.assign(copy, { name: `${plant.name} copy`, xRotation: plant.xRotation, yRotation: plant.yRotation, zRotation: plant.zRotation, drawingScale_PixelsPerMm: plant.drawingScale_PixelsPerMm });
    copy.setAge(plant.age);
    app.addPlant(copy);
  },
  breed() {
    const plant = app.firstSelected();
    if (plant) openBreeder(app, plant);
    else setStatus('Select a plant to breed');
  },
  randomize: () => eachSelected((plant) => {
    const random = new Random(Date.now() % 2147483647);
    plant.pGeneral.startingSeedForRandomNumberGenerator = Math.floor(random.zeroToOne() * 32767);
    plant.xRotation = random.zeroToOne() * 360;
    plant.regrow();
  }),
  resetRotations: () => eachSelected((plant) => {
    plant.xRotation = plant.yRotation = plant.zRotation = 0;
  }),
  animate,
  async rename() {
    const plant = app.firstSelected();
    if (!plant) return;
    const name = await prompt98('Rename Plant', 'New name', plant.name);
    if (name) {
      plant.name = name;
      syncPlantList();
      app.markChanged();
      app.refreshPanel();
      updateStatus();
    }
  },
  editNote: () => app.showTab('note'),
  selectAll() {
    app.selected = new Set(app.plants);
    app.selectionChanged();
  },
  selectNone: () => app.clearSelection(),
  alignTops: () => alignSelected('top'),
  alignBottoms: () => alignSelected('bottom'),
  alignLeft: () => alignSelected('left'),
  alignRight: () => alignSelected('right'),
  equalScale() {
    const plant = app.firstSelected();
    if (plant) eachSelected((each) => { each.drawingScale_PixelsPerMm = plant.drawingScale_PixelsPerMm; });
  },
  pack: packSelected,
  bringForward: () => moveInList(1),
  sendBack: () => moveInList(-1),
  show: () => setHidden(app.selected, false),
  hide: () => setHidden(app.selected, true),
  hideOthers: () => setHidden(app.plants.filter((plant) => !app.selected.has(plant)), true),
};

const drawOption = (mode) => () => {
  app.view.drawMode = mode;
  app.view.requestDraw();
};
const posingOption = (key) => () => {
  POSING[key] = !POSING[key];
  app.view.requestDraw();
  app.refreshPanel();
};
const boxOption = (mode) => () => {
  app.view.showBoxes = app.view.showBoxes === mode ? 'none' : mode;
  app.view.requestDraw();
};

function setViewMode(mode) {
  app.viewMode = mode;
  app.view.fit();
  syncToolbar();
}

function setArea(area) {
  app.area = area;
  $('workspace').className = `workspace area-${area}`;
  syncToolbar();
}

function setTool(tool) {
  app.view.tool = tool;
  $('canvas').dataset.tool = tool;
  syncToolbar();
}

function syncToolbar() {
  document.querySelectorAll('[data-tool]').forEach((node) => { if (node.tagName === 'BUTTON') node.classList.toggle('pressed', node.dataset.tool === app.view.tool); });
  document.querySelectorAll('[data-view]').forEach((node) => node.classList.toggle('pressed', node.dataset.view === app.viewMode));
  document.querySelectorAll('[data-area]').forEach((node) => node.classList.toggle('pressed', node.dataset.area === app.area));
}

const SEPARATOR = null;
const menu = (label, ...items) => ({ label, items });
const item = (label, action, checked) => ({ label, action, checked });

const MENUS = [
  menu('File',
    item('New', () => commands.newFile()),
    menu('Open Library', ...LIBRARIES.map((name) => item(name, () => openLibrary(name)))),
    item('Open...', () => commands.openFile()),
    SEPARATOR,
    item('Save As...', () => commands.saveAs()),
    menu('Export',
      item('OBJ...', () => commands.exportObj()),
      item('Bitmap (PNG)...', () => commands.exportPng())),
    SEPARATOR,
    item('Print Picture...', () => commands.print())),
  menu('Edit',
    item('Delete', () => commands.deletePlants()),
    item('Duplicate', () => commands.duplicate())),
  menu('Plant',
    item('Create New...', () => commands.createPlant()),
    item('Create Same as Last', () => commands.createSameAsLast()),
    SEPARATOR,
    item('Breed', () => commands.breed()),
    item('Make Time Series', () => commands.timeSeries()),
    SEPARATOR,
    item('Randomize', () => commands.randomize()),
    item('Reset Rotations', () => commands.resetRotations()),
    item('Animate through Life Cycle', () => commands.animate()),
    SEPARATOR,
    item('Rename...', () => commands.rename()),
    item('Edit Note...', () => commands.editNote())),
  menu('Layout',
    item('Select All', () => commands.selectAll()),
    item('Select None', () => commands.selectNone()),
    SEPARATOR,
    item('Scale to Fit', () => commands.fit()),
    menu('Align',
      item('Tops', () => commands.alignTops()),
      item('Bottoms', () => commands.alignBottoms()),
      item('Left Sides', () => commands.alignLeft()),
      item('Right Sides', () => commands.alignRight())),
    menu('Size', item('Equal', () => commands.equalScale())),
    item('Pack', () => commands.pack()),
    SEPARATOR,
    item('Bring Forward', () => commands.bringForward()),
    item('Send Back', () => commands.sendBack()),
    SEPARATOR,
    item('Show', () => commands.show()),
    item('Hide', () => commands.hide()),
    item('Hide Others', () => commands.hideOthers())),
  menu('Options',
    menu('Draw Using',
      item('Bounding Boxes', drawOption('boxes'), () => app.view.drawMode === 'boxes'),
      item('Wire Frames', drawOption('frames'), () => app.view.drawMode === 'frames'),
      item('Solids', drawOption('solids'), () => app.view.drawMode === 'solids')),
    menu('View What Plants',
      item('All Plants', () => setViewMode('all'), () => app.viewMode === 'all'),
      item('One Plant at a Time', () => setViewMode('one'), () => app.viewMode === 'one')),
    menu('Place Drawing Area',
      item('On Top', () => setArea('top'), () => app.area === 'top'),
      item('On Side', () => setArea('side'), () => app.area === 'side')),
    menu('Draw Rectangles',
      item('Around Selected Plants', boxOption('selected'), () => app.view.showBoxes === 'selected'),
      item('Around All Plants', boxOption('all'), () => app.view.showBoxes === 'all')),
    menu('Posing',
      item('Highlight Posed Parts', posingOption('showHighlightingForNonHiddenPosedParts'), () => POSING.showHighlightingForNonHiddenPosedParts),
      item('Ghost Hidden Parts', posingOption('showGhostingForHiddenParts'), () => POSING.showGhostingForHiddenParts),
      item('Ignore All Posing', posingOption('showPosingAtAll'), () => !POSING.showPosingAtAll))),
  menu('Window',
    item('Breeder', () => commands.breed()),
    item('Time Series', () => commands.timeSeries())),
  menu('Help', item('About PlantStudio', () => commands.about())),
];

function closeMenus() {
  document.querySelectorAll('.menubar .open').forEach((node) => node.classList.remove('open'));
}

function menuList(items) {
  return el('ul', { class: 'menu-items', role: 'menu' }, ...items.map((entry) => {
    if (entry === SEPARATOR) return el('li', { class: 'separator', role: 'separator' });
    if (entry.items) {
      const button = el('button', { class: 'parent', role: 'menuitem', 'aria-haspopup': 'true' }, entry.label);
      const row = el('li', {}, button, menuList(entry.items));
      const open = () => {
        row.parentElement.querySelectorAll(':scope > li.open').forEach((node) => node !== row && node.classList.remove('open'));
        row.classList.add('open');
      };
      button.addEventListener('mouseenter', open);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        open();
      });
      return row;
    }
    const button = el('button', {
      role: 'menuitem',
      onclick: (event) => {
        event.stopPropagation();
        closeMenus();
        entry.action();
      },
    }, entry.label);
    button.dataset.check = entry.checked ? '1' : '';
    button.check = entry.checked;
    return el('li', {}, button);
  }));
}

function buildMenus() {
  const bar = $('menubar');
  for (const entry of MENUS) {
    const button = el('button', {}, entry.label);
    const top = el('div', { class: 'menu' }, button, menuList(entry.items));
    const open = () => {
      closeMenus();
      top.classList.add('open');
      top.querySelectorAll('button[data-check="1"]').forEach((node) => node.classList.toggle('checked', node.check()));
    };
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (top.classList.contains('open')) closeMenus();
      else open();
    });
    button.addEventListener('mouseenter', () => {
      if (bar.querySelector('.menu.open')) open();
    });
    bar.append(top);
  }
  document.addEventListener('click', closeMenus);
}

function wireControls() {
  document.querySelectorAll('[data-command]').forEach((node) => node.addEventListener('click', () => app.run(node.dataset.command)));
  document.querySelectorAll('button[data-tool]').forEach((node) => node.addEventListener('click', () => setTool(node.dataset.tool)));
  document.querySelectorAll('[data-view]').forEach((node) => node.addEventListener('click', () => setViewMode(node.dataset.view)));
  document.querySelectorAll('[data-area]').forEach((node) => node.addEventListener('click', () => setArea(node.dataset.area)));

  const zoom = $('zoom');
  zoom.append(...ZOOMS.map((percent) => el('option', { value: percent }, `${percent}%`)));
  zoom.addEventListener('change', () => app.view.zoomTo(Number(zoom.value) / 100));

  const list = $('plantList');
  list.addEventListener('click', (event) => {
    const row = event.target.closest('li');
    if (row) clickPlantInList(Number(row.dataset.index), event);
  });
  list.addEventListener('keydown', (event) => {
    const move = { ArrowUp: listCursor - 1, ArrowDown: listCursor + 1, Home: 0, End: app.plants.length - 1 }[event.key];
    if (move === undefined) return;
    event.preventDefault();
    moveListCursor(move, event.shiftKey);
  });

  $('fileInput').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (file) loadFile(decoder.decode(await file.arrayBuffer()), file.name);
    event.target.value = '';
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select')) return;
    if (event.key === ' ' && app.animation) {
      event.preventDefault();
      stopAnimation();
    } else if (event.key === 'Delete') {
      commands.deletePlants();
    }
  });
}

async function start() {
  app.view = new View($('canvas'), app);
  app.view.onResized = () => app.view.fit();
  buildMenus();
  wireControls();
  makeDraggable($('appWindow'), $('appTitleBar'));
  makeResizable($('appWindow'), $('resizeGrip'), MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
  window.addEventListener('resize', () => keepOnScreen($('appWindow')));
  setTool('drag');
  syncToolbar();
  app.refreshPanel();
  const tdoText = await (await fetch(`data/${encodeURIComponent('3D object library')}.tdo`)).arrayBuffer();
  app.tdoLibrary = parseTdoLibrary(decoder.decode(tdoText));
  await openLibrary(LIBRARIES[0]);
}

start().catch((error) => setStatus(`Could not start: ${error.message}`));
window.plantStudio = app;
