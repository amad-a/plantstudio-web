// Drives posing, time series, printing, the wizard, OBJ export and the 3D object
// editor in real Chrome. usage: node test/browser-features.mjs http://localhost:8123 screenshot-dir
import { chromium } from '/Users/amad/code/wayback-scraper/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [url, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });

const failures = [];
const log = (name, value) => console.log(name.padEnd(30), value);
const expect = (name, value, passed) => {
  log(`${passed ? 'ok  ' : 'FAIL'} ${name}`, value);
  if (!passed) failures.push(name);
};
const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const openMenu = async (...path) => {
  await page.locator('.menubar > .menu > button', { hasText: new RegExp(`^${path[0]}$`) }).click();
  for (const label of path.slice(1)) await page.locator('.menu-items button:visible', { hasText: new RegExp(`^${label}`) }).first().click();
};
const focused = (body, arg) => page.evaluate(`((plant, arg) => ${body})(window.plantStudio.firstSelected(), ${JSON.stringify(arg ?? null)})`);
const clickCanvas = async (x, y) => {
  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x + x, box.y + y);
  await settle();
};
// A pixel of the given kind of part, on the focused plant.
const pixelOfPart = (kind) => page.evaluate((wanted) => {
  const app = window.plantStudio;
  const plant = app.firstSelected();
  const { owners, parts, width } = app.view.raster;
  const owner = app.plants.indexOf(plant) + 1;
  const names = new Map();
  for (let i = 0; i < parts.length; i++) {
    if (owners[i] !== owner || !parts[i]) continue;
    if (!names.has(parts[i])) names.set(parts[i], plant.plantPartForPartID(parts[i])?.getName());
    if (names.get(parts[i]) === wanted) return { x: i % width, y: Math.floor(i / width), partID: parts[i] };
  }
  return null;
}, kind);
const blueCount = () => page.evaluate(() => window.plantStudio.view.raster.pixels.reduce((n, p) => n + (p === 0xffff0000 ? 1 : 0), 0));

await page.goto(url);
await page.waitForFunction(() => window.plantStudio?.plants.length > 0);
await page.locator('#plantList li', { hasText: /^wild pink$/ }).click();
await page.locator('[data-view="one"]').click();
await settle();

// ------------------------------------------------------------ posing
await page.locator('[data-tool="pose"]').click();
const leaf = await pixelOfPart('leaf');
await clickCanvas(leaf.x, leaf.y);
expect('click picks the part', await focused('plant.selectedPartID'), (await focused('plant.selectedPartID')) === leaf.partID);
expect('posing tab opens', await page.locator('#panel').innerText().then((t) => t.split('\n')[0]), (await page.locator('#panel').innerText()).includes('Posing for wild pink'));
await page.locator('#panel button', { hasText: /^Pose$/ }).click();
await settle();
expect('pose created', await focused('plant.amendments.length'), (await focused('plant.amendments.length')) === 1);
await page.selectOption('[aria-label="Posed parts"]', '-1');
await settle();
expect('posed part highlighted blue', await blueCount(), (await blueCount()) > 0);
await page.selectOption('[aria-label="Posed parts"]', String(leaf.partID));
await settle();
await page.screenshot({ path: `${shots}/f1-posing.png` });
await page.locator('label[for="pose-addRotations"]').click();
await page.locator('#panel label', { hasText: /^X$/ }).locator('xpath=following-sibling::input[1]').fill('45');
await page.locator('#panel label', { hasText: /^X$/ }).locator('xpath=following-sibling::input[1]').blur();
expect('rotation saved', await focused('plant.amendments[0].xRotation'), (await focused('plant.amendments[0].xRotation')) === 45);
await page.locator('label[for="pose-hide"]').click();
await settle();
const hiddenStill = await pixelOfPart('leaf').then(async () => page.evaluate((id) => window.plantStudio.view.raster.parts.includes(id), leaf.partID));
expect('hidden leaf gone', hiddenStill, !hiddenStill);
await page.locator('[title="Ghost hidden parts"]').click();
await settle();
expect('ghosted leaf back', true, await page.evaluate((id) => window.plantStudio.view.raster.parts.includes(id), leaf.partID));
await page.locator('[title="Ghost hidden parts"]').click();
const [poseFile] = await Promise.all([page.waitForEvent('download'), openMenu('File', 'Save As...')]);
await poseFile.saveAs(`${shots}/posed.pla`);
expect('pose written to file', 'start posing change', readFileSync(`${shots}/posed.pla`, 'latin1').includes('start posing change'));
await page.locator('#fileInput').setInputFiles({ name: 'posed.pla', mimeType: 'text/plain', buffer: readFileSync(`${shots}/posed.pla`) });
await page.waitForFunction(() => document.title.startsWith('posed'));
await page.locator('#plantList li', { hasText: /^wild pink$/ }).click();
expect('pose reloaded', await focused('plant.amendments[0].hide'), (await focused('plant.amendments[0].hide')) === true);
await page.locator('#panel').waitFor();
await page.locator('[data-view="all"]').click();
await page.locator('[data-tool="drag"]').click();
await settle();

