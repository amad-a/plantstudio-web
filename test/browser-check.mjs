// Drives the app in real Chrome: every library, tabs, tools, breeding, and saving.
// usage: node test/browser-check.mjs http://localhost:8123 screenshot-dir
import { chromium } from '/Users/amad/code/wayback-scraper/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [url, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()}`));
page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) errors.push(`${response.status()}: ${response.url()}`); });

const log = (name, value) => console.log(name.padEnd(26), value);
const inkCount = () => page.evaluate(() => {
  const { pixels } = window.plantStudio.view.raster;
  return pixels.reduce((n, p) => n + (p !== 0xffffffff ? 1 : 0), 0);
});
const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const openMenu = async (...path) => {
  await page.locator('.menubar > .menu > button', { hasText: new RegExp(`^${path[0]}$`) }).click();
  for (const label of path.slice(1)) await page.locator('.menu-items button:visible', { hasText: new RegExp(`^${label}`) }).first().click();
};

await page.goto(url);
await page.waitForFunction(() => window.plantStudio?.plants.length > 0);
await settle();
log('startup plants', await page.evaluate(() => window.plantStudio.plants.length));
log('startup ink pixels', await inkCount());
await page.screenshot({ path: `${shots}/1-wildflowers.png` });

for (const library of ['Garden flowers', 'Garden plants', 'Bushes and shrubs', 'Grassy plants', 'New version 2 plants', 'Strange breeder plants', 'Wildflowers']) {
  await openMenu('File', 'Open Library', library);
  await page.waitForFunction((name) => document.title.startsWith(name), library);
  await settle();
  log(library, `${await page.evaluate(() => window.plantStudio.plants.length)} plants, ${await inkCount()} ink`);
}

await page.locator('#plantList li', { hasText: /^black-eyed Susan$/ }).click();
await page.locator('[data-view="one"]').click();
await settle();
await page.screenshot({ path: `${shots}/2-one-plant.png` });
log('one-plant ink', await inkCount());

await page.locator('#tabs a', { hasText: 'Parameters' }).click();
log('param editors', await page.locator('.params input, .params select').count());
await page.selectOption('[aria-label="Parameter section"]', 'Leaves');
const before = await inkCount();
await page.locator('.params input[type="number"]').first().fill('2');
await page.locator('.params input[type="number"]').first().blur();
await settle();
log('edit param ink', `${before} -> ${await inkCount()}, changed title: ${(await page.locator('#title').textContent()).includes('changed')}`);
await page.screenshot({ path: `${shots}/3-parameters.png` });

await page.locator('#tabs a', { hasText: 'Age' }).click();
await page.locator('input[aria-label="Age"]').fill('20');
await settle();
log('age 20', await page.locator('#statusPlant').textContent());
await page.screenshot({ path: `${shots}/4-age.png` });
await page.locator('#animate').click();
await page.waitForTimeout(500);
await page.keyboard.press('Space');
log('animate stopped at', await page.evaluate(() => [window.plantStudio.firstSelected().age, window.plantStudio.animation]));

for (const tab of ['Stats', 'Note', 'Arrangement']) {
  await page.locator('#tabs a', { hasText: tab }).click();
  log(`tab ${tab}`, (await page.locator('#panel').innerText()).replace(/\s+/g, ' ').slice(0, 70));
}

await page.locator('[data-view="all"]').click();
await settle();
for (const mode of ['Bounding Boxes', 'Wire Frames', 'Solids']) {
  await openMenu('Options', 'Draw Using', mode);
  await settle();
  log(`draw ${mode}`, await inkCount());
  await page.screenshot({ path: `${shots}/5-${mode.replace(' ', '')}.png` });
}

await page.locator('#plantList li', { hasText: /^Pink daisy$/ }).click();
const box = await page.locator('#canvas').boundingBox();
const baseBefore = await page.evaluate(() => ({ ...window.plantStudio.firstSelected().basePoint_mm }));
const spot = await page.evaluate(() => {
  const { owners, width } = window.plantStudio.view.raster;
  const want = window.plantStudio.plants.indexOf(window.plantStudio.firstSelected()) + 1;
  const index = owners.indexOf(want);
  return { x: index % width, y: Math.floor(index / width) };
});
await page.mouse.move(box.x + spot.x, box.y + spot.y);
await page.mouse.down();
await page.mouse.move(box.x + spot.x + 30, box.y + spot.y + 10);
await page.mouse.up();
log('drag moved', JSON.stringify([baseBefore, await page.evaluate(() => window.plantStudio.firstSelected().basePoint_mm)]));

