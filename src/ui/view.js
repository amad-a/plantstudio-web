// The main drawing: plants on one raster at a shared scale and offset, plus the
// drag, scroll, rotate and magnify tools from the toolbar.

import { Raster, RasterSurface } from '../model/surface.js';
import { Turtle, DRAW_MODES } from '../model/turtle.js';
import { POSING } from '../model/parts.js';
import { round, rgb } from '../model/support.js';

const WHITE = rgb(255, 255, 255);
const SELECTED = rgb(255, 0, 0);
const UNSELECTED = rgb(192, 192, 192);
const MIN_SCALE = 0.02, MAX_SCALE = 20;
const WHEEL_DEGREES_PER_PIXEL = 0.25, WHEEL_PIXELS_PER_LINE = 16;
const PINCH_ZOOM_PER_PIXEL = 0.01;

const pinchDistance = (pointers) => {
  const [first, second] = pointers.values();
  return Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY));
};

export class View {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.context = canvas.getContext('2d');
    this.scale = 1;
    this.offset_mm = { x: 0, y: 0 };
    this.drawMode = 'solids';
    this.showBoxes = 'selected';
    this.tool = 'drag';
    this.frame = 0;
    this.resize();
    new ResizeObserver(() => {
      if (this.resize()) this.onResized?.();
    }).observe(canvas);
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    canvas.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    canvas.addEventListener('gesturestart', (event) => this.gestureStart(event));
    canvas.addEventListener('gesturechange', (event) => this.gestureChange(event));
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    if (this.raster && this.raster.width === width && this.raster.height === height) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    this.raster = new Raster(width, height);
    this.surface = new RasterSurface(this.raster);
    this.turtle = new Turtle(this.surface);
    this.imageData = new ImageData(new Uint8ClampedArray(this.raster.pixels.buffer), width, height);
    this.requestDraw();
    return true;
  }

  // Plants that are on show, with their index in the list kept for hit testing.
  visible() {
    const { plants, viewMode } = this.app;
    if (viewMode === 'one') {
      const plant = this.app.firstSelected();
      return plant ? [plant] : [];
    }
    return plants.filter((plant) => !plant.hidden);
  }

  baseFor(plant) {
    return {
      x: round((plant.basePoint_mm.x + this.offset_mm.x) * this.scale),
      y: round((plant.basePoint_mm.y + this.offset_mm.y) * this.scale),
    };
  }

  plantScale(plant) {
    return plant.drawingScale_PixelsPerMm * this.scale;
  }

  boundsOf(plant) {
    const { x, y } = this.baseFor(plant);
    return plant.measure(this.plantScale(plant), x, y);
  }

  requestDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  draw() {
    const { raster, turtle } = this;
    raster.clear(WHITE);
    const options = DRAW_MODES[this.drawMode];
    for (const plant of this.visible()) {
      raster.owner = this.app.plants.indexOf(plant) + 1;
      const { x, y } = this.baseFor(plant);
      plant.drawOn(turtle, options, this.plantScale(plant), x, y);
    }
    raster.owner = 0;
    raster.part = 0;
    if (this.app.viewMode === 'all' && !POSING.drawingForOutput) this.drawBoxes();
    this.context.putImageData(this.imageData, 0, 0);
  }

  // Leaves the picture on the canvas with no selection boxes or posing colors.
  drawForOutput() {
    POSING.drawingForOutput = true;
    try {
      this.draw();
    } finally {
      POSING.drawingForOutput = false;
    }
  }

  drawBoxes() {
    if (this.showBoxes === 'none') return;
    for (const plant of this.visible()) {
      const selected = this.app.selected.has(plant);
      if (!selected && this.showBoxes !== 'all') continue;
      const { left, top, right, bottom } = this.boundsOf(plant);
      const color = selected ? SELECTED : UNSELECTED;
      this.raster.line(left, top, right, top, color);
      this.raster.line(right, top, right, bottom, color);
      this.raster.line(right, bottom, left, bottom, color);
      this.raster.line(left, bottom, left, top, color);
    }
  }

  // Zooms and centers on the given plants, like the Scale to Fit button.
  fit(plants = this.visible()) {
    if (!plants.length) return;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const plant of plants) {
      const b = plant.measure(plant.drawingScale_PixelsPerMm, plant.basePoint_mm.x, plant.basePoint_mm.y);
      left = Math.min(left, b.left);
      top = Math.min(top, b.top);
      right = Math.max(right, b.right);
      bottom = Math.max(bottom, b.bottom);
    }
    const width = Math.max(1, right - left), height = Math.max(1, bottom - top);
    const { width: canvasWidth, height: canvasHeight } = this.raster;
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(canvasWidth / width, canvasHeight / height) * 0.94));
    this.offset_mm.x = (canvasWidth / this.scale - width) / 2 - left;
    this.offset_mm.y = (canvasHeight / this.scale - height) / 2 - top;
    this.requestDraw();
    this.app.syncZoom();
  }

  // Keeps the point under (x, y) still while the scale changes.
  zoomTo(scale, x = this.raster.width / 2, y = this.raster.height / 2) {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    this.offset_mm.x += x / next - x / this.scale;
    this.offset_mm.y += y / next - y / this.scale;
    this.scale = next;
    this.requestDraw();
    this.app.syncZoom();
  }

  // What's drawn at or just beside a pixel, so thin stems can be clicked.
  hitAt(x, y) {
    const { owners, parts, width, height } = this.raster;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 2], [-2, 2], [2, -2], [-2, -2]]) {
      const px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const index = py * width + px;
      if (owners[index]) return { plant: this.app.plants[owners[index] - 1], partID: parts[index] };
    }
    return null;
  }

  plantAt(x, y) {
    return this.hitAt(x, y)?.plant ?? null;
  }

  pointerDown(event) {
    const { canvas, app } = this;
    const { x, y } = this.canvasPoint(event);
    if (this.tool === 'magnify') {
      this.magnifyPointerDown(event);
      return;
    }
    if (this.tool === 'pose') {
      app.pickPart(this.hitAt(x, y));
      return;
    }
    // With one plant on show there's nothing else to pick, so a miss keeps it.
    const onePlant = app.viewMode === 'one';
    if (this.tool !== 'scroll' && !(onePlant && this.tool === 'rotate')) {
      const plant = this.plantAt(x, y);
      if (plant && (event.shiftKey || !app.selected.has(plant))) app.select(plant, event.shiftKey);
      else if (!plant && !event.shiftKey && !onePlant) app.clearSelection();
    }
    canvas.setPointerCapture(event.pointerId);
    let lastX = event.clientX, lastY = event.clientY;
    const move = (moved) => {
      const dx = moved.clientX - lastX, dy = moved.clientY - lastY;
      lastX = moved.clientX;
      lastY = moved.clientY;
      if (this.tool === 'scroll') {
        this.offset_mm.x += dx / this.scale;
        this.offset_mm.y += dy / this.scale;
      } else if (this.tool === 'rotate') {
        this.rotateSelected(dx, dy);
      } else {
        for (const plant of app.selected) {
          plant.basePoint_mm.x += dx / this.scale;
          plant.basePoint_mm.y += dy / this.scale;
        }
        app.refreshPanel();
      }
      this.requestDraw();
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  canvasPoint({ clientX, clientY }) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: Math.floor(clientX - rect.left), y: Math.floor(clientY - rect.top) };
  }

  // A press zooms when it's released, so the first finger of a pinch doesn't zoom too.
  magnifyPointerDown(event) {
    const { canvas } = this;
    const pointers = this.pinchPointers ??= new Map();
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, event);
    if (pointers.size === 2) {
      this.pinch = { distance: pinchDistance(pointers), scale: this.scale };
    }
    if (pointers.size > 1) return;
    const { shiftKey } = event;
    let wasPinch = false;
    const move = (moved) => {
      if (!pointers.has(moved.pointerId)) return;
      pointers.set(moved.pointerId, moved);
      if (pointers.size !== 2) return;
      wasPinch = true;
      const [first, second] = pointers.values();
      const middle = this.canvasPoint({ clientX: (first.clientX + second.clientX) / 2, clientY: (first.clientY + second.clientY) / 2 });
      this.zoomTo((this.pinch.scale * pinchDistance(pointers)) / this.pinch.distance, middle.x, middle.y);
    };
    const end = (ended) => {
      pointers.delete(ended.pointerId);
      if (pointers.size) return;
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      if (wasPinch || ended.type === 'pointercancel') return;
      const { x, y } = this.canvasPoint(ended);
      this.zoomTo(this.scale * (shiftKey ? 0.5 : 2), x, y);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // Safari reports trackpad pinches with its own events.
  gestureStart(event) {
    if (this.tool !== 'magnify') return;
    event.preventDefault();
    this.gestureScale = this.scale;
  }

  gestureChange(event) {
    if (this.tool !== 'magnify') return;
    event.preventDefault();
    const { x, y } = this.canvasPoint(event);
    this.zoomTo(this.gestureScale * event.scale, x, y);
  }

  rotateSelected(dx, dy) {
    for (const plant of this.app.selected) {
      plant.xRotation = (plant.xRotation + dx + 360) % 360;
      plant.yRotation = (plant.yRotation + dy + 360) % 360;
    }
    this.app.refreshPanel();
    this.requestDraw();
  }

  // Scrolling turns the plant, sideways for spin and up and down for tilt, same as dragging.
  wheel(event) {
    // Browsers report a trackpad pinch as a wheel event with the control key down.
    if (this.tool === 'magnify' && event.ctrlKey) {
      event.preventDefault();
      const { x, y } = this.canvasPoint(event);
      this.zoomTo(this.scale * Math.exp(-event.deltaY * PINCH_ZOOM_PER_PIXEL), x, y);
      return;
    }
    if (this.tool !== 'rotate' || this.app.viewMode !== 'one') return;
    event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_PIXELS_PER_LINE : 1;
    const degrees = unit * WHEEL_DEGREES_PER_PIXEL;
    this.rotateSelected(event.deltaX * degrees, event.deltaY * degrees);
  }

  toPngBlob() {
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }
}