// ------------------------------------------------------------ time series
await openMenu('Plant', 'Make Time Series');
await page.waitForSelector('.stages .thumb');
expect('five stages', await page.locator('.stage').count(), (await page.locator('.stage').count()) === 5);
const stageLabels = await page.locator('.stage span').allTextContents();
expect('ages rise to maturity', stageLabels.join(', '), stageLabels.at(-1) === `${await focused('plant.pGeneral.ageAtMaturity')} days`);
await page.locator('#timeSeriesStages').fill('8');
await page.locator('#timeSeriesStages').blur();
await page.waitForFunction(() => document.querySelectorAll('.stage').length === 8);
await page.screenshot({ path: `${shots}/f2-timeseries.png` });
await page.locator('.stage .thumb').nth(3).click();
const before = await page.evaluate(() => window.plantStudio.plants.length);
await page.locator('.dialog-buttons button', { hasText: 'Send to Main' }).click();
expect('stage sent to main', await page.evaluate(() => window.plantStudio.plants.length), (await page.evaluate(() => window.plantStudio.plants.length)) === before + 1);
await page.locator('.dialog-buttons button', { hasText: 'Close' }).click();

// ------------------------------------------------------------ printing
await page.evaluate(() => { window.printed = 0; window.print = () => { window.printed++; }; });
await openMenu('File', 'Print Picture');
await page.waitForFunction(() => window.printed === 1);
const pictureWidth = await page.evaluate(() => document.getElementById('printPicture').naturalWidth);
expect('print picture made', pictureWidth, pictureWidth > 100);
await page.emulateMedia({ media: 'print' });
const printed = await page.evaluate(() => [getComputedStyle(document.getElementById('appWindow')).display, getComputedStyle(document.getElementById('printPicture')).display]);
expect('print shows only the picture', printed.join(', '), printed[0] === 'none' && printed[1] === 'block');
await page.screenshot({ path: `${shots}/f3-print.png` });
await page.emulateMedia({ media: 'screen' });

