// The 3D turtle: uturtle.pas and KfMatrix from u3dsupport.pas.
// Angles are 0-255 for a full turn. 64 is a right angle.

import { round } from './support.js';

const TRIG_SIZE = 256;
const SIN = new Float64Array(TRIG_SIZE);
const COS = new Float64Array(TRIG_SIZE);
for (let i = 0; i < TRIG_SIZE; i++) {
  SIN[i] = Math.sin((i * 2 * 3.141592654) / TRIG_SIZE);
  COS[i] = Math.cos((i * 2 * 3.141592654) / TRIG_SIZE);
}

function angleIndex(angle) {
  const index = round(angle) % TRIG_SIZE;
  return index < 0 ? index + TRIG_SIZE : index;
}

class Matrix {
  a0 = 1; a1 = 0; a2 = 0;
  b0 = 0; b1 = 1; b2 = 0;
  c0 = 0; c1 = 0; c2 = 1;
  x = 0; y = 0; z = 0;

  reset() {
    this.a0 = 1; this.a1 = 0; this.a2 = 0;
    this.b0 = 0; this.b1 = 1; this.b2 = 0;
    this.c0 = 0; this.c1 = 0; this.c2 = 1;
    this.x = 0; this.y = 0; this.z = 0;
  }

  copyTo(other) {
    other.a0 = this.a0; other.a1 = this.a1; other.a2 = this.a2;
    other.b0 = this.b0; other.b1 = this.b1; other.b2 = this.b2;
    other.c0 = this.c0; other.c1 = this.c1; other.c2 = this.c2;
    other.x = this.x; other.y = this.y; other.z = this.z;
  }

  move(distance) {
    this.x += distance * this.a0;
    this.y += distance * this.b0;
    this.z += distance * this.c0;
  }

  transform(x, y, z) {
    return [
      x * this.a0 + y * this.a1 + z * this.a2 + this.x,
      x * this.b0 + y * this.b1 + z * this.b2 + this.y,
      x * this.c0 + y * this.c1 + z * this.c2 + this.z,
    ];
  }

  rotateX(angle) {
    const i = angleIndex(angle), c = COS[i], s = SIN[i];
    let t = this.a1 * c - this.a2 * s;
    this.a2 = this.a1 * s + this.a2 * c;
    this.a1 = t;
    t = this.b1 * c - this.b2 * s;
    this.b2 = this.b1 * s + this.b2 * c;
    this.b1 = t;
    t = this.c1 * c - this.c2 * s;
    this.c2 = this.c1 * s + this.c2 * c;
    this.c1 = t;
  }

  rotateY(angle) {
    const i = angleIndex(angle), c = COS[i], s = SIN[i];
    let t = this.a0 * c + this.a2 * s;
    this.a2 = this.a2 * c - this.a0 * s;
    this.a0 = t;
    t = this.b0 * c + this.b2 * s;
    this.b2 = this.b2 * c - this.b0 * s;
    this.b0 = t;
    t = this.c0 * c + this.c2 * s;
    this.c2 = this.c2 * c - this.c0 * s;
    this.c0 = t;
  }

  rotateZ(angle) {
    const i = angleIndex(angle), c = COS[i], s = SIN[i];
    let t = this.a0 * c - this.a1 * s;
    this.a1 = this.a0 * s + this.a1 * c;
    this.a0 = t;
    t = this.b0 * c - this.b1 * s;
    this.b1 = this.b0 * s + this.b1 * c;
    this.b0 = t;
    t = this.c0 * c - this.c1 * s;
    this.c1 = this.c0 * s + this.c1 * c;
    this.c0 = t;
  }
}

