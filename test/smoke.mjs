import { readFileSync, readdirSync } from 'node:fs';
import { parsePlantFile } from '../src/model/plant.js';
import { Turtle, DRAW_MODES } from '../src/model/turtle.js';
import { Raster, RasterSurface } from '../src/model/surface.js';
for (const f of readdirSync('data').filter(n=>n.endsWith('.pla'))) {
  const t0=performance.now();
  const file = parsePlantFile(readFileSync('data/'+f,'latin1'));
  const r=new Raster(600,600), s=new RasterSurface(r), t=new Turtle(s);
  const rows=file.plants.map(p=>{ const age=p.age; p.setAge(p.pGeneral.ageAtMaturity); const b=p.measure(1,300,590); r.clear(0xffffff); p.drawOn(t,DRAW_MODES.solids,1,300,590); return `${p.name}@${age}/${p.pGeneral.ageAtMaturity}:${p.partsCreated}p ${b.right-b.left}x${b.bottom-b.top} d${t.depth}`});
  console.log(f, file.plants.length, Math.round(performance.now()-t0)+'ms', 'offset',file.offset_mm,'scale',file.scale,'conc',file.concentrated); console.log('  '+rows.join('\n  '));
}