// ------------------------------------------------------------ wizard
await openMenu('Plant', 'Create New');
await page.waitForSelector('.wizard-page');
const next = page.locator('.dialog-buttons button', { hasText: /^(Next >|Finish)$/ });
const pick = (question, answer) => page.locator('.question', { hasText: question }).locator('button', { hasText: new RegExp(`^${answer}$`) }).click();
const pagesSeen = [];
const heading = async () => { pagesSeen.push((await page.locator('.wizard-page h4').textContent()).split(' (')[0]); };
await heading();
await next.click(); await heading();
await pick('How much should the plant branch', 'medium');
await pick('secondary branching', 'yes');
await next.click(); await heading();
await next.click(); await heading();
await page.screenshot({ path: `${shots}/f4-wizard-leaves.png` });
await next.click(); await heading();
await pick('How many leaflets', 'five');
await next.click(); await heading();
await pick('How many apical', 'two');
await next.click(); await heading();
await pick('How many flowers', 'ten');
await pick('What shape', 'panicle');
await next.click(); await heading();
await next.click(); await heading();
await next.click(); await heading();
expect('all ten wizard pages', pagesSeen.join(' > '), pagesSeen.length === 10 && pagesSeen.at(-1) === 'Finish');
await page.locator('.wizard-page input[type="text"]').fill('wizard test plant');
await page.locator('.wizard-page button', { hasText: 'Randomize' }).click();
await page.locator('.wizard-page button', { hasText: 'Turn Left' }).click();
await page.locator('.wizard-page button', { hasText: 'Turn Right' }).click();
await settle();
await page.screenshot({ path: `${shots}/f5-wizard-finish.png` });
await next.click();
expect('wizard plant added', await focused('plant.name'), (await focused('plant.name')) === 'wizard test plant');
expect('wizard settings applied', await focused('[plant.pMeristem.branchingIndex, plant.pLeaf.compoundNumLeaflets, plant.pGeneral.numApicalInflors].join()'), (await focused('[plant.pMeristem.branchingIndex, plant.pLeaf.compoundNumLeaflets, plant.pGeneral.numApicalInflors].join()')) === '30,5,2');
await settle();
await page.screenshot({ path: `${shots}/f6-wizard-plant.png` });
await openMenu('Plant', 'Create Same as Last');
expect('same as last adds a plant', await page.evaluate(() => window.plantStudio.firstSelected().pLeaf.compoundNumLeaflets), (await page.evaluate(() => window.plantStudio.firstSelected().pLeaf.compoundNumLeaflets)) === 5);

await openMenu('Plant', 'Create New');
await page.waitForSelector('.wizard-page');
const titles = [];
for (let i = 0; i < 20; i++) {
  titles.push((await page.locator('.wizard-page h4').textContent()).split(' (')[0]);
  if (i === 5) await pick('How many apical', 'none');
  if (i === 5) await pick('How many axillary', 'none');
  if (titles.at(-1) === 'Finish') break;
  await next.click();
}
expect('no flowers skips three pages', titles.join(' > '), titles.at(-1) === 'Finish' && !titles.includes('Flowers') && !titles.includes('Fruit') && !titles.includes('Inflorescences'));
await page.locator('.dialog-buttons button', { hasText: 'Cancel' }).click();

// ------------------------------------------------------------ OBJ export
const objDownloads = [];
page.on('download', (download) => objDownloads.push(download));
await openMenu('File', 'Export', 'OBJ');
await page.waitForFunction(() => document.getElementById('status').textContent.includes('OBJ'));
await page.waitForTimeout(300);
const names = objDownloads.map((download) => download.suggestedFilename()).sort();
expect('obj and mtl downloaded', names.join(', '), names.some((n) => n.endsWith('.obj')) && names.some((n) => n.endsWith('.mtl')));
const objPath = `${shots}/export.obj`;
await objDownloads.find((d) => d.suggestedFilename().endsWith('.obj')).saveAs(objPath);
const obj = readFileSync(objPath, 'latin1');
expect('obj has geometry', `${obj.match(/^v /gm).length} vertices, ${obj.match(/^f /gm).length} faces`, obj.match(/^f /gm).length > 100);

