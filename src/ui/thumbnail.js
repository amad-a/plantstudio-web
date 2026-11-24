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

// `background` is optional: { color } to clear with instead of white, and { tile } (from
// makeTile) to repeat behind the plant.
export function paintPlant(canvas, plant, { scale, x, y }, options = DRAW_MODES.solids, background = {}) {
  const { raster, turtle } = painterFor(canvas);
  raster.clear(background.color ?? WHITE);
  raster.owner = 1; // marks the plant's pixels, so a tiled background fills only the rest
  POSING.drawingForOutput = true;
  try {
    plant.drawOn(turtle, options, scale, x, y);
  } finally {
    POSING.drawingForOutput = false;
    raster.owner = 0;
  }
  if (background.tile) fillBehind(raster, background.tile);
  show(canvas, raster);
}

// An image made into a wallpaper tile: shrunk to `width` pixels across (0 keeps its own
// size), then each pixel blown up to a `pixelSize` square with no smoothing.
export function makeTile(image, width, pixelSize) {
  const across = Math.max(1, Math.round(width || image.width));
  const down = Math.max(1, Math.round((image.height * across) / image.width));
  const small = new OffscreenCanvas(across, down);
  small.getContext('2d').drawImage(image, 0, 0, across, down);
  const size = Math.max(1, Math.min(pixelSize, Math.floor(4096 / Math.max(across, down))));
  const big = new OffscreenCanvas(across * size, down * size);
  const context = big.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(small, 0, 0, big.width, big.height);
  const { data } = context.getImageData(0, 0, big.width, big.height);
  return { width: big.width, height: big.height, pixels: new Uint32Array(data.buffer) };
}

// Pixels are stored the way ImageData lays them out: 0xAABBGGRR on little-endian machines.
function fillBehind(raster, tile) {
  const { pixels, owners, width, height } = raster;
  for (let y = 0; y < height; y++) {
    const row = y * width, tileRow = (y % tile.height) * tile.width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (owners[i]) continue;
      const t = tile.pixels[tileRow + (x % tile.width)];
      const alpha = t >>> 24;
      if (alpha === 255) {
        pixels[i] = t;
      } else if (alpha) {
        const p = pixels[i];
        const mix = (shift) => ((((t >>> shift) & 255) * alpha + ((p >>> shift) & 255) * (255 - alpha)) / 255) & 255;
        pixels[i] = (0xff000000 | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
      }
    }
  }
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
