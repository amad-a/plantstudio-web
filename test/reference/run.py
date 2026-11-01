"""Grow every plant in spec.json with the patched Python port and record what it draws.

This runs code from github.com/pdfernhout/PlantStudio, so read it before you run it.

  git clone https://github.com/pdfernhout/PlantStudio upstream
  mkdir py
  python3 -I test/reference/prep.py upstream/for-olpc-python py
  node test/dump-for-diff.mjs spec.json          # add --posed to test poses
  python3 -I test/reference/run.py spec.json reference.json py
  node test/diff-against-reference.mjs spec.json reference.json
"""
import json, sys, types

sys.path.insert(0, sys.argv[3])


class Stub:
    def __init__(self, *args, **kwargs): pass
    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        return Stub()
    def __call__(self, *args, **kwargs): return Stub()
    def __bool__(self): return False
    def __eq__(self, other): return False
    def __hash__(self): return 1
    def __index__(self): return 0
    def __add__(self, other): return ''
    __radd__ = __add__


class StubModule(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        if name.startswith('k'):  # constants, such as u3dexport.kScreen
            return 0
        return Stub()


for name in 'gtk pygtk ucursor udebug ufiler ubitmap ubmpsupport uamendmt uparams utransfr udomain usupport u3dexport udrawingsurface gtkdrawingsurface gtk_helpers umakepm uexcept uwait umain ucollect'.split():
    sys.modules[name] = StubModule(name)


class ListCollection(list):
    def Add(self, item): self.append(item)
    def Remove(self, item): self.remove(item)
    def clear(self): del self[:]


sys.modules['ucollect'].TListCollection = ListCollection
sys.modules['ufiler'].PdStreamableObject = object


class Options:
    showPosingAtAll = True
    showGhostingForHiddenParts = False
    showHighlightingForNonHiddenPosedParts = False
    ghostingColor = 192 | (192 << 8) | (192 << 16)
    nonHiddenPosedColor = 255 << 16
    selectedPosedColor = 255
    maxPartsPerPlant_thousands = 10


class Domain:
    options = Options()
    drawingToMakeCopyBitmap = True


class Amendment:
    def __init__(self, fields):
        self.__dict__.update(fields)


sys.modules['udomain'].domain = Domain()
sys.modules['udomain'].kLowMutation = 20
sys.modules['usupport'].darkerColor = lambda c: (
    max(0, (c & 255) - 10) | (max(0, ((c >> 8) & 255) - 10) << 8) | (max(0, ((c >> 16) & 255) - 10) << 16))

import u3dsupport, uplant, uturtle, utdo  # noqa: E402


class RecordingSurface:
    def __init__(self):
        self.out = []
        self.foreColor = self.backColor = self.lineColor = 0
        self.lineWidth = 1.0
        self.pending = None
        self.drawingContext = None

    def initialize(self): pass

    def drawLineFromTo(self, a, b):
        self.out.append(['L', a.x, a.y, a.z, b.x, b.y, b.z, self.lineColor, self.lineWidth])

    def allocateTriangle(self):
        self.pending = u3dsupport.KfTriangle()
        return self.pending

    def drawLastTriangle(self):
        p = self.pending.points
        self.out.append(['T', p[0].x, p[0].y, p[0].z, p[1].x, p[1].y, p[1].z, p[2].x, p[2].y, p[2].z, self.foreColor, self.backColor])


def assign(target, data):
    for key, value in data.items():
        current = getattr(target, key, None)
        if isinstance(value, dict) and 'points' in value:
            tdo = utdo.KfObject3D()
            tdo.name = value['name']
            for x, y, z in value['points']:
                point = u3dsupport.KfPoint3D()
                point.x, point.y, point.z = x, y, z
                tdo.points.append(point)
            for a, b, c in value['triangles']:
                tdo.triangles.append(utdo.KfIndexTriangle().createABC(a, b, c))
            setattr(target, key, tdo)
        elif isinstance(value, dict):
            assign(current, value)
        elif isinstance(value, list) and value and isinstance(value[0], dict):
            for child, childData in zip(current, value):
                assign(child, childData)
        else:
            setattr(target, key, value)


results = []
for spec in json.load(open(sys.argv[1])):
    plant = uplant.PdPlant()
    assign(plant, spec['params'])
    plant.amendments = ListCollection(Amendment(fields) for fields in spec.get('amendments', []))
    for age, mode in [(age, mode) for age in spec['ages'] for mode in spec.get('modes', ['output'])]:
        # output: hidden parts vanish and nothing is highlighted. screen: ghosts and highlights.
        Domain.drawingToMakeCopyBitmap = mode == 'output'
        Options.showGhostingForHiddenParts = mode == 'screen'
        Options.showHighlightingForNonHiddenPosedParts = mode == 'screen'
        plant.age = age
        plant.finishLoadingOrDefaulting(False)
        surface = RecordingSurface()
        turtle = uturtle.KfTurtle()
        turtle.drawingSurface = surface
        turtle.drawOptions.sortPolygons = True
        turtle.drawOptions.sortTdosAsOneItem = True
        turtle.reset()
        turtle.setScale_pixelsPerMm(1.0)
        turtle.xyz(0, 0, 0)
        plant.turtle = turtle
        plant.draw()
        plant.turtle = None
        results.append({'file': spec['file'], 'name': spec['name'], 'mode': mode, 'amendments': spec.get('amendments', []), 'age': plant.age, 'parts': plant.partsCreated, 'seed': plant.randomNumberGenerator.seed, 'out': surface.out})
json.dump(results, open(sys.argv[2], 'w'))
print(len(results), 'renders')
