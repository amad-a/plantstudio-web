// Small pictures of plants and 3D objects for the Breeder, Time Series and Plant Wizard.

import { POSING } from '../model/parts.js';
import { Raster, RasterSurface } from '../model/surface.js';
import { Turtle, DRAW_MODES } from '../model/turtle.js';
import { rgb } from '../model/support.js';

const WHITE = rgb(255, 255, 255);
const TDO_FACE = rgb(192, 192, 192), TDO_BACK = rgb(128, 128, 128);
const MARGIN = 0.9;
// One raster per canvas, remade when the canvas changes size and dropped with it.
const painters = new WeakMap();

function painterFor(canvas) {
  let painter = painters.get(canvas);
  if (!painter || painter.raster.width !== canvas.width || painter.raster.height !== canvas.height) {
    const raster = new Raster(canvas.width, canvas.height);
    painter = { raster, turtle: new Turtle(new RasterSurface(raster)) };
    painters.set(canvas, painter);
  }
  return painter;
}

function show(canvas, raster) {
  const pixels = new Uint8ClampedArray(raster.pixels.slice().buffer);
  canvas.getContext('2d').putImageData(new ImageData(pixels, raster.width, raster.height), 0, 0);
}

export function measureAtScaleOne(plant) {
  const { left, top, right, bottom } = plant.measure(1, 0, 0);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function fitPlant(plant, width, height) {
  const size = measureAtScaleOne(plant);
  const scale = Math.min(width / size.width, height / size.height) * MARGIN;
  return { scale, ...centerAtScale(size, scale, width, height) };
}

export function centerAtScale(size, scale, width, height) {
  return {
    x: (width - size.width * scale) / 2 - size.left * scale,
    y: (height - size.height * scale) / 2 - size.top * scale,
  };
}

export function paintPlant(canvas, plant, { scale, x, y }, options = DRAW_MODES.solids) {
  const { raster, turtle } = painterFor(canvas);
  raster.clear(WHITE);
  POSING.drawingForOutput = true;
  try {
    plant.drawOn(turtle, options, scale, x, y);
  } finally {
    POSING.drawingForOutput = false;
  }
  show(canvas, raster);
}

export function paintTdo(canvas, tdo) {
  const { raster, turtle } = painterFor(canvas);
  raster.clear(WHITE);
  const xs = tdo.points.map((point) => point[0]), ys = tdo.points.map((point) => point[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - left), height = Math.max(1, Math.max(...ys) - top);
  const scale = Math.min(canvas.width / width, canvas.height / height) * MARGIN;
  const x = (canvas.width - width * scale) / 2 - left * scale;
  const y = (canvas.height - height * scale) / 2 - top * scale;
  turtle.reset(DRAW_MODES.tdoEditor, 1, x, y);
  turtle.setForeColorBackColor(TDO_FACE, TDO_BACK);
  tdo.draw(turtle, scale, 0);
  turtle.surface.finish();
  show(canvas, raster);
}
