// Drawing: KfDrawingSurface from udrawingsurface.pas, with GDI replaced by a
// little software rasterizer so pixels stay hard-edged like a Win98 canvas.

import { round, darkerColor, red, green, blue } from './support.js';

const opaque = (color) => (0xff000000 | (blue(color) << 16) | (green(color) << 8) | red(color)) >>> 0;

// Records nothing and draws nothing: for measuring plants.
export class NullSurface {
  foreColor = 0; backColor = 0; lineColor = 0; lineWidth = 1;
  configure() {}
  drawLine() { return null; }
  drawTriangle() { return { zForSorting: 0 }; }
}

// Draws into a Uint32Array of ABGR pixels, as ImageData wants them.
export class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint32Array(width * height);
    this.owners = new Uint16Array(width * height); // which plant last drew each pixel
    this.parts = new Int32Array(width * height); // and which part of it
    this.owner = 0;
    this.part = 0;
    this.discs = new Map();
  }

  clear(color) {
    this.pixels.fill(opaque(color));
    this.owners.fill(0);
    this.parts.fill(0);
  }

  span(y, x0, x1, value) {
    if (y < 0 || y >= this.height) return;
    const left = Math.max(0, x0);
    const right = Math.min(this.width - 1, x1);
    if (left > right) return;
    const start = y * this.width;
    this.pixels.fill(value, start + left, start + right + 1);
    this.owners.fill(this.owner, start + left, start + right + 1);
    this.parts.fill(this.part, start + left, start + right + 1);
  }

  // Bresenham, clipped up front because zoomed-in lines run far off screen.
  line(x0, y0, x1, y1, color, width = 1) {
    const value = opaque(color);
    const margin = width + 1;
    const clipped = clipLine(x0, y0, x1, y1, -margin, -margin, this.width + margin, this.height + margin);
    if (!clipped) return;
    [x0, y0, x1, y1] = clipped;
    const spans = width > 1 ? this.disc(width) : null;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      if (spans) {
        for (const [offset, half] of spans) this.span(y0 + offset, x0 - half, x0 + half, value);
      } else {
        this.span(y0, x0, x0, value);
      }
      if (x0 === x1 && y0 === y1) break;
      const doubled = 2 * error;
      if (doubled >= dy) { error += dy; x0 += sx; }
      if (doubled <= dx) { error += dx; y0 += sy; }
    }
  }

  // GDI's wide pens have round ends, so a wide line is a stamped disc.
  disc(width) {
    let spans = this.discs.get(width);
    if (!spans) {
      const radius = width / 2;
      spans = [];
      for (let y = -Math.floor(radius); y <= Math.floor(radius); y++) {
        spans.push([y, Math.floor(Math.sqrt(radius * radius - y * y))]);
      }
      this.discs.set(width, spans);
    }
    return spans;
  }

  fillTriangle(ax, ay, bx, by, cx, cy, color) {
    const value = opaque(color);
    const top = Math.max(0, Math.min(ay, by, cy));
    const bottom = Math.min(this.height - 1, Math.max(ay, by, cy));
    for (let y = top; y <= bottom; y++) {
      let left = Infinity, right = -Infinity;
      const edge = (x0, y0, x1, y1) => {
        if (y < Math.min(y0, y1) || y > Math.max(y0, y1)) return;
        if (y0 === y1) {
          left = Math.min(left, x0, x1);
          right = Math.max(right, x0, x1);
        } else {
          const x = x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      };
      edge(ax, ay, bx, by);
      edge(bx, by, cx, cy);
      edge(cx, cy, ax, ay);
      if (left <= right) this.span(y, Math.ceil(left), Math.floor(right), value);
    }
  }
}

