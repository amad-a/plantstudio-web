// The Time Series window, from utimeser.pas: one plant at evenly spaced ages,
// all drawn at the same scale from the same spot so they can be compared.

import { el, openDialog } from './dom.js';
import { centerAtScale, fitPlant, measureAtScaleOne, paintPlant } from './thumbnail.js';

const THUMB = 100;
const MIN_STAGES = 1, MAX_STAGES = 30, DEFAULT_STAGES = 5;

function agesForStages(stages, maturity) {
  return Array.from({ length: stages }, (_, i) => {
    const percent = Math.min(100, Math.trunc(((i + 1) * 100) / stages));
    return Math.round((percent / 100) * maturity);
  });
}

// The smallest scale any stage needs, then the x of the widest and y of the tallest.
function commonPlacement(plants) {
  const sizes = plants.map(measureAtScaleOne);
  const scale = Math.min(...plants.map((plant) => fitPlant(plant, THUMB, THUMB).scale));
  const widest = sizes.reduce((best, size) => (size.width > best.width ? size : best));
  const tallest = sizes.reduce((best, size) => (size.height > best.height ? size : best));
  return {
    scale,
    x: centerAtScale(widest, scale, THUMB, THUMB).x,
    y: centerAtScale(tallest, scale, THUMB, THUMB).y,
  };
}

export function openTimeSeries(app, parent) {
  const row = el('div', { class: 'generation stages' });
  const status = el('span', {}, 'Click a stage to pick it.');
  let stages = DEFAULT_STAGES;
  let plants = [];
  let picked = null;

  const rebuild = () => {
    picked = null;
    plants = agesForStages(stages, parent.pGeneral.ageAtMaturity).map((age) => {
      const plant = parent.copy();
      plant.setAge(age);
      return plant;
    });
    const placement = commonPlacement(plants);
    row.replaceChildren(...plants.map((plant) => {
      const canvas = el('canvas', { width: THUMB, height: THUMB });
      const button = el('button', {
        class: 'thumb', title: `${plant.age} days`,
        onclick: () => {
          row.querySelector('.chosen')?.classList.remove('chosen');
          button.classList.add('chosen');
          picked = plant;
          status.textContent = `${plant.age} days picked.`;
        },
      }, canvas);
      paintPlant(canvas, plant, placement);
      return el('div', { class: 'stage' }, button, el('span', {}, `${plant.age} days`));
    }));
  };

  const stagesInput = el('input', {
    id: 'timeSeriesStages', type: 'number', min: MIN_STAGES, max: MAX_STAGES, value: stages,
    onchange: () => {
      stages = Math.max(MIN_STAGES, Math.min(MAX_STAGES, Math.round(Number(stagesInput.value)) || DEFAULT_STAGES));
      stagesInput.value = stages;
      rebuild();
    },
  });

  const sendToMain = () => {
    if (!picked) {
      status.textContent = 'Pick a stage first.';
      return;
    }
    const copy = picked.copy();
    copy.name = `${parent.name} at ${picked.age} days`;
    app.addPlant(copy);
    status.textContent = `Sent ${copy.name} to the main window.`;
  };

  const { body, close } = openDialog(`Time Series for ${parent.name}`);
  body.append(
    el('div', { class: 'row' }, el('label', { for: 'timeSeriesStages' }, 'Stages'), stagesInput),
    el('div', { class: 'generations' }, row),
    el('div', { class: 'row spacer-top' }, status),
    el('div', { class: 'dialog-buttons' },
      el('button', { onclick: sendToMain }, 'Send to Main'),
      el('button', { onclick: close }, 'Close')));
  rebuild();
}
