// The 3D Object Editor, from Utdoedit.pas. The left pane edits, and the right pane shows
// the object repeated around a stem. As in the original, points move in the object's own
// x and y whatever the rotation, and adding a point puts it at z 0.

import { Raster, RasterSurface } from '../model/surface.js';
import { Turtle, DRAW_MODES } from '../model/turtle.js';
import { rgb, round } from '../model/support.js';
import { el, openDialog, prompt98 } from './dom.js';

const PANE_SIZE = 340;
const WHITE = rgb(255, 255, 255), BLACK = rgb(0, 0, 0);
const FACE = rgb(192, 192, 192), BACK = rgb(128, 128, 128);
const CONNECTED = rgb(0, 0, 255), UNCONNECTED = rgb(0, 128, 0), ORIGIN = BLACK, LIT = rgb(255, 0, 0);
const MIRROR_COLOR = rgb(255, 255, 200);
const DEGREES_PER_PIXEL = 0.5;
const FIT_MARGIN = 0.8;
const ZOOM_IN = 1.5, ZOOM_OUT = 0.75;
const MAX_UNDO = 50;
const TOOLS = [
  ['drag', 'TdoEditorForm_dragCursorMode', 'Drag points; hold shift to move them in depth'],
  ['add', 'TdoEditorForm_addTrianglePointsCursorMode', 'Add triangles: click three points'],
  ['remove', 'TdoEditorForm_removeTriangleCursorMode', 'Remove triangles'],
  ['flip', 'TdoEditorForm_flipTriangleCursorMode', 'Flip triangles front to back'],
  ['rotate', 'TdoEditorForm_rotateCursorMode', 'Rotate the view; hold shift for the third axis'],
  ['scroll', 'TdoEditorForm_scrollCursorMode', 'Scroll the view'],
  ['magnify', 'TdoEditorForm_magnifyCursorMode', 'Magnify: click to zoom in, shift-click to zoom out'],
];

function makePane(canvas) {
  const raster = new Raster(PANE_SIZE, PANE_SIZE);
  return {
    canvas, raster, turtle: new Turtle(new RasterSurface(raster)),
    context: canvas.getContext('2d'),
    imageData: new ImageData(new Uint8ClampedArray(raster.pixels.buffer), PANE_SIZE, PANE_SIZE),
    scale: 1, x: 0, y: 0, xRotation: 0, yRotation: 0, zRotation: 0,
  };
}

function pointInTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const side = (px, py, qx, qy) => (qx - px) * (y - py) - (qy - py) * (x - px);
  const first = side(ax, ay, bx, by), second = side(bx, by, cx, cy), third = side(cx, cy, ax, ay);
  return (first >= 0 && second >= 0 && third >= 0) || (first <= 0 && second <= 0 && third <= 0);
}