// Liang-Barsky, rounded back to whole pixels.
function clipLine(x0, y0, x1, y1, minX, minY, maxX, maxY) {
  const dx = x1 - x0, dy = y1 - y0;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, x0 - minX], [dx, maxX - x0], [-dy, y0 - minY], [dy, maxY - y0]]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [Math.round(x0 + t0 * dx), Math.round(y0 + t0 * dy), Math.round(x0 + t1 * dx), Math.round(y0 + t1 * dy)];
}

export class RasterSurface {
  foreColor = 0; backColor = 0; lineColor = 0; lineWidth = 1;

  constructor(raster) {
    this.raster = raster;
    this.primitives = [];
    this.recording = false;
    this.options = null;
  }

  configure(options) {
    this.options = options;
    this.primitives = [];
    this.recording = options.sortPolygons;
    this.lineWidth = 1;
  }

  drawLine(start, end, partID) {
    const line = {
      isLine: true, points: [start, end], partID, tdo: null,
      lineColor: this.lineColor, lineWidth: this.lineWidth,
      zForSorting: Math.min(start[2], end[2]),
    };
    if (this.recording) this.primitives.push(line);
    else this.paint(line);
    return line;
  }

  drawTriangle(a, b, c, partID) {
    const triangle = {
      isLine: false, points: [a, b, c], partID, tdo: null,
      foreColor: this.foreColor, backColor: this.backColor,
      backFacing: (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0,
      zForSorting: Math.min(a[2], b[2], c[2]),
    };
    if (this.recording) this.primitives.push(triangle);
    else this.paint(triangle);
    return triangle;
  }

  // Sorting a 3D object as one item reads tdo.zForSorting *now*, after drawing,
  // so every copy of a shared object sorts by the last copy drawn. Original behaviour.
  finish() {
    if (!this.recording) return;
    this.recording = false;
    const list = this.primitives;
    if (this.options.sortTdosAsOneItem) {
      for (const item of list) {
        if (!item.isLine && item.tdo) item.zForSorting = item.tdo.zForSorting + item.zForSorting * 0.01;
      }
    }
    quicksort(list, 0, list.length - 1);
    for (const item of list) this.paint(item);
    this.primitives = [];
  }

  paint(item) {
    const raster = this.raster;
    const p = item.points;
    raster.part = item.partID;
    if (item.isLine) {
      raster.line(round(p[0][0]), round(p[0][1]), round(p[1][0]), round(p[1][1]), item.lineColor, round(item.lineWidth));
      return;
    }
    const ax = round(p[0][0]), ay = round(p[0][1]);
    const bx = round(p[1][0]), by = round(p[1][1]);
    const cx = round(p[2][0]), cy = round(p[2][1]);
    const color = item.backFacing ? item.backColor : item.foreColor;
    const options = this.options;
    if (options.wireFrame) {
      raster.line(ax, ay, bx, by, color);
      raster.line(bx, by, cx, cy, color);
      raster.line(cx, cy, ax, ay, color);
      return;
    }
    raster.fillTriangle(ax, ay, bx, by, cx, cy, color);
    const edge = options.drawLines && options.lineContrastIndex > 0 ? darkerColor(color, 10 * options.lineContrastIndex) : color;
    raster.line(ax, ay, bx, by, edge);
    raster.line(bx, by, cx, cy, edge);
    raster.line(cx, cy, ax, ay, edge);
  }
}

// The original's own quicksort. It isn't stable, so paint order for equal z needs it.
export function quicksort(items, left, right) {
  while (right > left) {
    const z = items[right].zForSorting;
    let i = left - 1, j = right;
    for (;;) {
      do i++; while (items[i].zForSorting < z);
      do j--; while (j >= i && items[j].zForSorting > z);
      if (i >= j) break;
      [items[i], items[j]] = [items[j], items[i]];
    }
    [items[i], items[right]] = [items[right], items[i]];
    if (j - left < right - i - 1) {
      quicksort(items, left, j);
      left = i + 1;
    } else {
      quicksort(items, i + 1, right);
      right = j;
    }
  }
}