export const DRAW_MODES = {
  boxes: { draw3DObjects: true, draw3DObjectsAsRects: true, drawStems: true, wireFrame: true, drawLines: true, sortPolygons: false, sortTdosAsOneItem: false, lineContrastIndex: 0 },
  frames: { draw3DObjects: true, draw3DObjectsAsRects: false, drawStems: true, wireFrame: true, drawLines: true, sortPolygons: false, sortTdosAsOneItem: false, lineContrastIndex: 0 },
  solids: { draw3DObjects: true, draw3DObjectsAsRects: false, drawStems: true, wireFrame: false, drawLines: true, sortPolygons: true, sortTdosAsOneItem: true, lineContrastIndex: 3 },
  // What the 3D object editor uses.
  tdoEditor: { draw3DObjects: true, draw3DObjectsAsRects: false, drawStems: true, wireFrame: false, drawLines: true, sortPolygons: true, sortTdosAsOneItem: false, lineContrastIndex: 10 },
  // Writes geometry to an export surface instead of drawing it.
  export: { draw3DObjects: true, draw3DObjectsAsRects: false, drawStems: true, wireFrame: false, drawLines: false, sortPolygons: false, sortTdosAsOneItem: false, lineContrastIndex: 0, exporting: true },
  // A pass that only moves, used to measure a plant.
  bounds: { draw3DObjects: false, draw3DObjectsAsRects: false, drawStems: false, wireFrame: true, drawLines: false, sortPolygons: false, sortTdosAsOneItem: false, lineContrastIndex: 0 },
};

export class Turtle {
  constructor(surface) {
    this.surface = surface;
    this.options = DRAW_MODES.solids;
    this.stack = [new Matrix()];
    this.depth = 1;
    this.matrix = this.stack[0];
    this.scale = 1;
    this.recordedPoints = [];
    this.bounds = { left: 0, right: 0, top: 0, bottom: 0 };
  }

  reset(options, scale, x, y) {
    this.options = options;
    this.depth = 1;
    this.matrix = this.stack[0];
    this.matrix.reset();
    this.matrix.x = x;
    this.matrix.y = y;
    this.scale = scale;
    this.recordedPoints = [];
    this.bounds = { left: x, right: x, top: y, bottom: y };
    this.surface.configure(options);
  }

  push() {
    if (this.depth >= this.stack.length) this.stack.push(new Matrix());
    this.matrix.copyTo(this.stack[this.depth]);
    this.matrix = this.stack[this.depth++];
  }

  pop() {
    if (this.depth < 1) return;
    this.depth--;
    this.matrix = this.stack[this.depth - 1];
  }

  moveInMillimeters(mm) { this.matrix.move(mm * this.scale); }
  position() { return [this.matrix.x, this.matrix.y, this.matrix.z]; }

  rotateX(angle) { this.matrix.rotateX(angle); }
  rotateY(angle) { this.matrix.rotateY(angle); }
  rotateZ(angle) { this.matrix.rotateZ(angle); }

  setForeColorBackColor(front, back) {
    this.surface.foreColor = front;
    this.surface.backColor = back;
  }

  setLineColor(color) { this.surface.lineColor = color; }
  setLineWidth(width) { this.surface.lineWidth = Math.min(width * this.scale, 16000); }

  clearRecording() { this.recordedPoints.length = 0; }

  addToBounds(x, y) {
    const b = this.bounds;
    if (x < b.left) b.left = x;
    else if (x > b.right) b.right = x;
    if (y < b.top) b.top = y;
    else if (y > b.bottom) b.bottom = y;
  }

  transformAndRecord(point, scale) {
    const s = scale * this.scale;
    const result = this.matrix.transform(point[0] * s, point[1] * s, point[2] * s);
    this.recordedPoints.push(result);
    this.addToBounds(result[0], result[1]);
    return result;
  }

  drawInMillimeters(mm, partID) {
    const m = this.matrix;
    const start = [m.x, m.y, m.z];
    m.move(mm * this.scale);
    const line = this.options.drawStems ? this.surface.drawLine(start, [m.x, m.y, m.z], partID) : null;
    this.addToBounds(m.x, m.y);
    return line;
  }

  drawTriangleFromIndexes(a, b, c, partID) {
    this.surface.lineWidth = 1;
    const p = this.recordedPoints;
    return this.surface.drawTriangle(p[a - 1], p[b - 1], p[c - 1], partID);
  }

  drawTrianglesFromBoundsRect(rect) {
    this.surface.lineWidth = 1;
    const { left: l, top: t, right: r, bottom: b } = rect;
    this.surface.drawTriangle([l, t, 0], [r, t, 0], [l, b, 0], 0);
    this.surface.drawTriangle([l, b, 0], [r, t, 0], [r, b, 0], 0);
  }
}