// ------------------------------------------------------------ 3D object editor
await page.locator('#plantList li', { hasText: /^wizard test plant$/ }).click();
await page.locator('#tabs a', { hasText: 'Parameters' }).click();
await page.selectOption('[aria-label="Parameter section"]', 'Leaves');
await page.locator('.tdo-field button').first().click();
await page.waitForSelector('canvas[aria-label="Edit view"]');
await settle();
await page.screenshot({ path: `${shots}/f7-editor.png` });
const editorStatus = () => page.locator('#tdoStatus').textContent();
const editBox = await page.locator('canvas[aria-label="Edit view"]').boundingBox();
const startCounts = await editorStatus();
expect('editor opened', startCounts, /\d+ points, \d+ triangles/.test(startCounts));
const pointA = await page.evaluate(() => {
  const canvas = document.querySelector('canvas[aria-label="Edit view"]');
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const i = (y * canvas.width + x) * 4;
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 255) return { x: x + 3, y: y + 4 };
  }
  return null;
});
expect('point dots drawn', JSON.stringify(pointA), pointA !== null);
const scaleX = editBox.width / 340;
await page.mouse.move(editBox.x + pointA.x * scaleX, editBox.y + pointA.y * scaleX);
await page.mouse.down();
await page.mouse.move(editBox.x + pointA.x * scaleX + 25, editBox.y + pointA.y * scaleX + 15, { steps: 3 });
await page.mouse.up();
await settle();
const undoEnabled = await page.locator('.dialog button', { hasText: 'Undo last' }).isEnabled();
expect('dragging a point can be undone', undoEnabled, undoEnabled);
await page.locator('.dialog [data-editor-tool="add"]').click();
for (const [x, y] of [[20, 20], [60, 20], [20, 60]]) await page.mouse.click(editBox.x + x, editBox.y + y);
await settle();
const added = await editorStatus();
expect('triangle added', added, added !== startCounts);
await page.locator('.dialog [data-editor-tool="remove"]').click();
await page.mouse.click(editBox.x + 30, editBox.y + 30);
await settle();
expect('triangle removed', await editorStatus(), (await editorStatus()) === startCounts);
await page.locator('.dialog button', { hasText: 'Mirror' }).click();
await settle();
const mirrored = await editorStatus();
expect('mirror adds triangles', mirrored, mirrored !== startCounts);
await page.locator('.dialog button', { hasText: 'Undo last' }).click();
await settle();
expect('undo restores', await editorStatus(), (await editorStatus()) === startCounts);
await page.locator('.dialog [data-editor-tool="rotate"]').click();
const viewBox = await page.locator('canvas[aria-label="Repeated view"]').boundingBox();
await page.mouse.move(viewBox.x + 100, viewBox.y + 100);
await page.mouse.down();
await page.mouse.move(viewBox.x + 180, viewBox.y + 140, { steps: 3 });
await page.mouse.up();
await settle();
await page.screenshot({ path: `${shots}/f8-editor-rotated.png` });
const pointBefore = await focused('JSON.stringify(plant.pLeaf.leafTdoParams.object3D.points)');
await page.locator('.dialog-buttons button', { hasText: /^OK$/ }).click();
await settle();
const pointAfter = await focused('JSON.stringify(plant.pLeaf.leafTdoParams.object3D.points)');
expect('OK puts the edit on the plant', pointAfter.length, pointAfter !== pointBefore);
expect('marked as changed', await page.locator('#title').textContent(), (await page.locator('#title').textContent()).includes('changed'));

// ------------------------------------------------------------ plant list and rotating
await page.goto(url);
await page.waitForFunction(() => window.plantStudio?.plants.length > 0);
const rows = page.locator('#plantList li');
await rows.nth(3).click();
const listStyle = () => page.evaluate(() => {
  const list = document.getElementById('plantList');
  const row = list.querySelector('[aria-selected="true"]');
  return [getComputedStyle(list).backgroundColor, getComputedStyle(row).backgroundColor, getComputedStyle(row).color].join(' ');
});
const wanted = 'rgb(255, 255, 255) rgb(0, 0, 128) rgb(255, 255, 255)';
expect('list stays white, row navy on white text', await listStyle(), (await listStyle()) === wanted);
await page.locator('#plantList').screenshot({ path: `${shots}/f9-list.png` });
const selectedNames = () => page.evaluate(() => [...window.plantStudio.selected].map((plant) => plant.name).join(', '));
await rows.nth(5).click({ modifiers: ['Shift'] });
expect('shift picks a range', await selectedNames(), (await page.evaluate(() => window.plantStudio.selected.size)) === 3);
await rows.nth(0).click({ modifiers: ['ControlOrMeta'] });
expect('ctrl adds one', await selectedNames(), (await page.evaluate(() => window.plantStudio.selected.size)) === 4);
await rows.nth(2).click();
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
expect('arrow keys move', await selectedNames(), (await selectedNames()) === 'violet');
await page.keyboard.press('Shift+ArrowUp');
expect('shift arrow extends', await selectedNames(), (await page.evaluate(() => window.plantStudio.selected.size)) === 2);

