// OBJ export, from KfDrawingSurfaceForOBJ in u3dexport.pas. Stems become five-sided pipes
// and 3D objects are written double sided, as the original does by default. One difference:
// everything is in millimeters, so a file doesn't depend on how far the window was zoomed.

import { POSING } from './parts.js';
import { Turtle, DRAW_MODES } from './turtle.js';
import { red, green, blue, colorToHex } from './support.js';

const DOUBLE_SIDED = true;
const decimals = (value) => String(Number(value.toFixed(4)));
const shortName = (name) => name.replace(/\W+/g, '_').replace(/^_|_$/g, '') || 'plant';

class ObjSurface {
  foreColor = 0; backColor = 0; lineColor = 0; lineWidth = 1;
  lastPipeEnd = null;
  materials = new Map();
  currentMaterial = null;
  points = [];
  faces = [];

  constructor(materialsFileName) {
    this.lines = [
      '# OBJ file created by PlantStudio', '',
      '# Materials file must be in same directory', `mtllib ${materialsFileName}`,
    ];
  }

  configure() {}

  startPlant(name) {
    this.plantName = shortName(name);
    this.currentMaterial = null;
    this.lines.push('', `# plant "${name}"`, `o ${this.plantName}`, `g ${this.plantName}`, 's off');
  }

  useMaterial(color) {
    const name = `${this.plantName}_${colorToHex(color).slice(1)}`;
    this.materials.set(name, color);
    if (name === this.currentMaterial) return;
    this.currentMaterial = name;
    this.lines.push('', `usemtl ${name}`);
  }

  startStemSegment(color) {
    this.useMaterial(color);
  }

  // Rings are written one after the other, so each segment's faces start past the last.
  drawPipeFaces(startPoints, endPoints, segmentNumber) {
    const count = startPoints.length;
    const start = segmentNumber * count * 2;
    this.points.push(...startPoints, ...endPoints);
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      this.faces.push([start + i, start + i + count, start + next]);
      this.faces.push([start + next, start + i + count, start + next + count]);
    }
    this.lastPipeEnd = endPoints;
  }

  endStemSegment() {
    this.writeVerticesAndFaces();
  }

  addMesh(points, triangles) {
    this.useMaterial(this.foreColor);
    this.points.push(...points);
    for (const [a, b, c] of triangles) {
      this.faces.push([a - 1, b - 1, c - 1]);
      if (DOUBLE_SIDED) this.faces.push([a - 1, c - 1, b - 1]);
    }
    this.writeVerticesAndFaces();
  }

  // Faces count back from the newest vertex, so these blocks can follow each other freely.
  writeVerticesAndFaces() {
    const count = this.points.length;
    for (const [x, y, z] of this.points) this.lines.push(`v ${decimals(x)} ${decimals(-y)} ${decimals(z)}`);
    for (const [a, b, c] of this.faces) this.lines.push(`f ${a - count} ${b - count} ${c - count}`);
    this.points = [];
    this.faces = [];
  }

  materialsFile() {
    const lines = ['# Materials created by PlantStudio', ''];
    for (const [name, color] of this.materials) {
      const value = [red(color), green(color), blue(color)].map((channel) => decimals(channel / 255)).join(' ');
      lines.push(`newmtl ${name}`, `Ka ${value}`, `Kd ${value}`, `Ks ${value}`, 'd 1.0', 'illum 1', '');
    }
    return lines.join('\n');
  }
}

// Places plants as they stand in the window, with the group's left end at x 0 and the
// ground at y 0, and returns the text of both files.
export function exportPlantsToObj(plants, materialsFileName) {
  const surface = new ObjSurface(materialsFileName);
  const turtle = new Turtle(surface);
  const left = Math.min(...plants.map((plant) => plant.basePoint_mm.x));
  const ground = Math.max(...plants.map((plant) => plant.basePoint_mm.y));
  POSING.drawingForOutput = true;
  try {
    for (const plant of plants) {
      surface.startPlant(plant.name);
      turtle.reset(DRAW_MODES.export, plant.drawingScale_PixelsPerMm, plant.basePoint_mm.x - left, plant.basePoint_mm.y - ground);
      plant.draw(turtle);
    }
  } finally {
    POSING.drawingForOutput = false;
  }
  return { obj: surface.lines.join('\n') + '\n', mtl: surface.materialsFile() };
}
