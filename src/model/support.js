// Delphi behaviour the plants depend on: urandom.pas, umath.pas, usupport.pas, utravers.pas.

// Delphi's round() is banker's rounding. Plant shapes change without it.
export function round(x) {
  const floor = Math.floor(x);
  const fraction = x - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export const trunc = Math.trunc;
export const safediv = (x, y, fallback) => (y !== 0 ? x / y : fallback);
export const clamp = (x, low, high) => Math.min(high, Math.max(low, x));

export class Random {
  constructor(seed = 0) {
    this.seed = seed;
  }

  // Note round(), not div: the original's Park-Miller step keeps this quirk.
  step() {
    const k = round(this.seed / 127773);
    this.seed = round(16807 * (this.seed - k * 127773) - k * 2846);
    if (this.seed < 0) this.seed += 2147483647;
    return this.seed * 0.0000000004656612875;
  }

  zeroToOne() {
    return Math.fround(clamp(this.step(), 0, 1));
  }

  percent() {
    return round(clamp(this.step() * 100, 0, 100));
  }

  normalWithStdDev(mean, stdDev) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += this.zeroToOne();
    return (sum - 6) * stdDev + mean;
  }

  normal(mean) {
    return this.normalWithStdDev(mean, mean / 2);
  }

  normalPercent(mean) {
    return clamp(round(this.normal(mean / 100) * 100), 0, 100);
  }
}

export function scurve(x, c1, c2) {
  const exponent = Math.min(c1 - c2 * x, 85);
  return x / (x + Math.exp(exponent));
}

export function calcSCurveCoeffs(curve) {
  const inRange = [curve.x1, curve.y1, curve.x2, curve.y2].every((v) => v > 0 && v < 1);
  if (!inRange) Object.assign(curve, { x1: 0.25, y1: 0.1, x2: 0.65, y2: 0.85 });
  const xx = Math.log(curve.x1 / curve.y1 - curve.x1);
  curve.c2 = (xx - Math.log(curve.x2 / curve.y2 - curve.x2)) / (curve.x2 - curve.x1);
  curve.c1 = xx + curve.x1 * curve.c2;
}

// A growth step: how much of the shortfall can be made up today.
export function linearGrowthResult(current, optimal, minDays) {
  const maxPossible = safediv(optimal, minDays, optimal);
  return clamp(Math.min(optimal - current, maxPossible), 0, Infinity);
}

export function linearGrowth(current, optimal, minDays) {
  return current + linearGrowthResult(current, optimal, minDays);
}

// Colors are Windows TColors: 0x00BBGGRR, sometimes with palette bits on top.
export const red = (c) => c & 255;
export const green = (c) => (c >> 8) & 255;
export const blue = (c) => (c >> 16) & 255;
export const rgb = (r, g, b) => (r & 255) | ((g & 255) << 8) | ((b & 255) << 16);

export function darkerColor(color, subtract = 10) {
  return rgb(Math.max(0, red(color) - subtract), Math.max(0, green(color) - subtract), Math.max(0, blue(color) - subtract));
}

export const colorToHex = (c) => '#' + [red(c), green(c), blue(c)].map((v) => v.toString(16).padStart(2, '0')).join('');

export function hexToColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(n >> 16, n >> 8, n);
}