await rows.nth(3).click();
await rows.nth(4).click({ modifiers: ['ControlOrMeta'] });
await settle();
const hitForSelected = await page.evaluate(() => {
  const { owners, width } = window.plantStudio.view.raster;
  const index = owners.indexOf(window.plantStudio.plants.indexOf(window.plantStudio.firstSelected()) + 1);
  return { x: index % width, y: Math.floor(index / width) };
});
const canvasBox = await page.locator('#canvas').boundingBox();
const baseBefore = await page.evaluate(() => [...window.plantStudio.selected].map((plant) => plant.basePoint_mm.x));
await page.mouse.move(canvasBox.x + hitForSelected.x, canvasBox.y + hitForSelected.y);
await page.mouse.down();
await page.mouse.move(canvasBox.x + hitForSelected.x + 20, canvasBox.y + hitForSelected.y, { steps: 2 });
await page.mouse.up();
const baseAfter = await page.evaluate(() => [...window.plantStudio.selected].map((plant) => plant.basePoint_mm.x));
expect('a group drags together', `${baseAfter.length} plants`, baseAfter.length === 2 && baseAfter.every((x, i) => x > baseBefore[i]));

await rows.nth(3).click();
await page.locator('[data-view="one"]').click();
await page.locator('[data-tool="rotate"]').click();
await settle();
const rotation = () => focused('[plant.xRotation, plant.yRotation].map((n) => Math.round(n)).join()');
const emptyCorner = { x: canvasBox.x + 6, y: canvasBox.y + 6 };
const rotationBefore = await rotation();
await page.mouse.move(emptyCorner.x, emptyCorner.y);
await page.mouse.down();
await page.mouse.move(emptyCorner.x + 40, emptyCorner.y + 20, { steps: 3 });
await page.mouse.up();
await settle();
expect('drag on empty canvas rotates', `${rotationBefore} -> ${await rotation()}`, (await rotation()) !== rotationBefore);
expect('plant stays selected', await selectedNames(), (await selectedNames()) === 'wild pink');
const beforeWheel = await rotation();
await page.mouse.move(emptyCorner.x + 100, emptyCorner.y + 100);
await page.mouse.wheel(40, 80);
await settle();
expect('wheel rotates', `${beforeWheel} -> ${await rotation()}`, (await rotation()) !== beforeWheel);
const scaleBefore = await page.evaluate(() => window.plantStudio.view.scale);
const plantHit = await page.evaluate(() => {
  const { owners, width } = window.plantStudio.view.raster;
  const index = owners.findIndex((owner) => owner);
  return { x: index % width, y: Math.floor(index / width) };
});
await page.mouse.click(canvasBox.x + plantHit.x, canvasBox.y + plantHit.y);
expect('clicking the plant keeps the view', await page.evaluate(() => window.plantStudio.view.scale), (await page.evaluate(() => window.plantStudio.view.scale)) === scaleBefore);
await page.locator('[data-tool="drag"]').click();
await page.mouse.click(emptyCorner.x, emptyCorner.y);
expect('empty click keeps one plant up', await selectedNames(), (await selectedNames()) === 'wild pink');

