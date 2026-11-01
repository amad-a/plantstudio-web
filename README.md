# PlantStudio for the web

A browser port of PlantStudio Botanical Illustration Software 2.10 (2002), by Cynthia F. Kurtz
and Paul D. Fernhout. Plants grow from the original simulation and draw with hard-edged
Win98-style pixels, in an interface built with [98.css](https://jdan.github.io/98.css/).

**Try it at [palestineonline.net/plant](https://palestineonline.net/plant/).** To run your own copy:

```sh
python3 -m http.server 8123 --bind 127.0.0.1   # then open http://127.0.0.1:8123
```

It's static files with no build step. It has to be served over HTTP because ES modules don't
load from `file://`.

## How it was made

The starting point was `kfps210.exe`, and the plan was to decompile it. That turned out not to
be needed.

### 1. Identify the file, without running it

`file` says it's a PE32 executable, but the `MZP` header and strings like `TObject` show a
Delphi stub, and "The setup files are corrupted" shows it's an installer. The real program is
inside it. The marker `i108g32` and `rDlPtS` make it a very old Inno Setup, too old for
`innoextract`, which reports "Not a supported Inno Setup installer!".

### 2. Unpack it by hand

Inno stores its files as zlib streams with a `zlb\x1a` header, so a short Python script finds
each marker and inflates what follows. All 23 chunks came out intact: three executables, the
license, the readme, the help contents, 13 `.pla` plant files and a parameter hints page.

### 3. Look for the source before decompiling

The readme names the program, and the authors later published the source at
[github.com/pdfernhout/PlantStudio](https://github.com/pdfernhout/PlantStudio) under GPL v3 or
later. This matters twice. The 2002 license in the installer forbids reverse engineering and
derivative works, and Delphi decompilers recover forms and class names but not method bodies.
The published source has neither problem, so nothing here was decompiled.

Always check for this first. Old freeware is often better preserved than it looks.

### 4. Pick the source of truth

The repo has the Delphi source and the authors' automatic translations to Python and Java.
The Python is much easier to read, but it isn't the same program: Delphi's `round` is banker's
rounding, `/` between integers means something else in Python 2, and `div` got lost in
translation. So the Pascal decided every question, and the Python served as a map.

### 5. Port the engine

| Original | Here | Job |
|---|---|---|
| `urandom`, `umath`, `usupport`, `utravers` | `src/model/support.js` | RNG, S-curves, colors |
| `u3dsupport`, `uturtle` | `src/model/turtle.js` | 3D turtle with 256-step angles |
| `utdo` | `src/model/tdo.js` | Triangle meshes for leaves and petals |
| `upart`, `uintern`, `uleaf`, `umerist`, `uinflor`, `ufruit` | `src/model/parts.js` | The growing plant |
| `uplant`, `ubreedr` | `src/model/plant.js` | Daily growth, `.pla` files, breeding |
| `udrawingsurface` | `src/model/surface.js` | Polygon sorting and drawing |
| `Parameters.tab` | `src/model/params.js` (generated) | All 352 parameters |

Plants are grown from a stored random seed, so **the order of every random call is part of the
file format**. Change one and a saved plant grows into a different shape. Some oddities in the
original are kept on purpose, with a comment at each one, because the shipped plants were
tuned against them: flowers age twice a day, biomass reductions never run, and a "no bud"
flower leaves the turtle stack one level deep.

Windows GDI is replaced by a small software rasterizer. A browser canvas would antialias
everything, and those hard edges are much of the look.

### 6. Check it against something other than your eyes

A typo in the port doesn't crash. It just grows a slightly different plant. So `test/reference/`
runs the authors' Python on Python 3, patched to Pascal's semantics, and `test/` compares every
line and triangle with this port at three ages for each of the 60 bundled plants.

The first run matched 14 of 131 drawings. Pascal re-reads a branch slot after visiting it,
because a bud can replace itself with a new stem mid-walk, and the port had kept the old
reference. After that one fix, **131 of 131 drawings match across 371,257 primitives**.

### 7. Rebuild the interface

`Umain.lfm` and `ubreedr.lfm` give the original window's menus, tabs and controls, and the
toolbar bitmaps are the originals. 98.css has no menu bar, so `style.css` adds one.
Everything is ordinary HTML, so it also works on a phone.

## What's in, and what's not

Ported: the 7 plant libraries, all parameters and sections, the life cycle graph and animation,
the Breeder, Time Series, the Plant Wizard, posing, the 3D Object Editor, arranging and aligning
plants, the drag, scroll, rotate, magnify and pose tools, boxes, wire frames and solids, stats,
notes, opening and saving `.pla` files, PNG and OBJ export, and printing.

Not ported:

- Undo in the main window. The 3D Object Editor has its own undo.
- The other 3D export formats (DXF, 3DS, LWO, VRML, POV), and reading or writing DXF in the editor.
- The Plant Mover, 3D Object Mover, Painter nozzles and animation files.

The six tutorial files aren't included because they exist only in the 2002 installer, which is
not GPL. The seven libraries come from the GPL repo.

Deliberate differences from the original:

- OBJ files are in millimeters. The original mixed millimeters for position with zoomed pixels
  for size, so an arrangement's export depended on the window's zoom.
- OBJ materials are named by color rather than by plant part, and a selection or all visible
  plants are exported with fixed settings instead of through the export options dialog.
- Clicking a plant part picks what's visibly on top, from a per-pixel buffer. The original
  tested polygons in sorted order.
- Wizard answers last until the page reloads. The original saved them in its settings file.

Limits on accuracy:

- The growth and drawing engine is checked against the patched Python, not the original Windows
  program.
- Delphi evaluates some math in 80-bit floats and stores 32-bit ones, where JavaScript uses
  64-bit throughout, so an angle right on a rounding boundary could occasionally differ by one
  step from the Windows version.
- The reference comparison also covers posing: 262 of 262 drawings match with generated poses,
  in both output and on-screen modes. Its picking, tab and file handling have behavior tests.
- OBJ export, the wizard and the breeder are ported from the Pascal and have behavior tests,
  but no reference run behind them, and OBJ files haven't been opened in a 3D program.

## Tests

```sh
node test/smoke.mjs        # every plant grows and draws
node test/roundtrip.mjs    # saving and copying change nothing
node test/features.mjs     # posing, OBJ export, wizard logic, 3D object edits
node test/browser-check.mjs http://127.0.0.1:8123 /tmp/shots      # the main window in real Chrome
node test/browser-features.mjs http://127.0.0.1:8123 /tmp/shots   # the feature windows in real Chrome
```

The browser tests import Playwright from a local path; change that line to match your machine.
To repeat the reference comparison, see the steps at the top of `test/reference/run.py`. It
runs third-party code from the upstream repo, so read it first.

## License

GPL v3 or later, as required by the original source; see `COPYING` and `LICENSE-upstream.txt`.
The source is copyright 1993-2011 Cynthia F. Kurtz and Paul D. Fernhout. "PlantStudio" is their
trademark, which they permit for derivatives that are open and properly attributed.
98.css is MIT licensed; see `vendor/98.css/LICENSE`.
