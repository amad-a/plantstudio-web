// 3D objects: a named triangle mesh, from utdo.pas.
// Point indexes in triangles are 1-based, as they are in .pla and .tdo files.

export class Tdo {
  constructor(name = '') {
    this.name = name;
    this.points = [];
    this.triangles = [];
    this.originPointIndex = 0;
    this.zForSorting = 0;
  }

  copy() {
    const tdo = new Tdo(this.name);
    tdo.points = this.points.map((p) => [...p]);
    tdo.triangles = this.triangles.map((t) => [...t]);
    tdo.originPointIndex = this.originPointIndex;
    return tdo;
  }

  addPointString(text) {
    this.points.push(numbers(text));
  }

  addTriangleString(text) {
    const [a, b, c] = numbers(text);
    const n = this.points.length;
    if (a >= 1 && b >= 1 && c >= 1 && a <= n && b <= n && c <= n) this.triangles.push([a, b, c]);
  }

  adjustForOrigin() {
    if (!this.points.length) return;
    this.originPointIndex = Math.max(0, Math.min(this.points.length - 1, this.originPointIndex));
    const [ox, oy, oz] = this.points[this.originPointIndex];
    for (const point of this.points) {
      point[0] -= ox;
      point[1] -= oy;
      point[2] -= oz;
    }
  }

  // Default objects in Parameters.tab look like N[name],P[1 2 3],T[1 2 3]
  static fromInputString(text) {
    const tdo = new Tdo();
    for (const part of text.split(',')) {
      const body = part.trim().slice(2, -1);
      const kind = part.trim()[0]?.toUpperCase();
      if (kind === 'N') tdo.name = body;
      else if (kind === 'P') tdo.addPointString(body);
      else if (kind === 'T') tdo.addTriangleString(body);
    }
    tdo.adjustForOrigin();
    return tdo;
  }

  draw(turtle, scale, partID) {
    this.zForSorting = 0;
    turtle.clearRecording();
    const bounds = emptyRect();
    for (const point of this.points) addToRect(bounds, turtle.transformAndRecord(point, scale));
    if (!turtle.options.draw3DObjects) return;
    if (turtle.options.exporting) {
      turtle.surface.addMesh(turtle.recordedPoints, this.triangles);
      return;
    }
    if (turtle.options.draw3DObjectsAsRects) {
      turtle.drawTrianglesFromBoundsRect(bounds);
      return;
    }
    const sortAsOne = turtle.options.sortPolygons && turtle.options.sortTdosAsOneItem;
    let minZ = 0;
    this.triangles.forEach(([a, b, c], i) => {
      const triangle = turtle.drawTriangleFromIndexes(a, b, c, partID);
      if (sortAsOne) {
        minZ = i === 0 ? triangle.zForSorting : Math.min(minZ, triangle.zForSorting);
        triangle.tdo = this;
      }
    });
    this.zForSorting = minZ;
  }

  // Each triangle gets a reversed twin across the x axis.
  makeMirrorTriangles() {
    this.adjustForOrigin();
    for (const triangle of [...this.triangles]) {
      const mirrored = triangle.map((index) => {
        const [x, y, z] = this.points[index - 1];
        return this.addPointIfNoMatch([-x, y, z], 1);
      });
      this.triangles.push([mirrored[2], mirrored[1], mirrored[0]]);
    }
  }

  addPointIfNoMatch(point, matchDistance) {
    const match = this.points.findIndex((p) => p.every((value, i) => Math.abs(value - point[i]) <= matchDistance));
    if (match >= 0) return match + 1;
    this.points.push([...point]);
    return this.points.length;
  }

  reverseZValues() {
    this.adjustForOrigin();
    for (const point of this.points) point[2] = -point[2];
  }

  setOriginPointIndex(index) {
    if (index === this.originPointIndex) return;
    this.originPointIndex = index;
    this.adjustForOrigin();
  }

  removeTriangle(triangle) {
    this.triangles.splice(this.triangles.indexOf(triangle), 1);
    this.removePointsNotInUse();
  }

  removePointsNotInUse() {
    for (let index = this.points.length - 1; index >= 0; index--) {
      if (this.triangles.some((triangle) => triangle.includes(index + 1))) continue;
      this.points.splice(index, 1);
      if (this.originPointIndex > index) this.originPointIndex--;
      for (const triangle of this.triangles) {
        triangle.forEach((value, i) => { if (value > index + 1) triangle[i] = value - 1; });
      }
    }
    this.originPointIndex = Math.max(0, Math.min(this.points.length - 1, this.originPointIndex));
  }

  toFileLines() {
    return [
      `  Name=${this.name}`,
      ...this.points.map((p) => `  Point=${p.map(Math.round).join(' ')}`),
      `; Origin=${this.originPointIndex}`,
      ...this.triangles.map((t) => `  Triangle=${t.join(' ')}`),
    ];
  }
}

const numbers = (text) => text.trim().split(/\s+/).map(Number);
const emptyRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, empty: true });

function addToRect(rect, [x, y]) {
  if (rect.empty) {
    rect.left = rect.right = x;
    rect.top = rect.bottom = y;
    rect.empty = false;
    return;
  }
  if (x < rect.left) rect.left = x;
  else if (x > rect.right) rect.right = x;
  if (y < rect.top) rect.top = y;
  else if (y > rect.bottom) rect.bottom = y;
}

// A .tdo library: repeated blocks of Name=/Point=/Triangle= lines.
export function parseTdoLibrary(text) {
  const library = [];
  let tdo = null;
  for (const line of text.split(/\r?\n/)) {
    const [field, ...rest] = line.split('=');
    const key = field.trim().toLowerCase();
    const value = rest.join('=');
    if (key === 'name') library.push((tdo = new Tdo(value.trim())));
    else if (tdo && key === 'point') tdo.addPointString(value);
    else if (tdo && key === 'triangle') tdo.addTriangleString(value);
  }
  library.forEach((t) => t.adjustForOrigin());
  return library;
}
