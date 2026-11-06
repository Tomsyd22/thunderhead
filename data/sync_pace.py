"""Copy the shared pace model (data/pace.js, data/pace.json) into the Map Lab and the Unit Sandbox.
Run after editing either source file: python3 data/sync_pace.py   (add --check to only verify the copies match)."""
import shutil, sys, filecmp
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
DEST = [(ROOT / 'maps/lab/pace.js', ROOT / 'maps/lab/data/pace.json'), (ROOT / 'units/sandbox/pace.js', ROOT / 'units/sandbox/data/pace.json')]
bad = []
for js, jn in DEST:
    for src, dst in ((ROOT / 'data/pace.js', js), (ROOT / 'data/pace.json', jn)):
        if '--check' in sys.argv:
            if not dst.exists() or not filecmp.cmp(src, dst, shallow=False): bad.append(str(dst.relative_to(ROOT)))
        else: dst.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(src, dst); print('synced', dst.relative_to(ROOT))
if bad: print('OUT OF SYNC:', bad); sys.exit(1)