export function openTdoEditor(original, onApply) {
  let tdo = original.copy();
  let tool = 'drag';
  let editPoints = [];
  let pendingPoints = [];
  let litPoint = -1;
  const undoStack = [], redoStack = [];
  const settings = { parts: 5, pointRadius: 4, fill: true, lines: true, mirror: false };
  const editCanvas = el('canvas', { class: 'tdo-pane', width: PANE_SIZE, height: PANE_SIZE, 'aria-label': 'Edit view' });
  const viewCanvas = el('canvas', { class: 'tdo-pane', width: PANE_SIZE, height: PANE_SIZE, 'aria-label': 'Repeated view' });
  const edit = makePane(editCanvas), view = makePane(viewCanvas);
  const status = el('span', { id: 'tdoStatus' });
  const undoButton = el('button', { onclick: undo }, 'Undo last');
  const redoButton = el('button', { onclick: redo }, 'Redo last');
  const connection = el('input', { id: 'tdoConnection', type: 'number', min: 1, onchange: () => {
    const index = Math.round(Number(connection.value)) - 1;
    if (index < 0 || index >= tdo.points.length) return;
    change(() => tdo.setOriginPointIndex(index));
  } });

  function fit(pane) {
    const xs = tdo.points.map((point) => point[0]), ys = tdo.points.map((point) => point[1]);
    if (!xs.length) {
      Object.assign(pane, { scale: 1, x: PANE_SIZE / 2, y: PANE_SIZE / 2 });
      return;
    }
    const left = Math.min(...xs), top = Math.min(...ys);
    const width = Math.max(1, Math.max(...xs) - left), height = Math.max(1, Math.max(...ys) - top);
    pane.scale = (PANE_SIZE / Math.max(width, height)) * FIT_MARGIN;
    pane.x = (PANE_SIZE - width * pane.scale) / 2 - left * pane.scale;
    pane.y = (PANE_SIZE - height * pane.scale) / 2 - top * pane.scale;
  }

  function drawPane(pane) {
    const { raster, turtle } = pane;
    const isEdit = pane === edit;
    raster.clear(WHITE);
    const options = { ...DRAW_MODES.tdoEditor, wireFrame: !settings.fill, drawLines: settings.lines, lineContrastIndex: settings.lines ? 10 : 0 };
    turtle.reset(options, 1, pane.x, pane.y);
    turtle.rotateX((pane.yRotation * 256) / 360);
    turtle.rotateY((pane.xRotation * 256) / 360);
    turtle.rotateZ((pane.zRotation * 256) / 360);
    turtle.setForeColorBackColor(FACE, BACK);
    turtle.setLineColor(BLACK);
    const parts = isEdit ? 1 : settings.parts;
    if (parts > 1) turtle.rotateZ(-64);
    for (let i = 0; i < parts; i++) {
      if (parts > 1) {
        turtle.rotateX(Math.trunc(256 / parts));
        turtle.push();
        turtle.rotateY(64);
        turtle.rotateX(64);
      }
      tdo.draw(turtle, pane.scale, 0);
      if (settings.mirror && !isEdit) {
        turtle.push();
        turtle.rotateY(128);
        tdo.reverseZValues();
        turtle.setForeColorBackColor(MIRROR_COLOR, MIRROR_COLOR);
        tdo.draw(turtle, pane.scale, 0);
        turtle.setForeColorBackColor(FACE, BACK);
        tdo.reverseZValues();
        turtle.pop();
      }
      if (parts > 1) turtle.pop();
    }
    if (isEdit) editPoints = turtle.recordedPoints.map(([x, y]) => [round(x), round(y)]);
    turtle.surface.finish();
    if (isEdit) drawPoints();
    pane.context.putImageData(pane.imageData, 0, 0);
  }

  function dot(x, y, color) {
    edit.raster.line(x, y, x, y, color, settings.pointRadius * 2);
  }

  function drawPoints() {
    editPoints.forEach(([x, y], index) => dot(x, y, index === litPoint ? LIT : index === tdo.originPointIndex ? ORIGIN : CONNECTED));
    for (const point of pendingPoints) dot(round(edit.x + point[0] * edit.scale), round(edit.y + point[1] * edit.scale), UNCONNECTED);
  }

  function redraw() {
    drawPane(edit);
    drawPane(view);
    connection.max = tdo.points.length;
    connection.value = tdo.points.length ? tdo.originPointIndex + 1 : 0;
    undoButton.disabled = !undoStack.length;
    redoButton.disabled = !redoStack.length;
    status.textContent = `${tdo.name}: ${tdo.points.length} points, ${tdo.triangles.length} triangles`;
  }

  function remember() {
    undoStack.push(tdo.copy());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  }

  function change(action) {
    remember();
    action();
    redraw();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(tdo);
    tdo = undoStack.pop();
    redraw();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(tdo);
    tdo = redoStack.pop();
    redraw();
  }

  const pointIndexAt = (x, y) => editPoints.findIndex(([px, py]) => Math.abs(px - x) <= settings.pointRadius + 1 && Math.abs(py - y) <= settings.pointRadius + 1);

  function triangleAt(x, y) {
    return [...tdo.triangles].reverse().find(([a, b, c]) => pointInTriangle(x, y, editPoints[a - 1], editPoints[b - 1], editPoints[c - 1]));
  }

  function addTrianglePoint(x, y) {
    const index = pointIndexAt(x, y);
    pendingPoints.push(index >= 0 ? [...tdo.points[index]] : [(x - edit.x) / edit.scale, (y - edit.y) / edit.scale, 0]);
    pendingPoints[pendingPoints.length - 1].index = index;
    if (pendingPoints.length < 3) {
      drawPane(edit);
      return;
    }
    const corners = pendingPoints;
    pendingPoints = [];
    change(() => {
      tdo.triangles.push(corners.map((point) => {
        if (point.index >= 0) return point.index + 1;
        tdo.points.push([point[0], point[1], point[2]]);
        return tdo.points.length;
      }));
    });
  }

  function dragPoint(event, index) {
    remember();
    const old = [...tdo.points[index]];
    const startX = event.clientX, startY = event.clientY;
    litPoint = index;
    track(event, (moved) => {
      const dx = moved.clientX - startX, dy = moved.clientY - startY;
      if (event.shiftKey) tdo.points[index] = [old[0], old[1], old[2] - dy / edit.scale];
      else tdo.points[index] = [old[0] + dx / edit.scale, old[1] + dy / edit.scale, old[2]];
      redraw();
    }, () => {
      litPoint = -1;
      redraw();
    });
  }

  function track(event, onMove, onDone) {
    const canvas = event.currentTarget;
    canvas.setPointerCapture(event.pointerId);
    const stop = () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', stop);
      canvas.removeEventListener('pointercancel', stop);
      onDone?.();
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  function pointerDown(event, pane) {
    const rect = pane.canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * PANE_SIZE);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * PANE_SIZE);
    const isEdit = pane === edit;
    if (tool === 'magnify') {
      const factor = event.shiftKey ? ZOOM_OUT : ZOOM_IN;
      pane.x = x - (x - pane.x) * factor;
      pane.y = y - (y - pane.y) * factor;
      pane.scale *= factor;
      drawPane(pane);
    } else if (tool === 'scroll') {
      let lastX = event.clientX, lastY = event.clientY;
      track(event, (moved) => {
        pane.x += moved.clientX - lastX;
        pane.y += moved.clientY - lastY;
        lastX = moved.clientX;
        lastY = moved.clientY;
        drawPane(pane);
      });
    } else if (tool === 'rotate') {
      let lastX = event.clientX, lastY = event.clientY;
      track(event, (moved) => {
        if (event.shiftKey) pane.zRotation += (lastX - moved.clientX) * DEGREES_PER_PIXEL;
        else {
          pane.xRotation += (moved.clientX - lastX) * DEGREES_PER_PIXEL;
          pane.yRotation += (moved.clientY - lastY) * DEGREES_PER_PIXEL;
        }
        lastX = moved.clientX;
        lastY = moved.clientY;
        drawPane(pane);
      });
    } else if (!isEdit) {
      return;
    } else if (tool === 'drag') {
      const index = pointIndexAt(x, y);
      if (index >= 0) dragPoint(event, index);
    } else if (tool === 'add') {
      addTrianglePoint(x, y);
    } else {
      const triangle = triangleAt(x, y);
      if (!triangle) return;
      if (tool === 'remove') change(() => tdo.removeTriangle(tdo.triangles.find((t) => t === triangle)));
      else change(() => triangle.reverse());
    }
  }

  editCanvas.addEventListener('pointerdown', (event) => pointerDown(event, edit));
  viewCanvas.addEventListener('pointerdown', (event) => pointerDown(event, view));

  const toolButtons = TOOLS.map(([key, icon, title]) => el('button', {
    class: `tool${key === tool ? ' pressed' : ''}`, title, dataset: { editorTool: key },
    onclick: () => {
      tool = key;
      pendingPoints = [];
      toolButtons.forEach((button) => button.classList.toggle('pressed', button.dataset.editorTool === key));
      drawPane(edit);
    },
  }, el('img', { src: `icons/${icon}.png`, alt: title })));

  const check = (id, label, key) => [
    el('input', { id, type: 'checkbox', checked: settings[key], onchange: (event) => { settings[key] = event.target.checked; redraw(); } }),
    el('label', { for: id }, label),
  ];
  const number = (id, label, key, min, max) => [
    el('label', { for: id }, label),
    el('input', { id, type: 'number', min, max, value: settings[key], onchange: (event) => {
      settings[key] = Math.max(min, Math.min(max, Math.round(Number(event.target.value)) || min));
      event.target.value = settings[key];
      redraw();
    } }),
  ];
  const fitBoth = () => {
    fit(edit);
    fit(view);
    redraw();
  };
  const resetRotations = () => {
    for (const pane of [edit, view]) Object.assign(pane, { xRotation: 0, yRotation: 0, zRotation: 0 });
    redraw();
  };
  const rename = async () => {
    const name = await prompt98('Rename 3D Object', 'New name', tdo.name);
    if (name) change(() => { tdo.name = name; });
  };

  const { body, close } = openDialog('3D Object Editor');
  const apply = () => onApply(tdo.copy());
  body.append(
    el('div', { class: 'row' }, ...toolButtons, el('span', { class: 'divider' }), undoButton, redoButton),
    el('div', { class: 'tdo-panes' }, editCanvas, viewCanvas),
    el('div', { class: 'row spacer-top' },
      el('button', { onclick: () => change(() => tdo.makeMirrorTriangles()) }, 'Mirror'),
      el('button', { onclick: () => change(() => tdo.reverseZValues()) }, 'Reverse'),
      el('button', { onclick: fitBoth }, 'Scale to Fit'),
      el('button', { onclick: resetRotations }, 'Reset rotations')),
    el('div', { class: 'row' },
      ...number('tdoParts', 'Parts (1-30)', 'parts', 1, 30),
      ...number('tdoPointSize', 'Point size (1-30)', 'pointRadius', 1, 30),
      el('label', { for: 'tdoConnection' }, 'Connection point'), connection),
    el('div', { class: 'row' },
      ...check('tdoFill', 'Fill triangles', 'fill'),
      ...check('tdoLines', 'Draw lines', 'lines'),
      ...check('tdoMirror', 'Show mirror image', 'mirror')),
    el('div', { class: 'row' }, status),
    el('div', { class: 'dialog-buttons' },
      el('button', { onclick: rename }, 'Rename'),
      el('button', { onclick: () => change(() => { tdo.points = []; tdo.triangles = []; tdo.originPointIndex = 0; }) }, 'Clear points'),
      el('button', { onclick: apply }, 'Apply'),
      el('button', { onclick: () => { apply(); close(); } }, 'OK'),
      el('button', { onclick: () => close() }, 'Cancel')));
  fitBoth();
}