await page.locator('[data-tool="rotate"]').click();
await page.mouse.move(box.x + spot.x + 30, box.y + spot.y + 10);
await page.mouse.down();
await page.mouse.move(box.x + spot.x + 60, box.y + spot.y + 10);
await page.mouse.up();
log('rotated x', await page.evaluate(() => window.plantStudio.firstSelected().xRotation));
await page.locator('[data-tool="drag"]').click();

await openMenu('Plant', 'Breed');
await page.waitForSelector('.dialog .generation:nth-child(2) canvas');
log('breeder thumbs', await page.locator('.thumb').count());
await page.locator('.generation:nth-child(2) .thumb').nth(1).click();
await page.locator('.generation:nth-child(2) .thumb').nth(3).click();
await page.locator('.dialog-buttons button', { hasText: 'Breed' }).click();
await page.waitForSelector('.dialog .generation:nth-child(3) canvas');
await page.screenshot({ path: `${shots}/6-breeder.png` });
await page.locator('.generation:nth-child(3) .thumb').first().click();
const countBefore = await page.evaluate(() => window.plantStudio.plants.length);
await page.locator('.dialog-buttons button', { hasText: 'Send to Main' }).click();
log('sent to main', `${countBefore} -> ${await page.evaluate(() => window.plantStudio.plants.length)}`);
await page.locator('.dialog [aria-label="Close"]').click();

const [saved] = await Promise.all([page.waitForEvent('download'), openMenu('File', 'Save As...')]);
const savedPath = `${shots}/saved.pla`;
await saved.saveAs(savedPath);
await page.locator('#fileInput').setInputFiles({ name: 'roundtrip.pla', mimeType: 'text/plain', buffer: readFileSync(savedPath) });
await page.waitForFunction(() => document.title.startsWith('roundtrip'));
await settle();
log('reopened saved file', `${await page.evaluate(() => window.plantStudio.plants.length)} plants, ${await inkCount()} ink`);

const [png] = await Promise.all([page.waitForEvent('download'), openMenu('File', 'Export', 'Bitmap')]);
log('png export', png.suggestedFilename());

await openMenu('Help', 'About');
await page.waitForSelector('.dialog img.splash');
await page.waitForTimeout(150);
await page.screenshot({ path: `${shots}/7-about.png` });
await page.locator('.dialog-buttons button', { hasText: 'OK' }).click();

const frame = () => page.evaluate(() => {
  const { left, top, width, height } = document.getElementById('appWindow').getBoundingClientRect();
  return { left, top, width, height };
});
const dragBy = async (locator, dx, dy) => {
  const handle = await locator.boundingBox();
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await settle();
};
await page.locator('[data-area="side"]').click();
await settle();
await page.screenshot({ path: `${shots}/8-area-side.png` });
await page.locator('[data-area="top"]').click();
await settle();
log('window at start', JSON.stringify(await frame()));
log('body background', await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
await page.screenshot({ path: `${shots}/10-centered.png` });
const canvasBefore = await page.evaluate(() => document.getElementById('canvas').width);
await dragBy(page.locator('#resizeGrip'), -200, -150);
log('after shrink', JSON.stringify(await frame()));
log('canvas followed', `${canvasBefore} -> ${await page.evaluate(() => document.getElementById('canvas').width)}`);
await dragBy(page.locator('#appTitleBar .title-bar-text'), -120, 40);
log('after drag', JSON.stringify(await frame()));
await page.screenshot({ path: `${shots}/11-moved.png` });
await dragBy(page.locator('#resizeGrip'), 5000, 5000);
log('grow to edge', JSON.stringify(await frame()));
await dragBy(page.locator('#resizeGrip'), -5000, -5000);
log('shrink to minimum', JSON.stringify(await frame()));
await dragBy(page.locator('#appTitleBar .title-bar-text'), 5000, 5000);
log('dragged off corner', JSON.stringify(await frame()));
await page.setViewportSize({ width: 800, height: 600 });
await page.waitForTimeout(100);
log('viewport shrunk', JSON.stringify(await frame()));
await page.setViewportSize({ width: 1200, height: 800 });
await page.locator('.menubar > .menu > button', { hasText: /^Help$/ }).dispatchEvent('click');
await page.locator('.menu-items button:visible', { hasText: /^About/ }).click();
const dialogBefore = await page.locator('.dialog').boundingBox();
await dragBy(page.locator('.dialog .title-bar-text'), 60, 30);
const dialogAfter = await page.locator('.dialog').boundingBox();
log('dialog drag', `${Math.round(dialogAfter.x - dialogBefore.x)}, ${Math.round(dialogAfter.y - dialogBefore.y)}`);
await page.locator('.dialog-buttons button', { hasText: 'OK' }).click();

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
await settle();
log('phone overflow px', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
await page.screenshot({ path: `${shots}/9-phone.png` });

log('ERRORS', errors.length ? `\n${errors.join('\n')}` : 'none');
await browser.close();