// ------------------------------------------------------------ zooming
await page.locator('[data-view="all"]').click();
await page.locator('[data-tool="magnify"]').click();
await settle();
const zoom = () => page.evaluate(() => window.plantStudio.view.scale);
const near = (a, b) => Math.abs(a - b) / b < 0.01;
let start = await zoom();
const spotOnCanvas = { x: canvasBox.x + 300, y: canvasBox.y + 150 };
await page.mouse.click(spotOnCanvas.x, spotOnCanvas.y);
expect('click doubles once', (await zoom()) / start, near((await zoom()) / start, 2));
await page.keyboard.down('Shift');
await page.mouse.click(spotOnCanvas.x, spotOnCanvas.y);
await page.keyboard.up('Shift');
expect('shift-click halves', (await zoom()) / start, near((await zoom()) / start, 1));
start = await zoom();
await page.mouse.move(spotOnCanvas.x, spotOnCanvas.y);
const pinchWheel = (deltaY) => page.locator('#canvas').evaluate((canvas, { deltaY, x, y }) => {
  const event = new WheelEvent('wheel', { deltaY, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true });
  canvas.dispatchEvent(event);
  return event.defaultPrevented;
}, { deltaY, ...spotOnCanvas });
const anchored = () => page.evaluate(({ x, y }) => {
  const { view } = window.plantStudio;
  return [x / view.scale - view.offset_mm.x, y / view.scale - view.offset_mm.y];
}, { x: spotOnCanvas.x - canvasBox.x, y: spotOnCanvas.y - canvasBox.y });
const anchorBefore = await anchored();
const blockedPageZoom = await pinchWheel(-50);
expect('trackpad pinch in zooms', (await zoom()) / start, (await zoom()) > start && blockedPageZoom);
const anchorAfter = await anchored();
expect('pinch holds the point still', anchorAfter.map((n) => n.toFixed(1)).join(), near(anchorAfter[0], anchorBefore[0]) && near(anchorAfter[1], anchorBefore[1]));
await pinchWheel(50);
expect('trackpad pinch out zooms back', (await zoom()) / start, near((await zoom()) / start, 1));
await page.locator('[data-tool="drag"]').click();
start = await zoom();
const ignored = await pinchWheel(-50);
expect('other tools leave pinch alone', (await zoom()) / start, (await zoom()) === start && !ignored);

const touchContext = await browser.newContext({ viewport: { width: 1200, height: 800 }, hasTouch: true });
const touchPage = await touchContext.newPage();
touchPage.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
await touchPage.goto(url);
await touchPage.waitForFunction(() => window.plantStudio?.plants.length > 0);
await touchPage.locator('[data-tool="magnify"]').click();
await touchPage.waitForTimeout(100);
const touchBox = await touchPage.locator('#canvas').boundingBox();
const touch = await touchContext.newCDPSession(touchPage);
const send = (type, points) => touch.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x: touchBox.x + x, y: touchBox.y + y, id })) });
const touchZoom = () => touchPage.evaluate(() => window.plantStudio.view.scale);
start = await touchZoom();
await send('touchStart', [[300, 150], [340, 150]]);
await send('touchMove', [[260, 150], [380, 150]]);
await send('touchMove', [[220, 150], [420, 150]]);
await send('touchEnd', []);
await touchPage.waitForTimeout(100);
expect('two fingers pinch 5x', (await touchZoom()) / start, near((await touchZoom()) / start, 5));
start = await touchZoom();
await send('touchStart', [[300, 150]]);
await send('touchEnd', []);
await touchPage.waitForTimeout(100);
expect('one tap doubles once', (await touchZoom()) / start, near((await touchZoom()) / start, 2));
await touchContext.close();

log('ERRORS', errors.length ? `\n${errors.join('\n')}` : 'none');
if (failures.length) console.log('FAILED:', failures.join('; '));
await browser.close();
process.exitCode = failures.length || errors.length ? 1 : 0;
