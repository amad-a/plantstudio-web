"""Copy the model files of the upstream Python port, patched to run on Python 3
with Pascal's semantics. Treats them as text; nothing here imports them."""
import re, sys

src, dst = sys.argv[1], sys.argv[2]
for name in 'conversion_common delphi_compatability urandom umath u3dsupport utdo utravers upart uintern uleaf umerist uinflor ufruit uturtle uplant usstream'.split():
    s = open(f'{src}/{name}.py', encoding='latin1').read()
    s = re.sub(r'\b(\d+)L\b', r'\1', s)
    s = re.sub(r'except (\w+(?:\.\w+)?), (\w+):', r'except \1 as \2:', s)
    s = re.sub(r'^(\s*)print (.*)$', r'\1print(\2)', s, flags=re.M)
    s = s.replace('\t', '        ')
    s = re.sub(r'`(\w+)`', r'repr(\1)', s)
    # Pascal's div, which Python 2's / was standing in for
    s = s.replace('turnPortion = 256 / ', 'turnPortion = 256 // ')
    s = s.replace('rotateX(256 / numParts)', 'rotateX(256 // numParts)')
    if name == 'conversion_common':
        s = s.replace('return x % 32768', 'return ((x + 32768) % 65536) - 32768')
    if name == 'urandom':
        s = s.replace(
            'result = (umath.max(0.0, (umath.min(1.0, (self.seed * 0.0000000004656612875))))) * 1.0',
            'import struct\n        result = struct.unpack("f", struct.pack("f", umath.max(0.0, umath.min(1.0, self.seed * 0.0000000004656612875))))[0]')
    open(f'{dst}/{name}.py', 'w').write(s)
print('prepared')
