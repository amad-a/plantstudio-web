// The Breeder window, from ubreedr.pas: rows of generations. Pick one parent to
// mutate or two to cross, and each Breed makes a new row of offspring.

import { breed, MUTATION } from '../model/plant.js';
import { Random } from '../model/support.js';
import { el, openDialog } from './dom.js';
import { fitPlant, paintPlant } from './thumbnail.js';

const THUMB = 100;
const PLANTS_PER_GENERATION = 5;

export function openBreeder(app, parent) {
  const generator = new Random(Date.now() % 2147483647);
  const chosen = new Set();
  const generations = el('div', { class: 'generations' });
  const status = el('span', {}, 'Pick one plant to mutate, or two to cross.');
  let variation = 'medium';
  let varyColors = true;
  let vary3DObjects = false;

  const addGeneration = (plants) => {
    const row = el('div', { class: 'generation' });
    for (const plant of plants) {
      const canvas = el('canvas', { width: THUMB, height: THUMB });
      const button = el('button', { class: 'thumb', title: plant.name, onclick: () => toggle(plant, button) }, canvas);
      row.append(button);
      paintPlant(canvas, plant, fitPlant(plant, THUMB, THUMB));
    }
    generations.append(row);
    generations.scrollTop = generations.scrollHeight;
  };

  const toggle = (plant, button) => {
    if (chosen.has(plant)) {
      chosen.delete(plant);
      button.classList.remove('chosen');
    } else if (chosen.size < 2) {
      chosen.add(plant);
      button.classList.add('chosen');
    }
    status.textContent = `${chosen.size} of 2 parents picked.`;
  };

  const clearChoice = () => {
    chosen.clear();
    generations.querySelectorAll('.chosen').forEach((node) => node.classList.remove('chosen'));
  };

  const makeGeneration = () => {
    if (!chosen.size) {
      status.textContent = 'Pick a parent first.';
      return;
    }
    const [first, second = null] = chosen;
    const options = { mutation: MUTATION[variation], blendColors: varyColors, randomTdos: vary3DObjects };
    const children = [];
    for (let i = 0; i < PLANTS_PER_GENERATION; i++) {
      const child = breed(first, second, options, generator, app.tdoLibrary);
      child.name = `${first.name} bred ${i + 1}`;
      children.push(child);
    }
    clearChoice();
    addGeneration(children);
    status.textContent = 'Pick the next parents, or send your favorites to the main window.';
  };

  const sendToMain = () => {
    for (const plant of chosen) app.addPlant(plant.copy());
    status.textContent = `Sent ${chosen.size} to the main window.`;
    clearChoice();
  };

  const variationButton = (key, icon, title) => el('button', {
    class: `tool${key === variation ? ' pressed' : ''}`, title, dataset: { variation: key },
    onclick: (event) => {
      variation = key;
      event.currentTarget.parentElement.querySelectorAll('[data-variation]').forEach((node) => node.classList.toggle('pressed', node.dataset.variation === key));
    },
  }, el('img', { src: `icons/${icon}.png`, alt: title }));

  const { body } = openDialog('Breeder');
  body.append(
    el('div', { class: 'row' }, 'Variation',
      variationButton('none', 'BreederForm_variationNoneNumeric', 'No numeric variation'),
      variationButton('low', 'BreederForm_variationLow', 'Low variation'),
      variationButton('medium', 'BreederForm_variationMedium', 'Medium variation'),
      variationButton('high', 'BreederForm_variationHigh', 'High variation'),
      el('span', { class: 'divider' }),
      el('input', { id: 'varyColors', type: 'checkbox', checked: true, onchange: (event) => { varyColors = event.target.checked; } }),
      el('label', { for: 'varyColors' }, 'Vary colors'),
      el('input', { id: 'vary3D', type: 'checkbox', onchange: (event) => { vary3DObjects = event.target.checked; } }),
      el('label', { for: 'vary3D' }, 'Vary 3D objects')),
    generations,
    el('div', { class: 'row spacer-top' }, status),
    el('div', { class: 'dialog-buttons' },
      el('button', { onclick: makeGeneration }, 'Breed'),
      el('button', { onclick: sendToMain }, 'Send to Main'),
      el('button', { onclick: () => generations.replaceChildren() }, 'Clear')));

  const start = parent.copy();
  addGeneration([start]);
  toggle(start, generations.querySelector('.thumb'));
  makeGeneration();
}
