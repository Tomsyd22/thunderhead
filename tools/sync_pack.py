"""Pack the project for the Mac copy (~/Thunderhead): every file whose content changed since the last sync, as one tar
stream cut into 24 MB chunks in /mnt/user-data/outputs/sync/, plus the new manifest (path → size, sha1) at .sync/manifest.json.
  python3 tools/sync_pack.py [--full]
The Mac side unpacks with: cat .sync_in/part_* | tar -xf - -C ~/Thunderhead  (device shell), then clears .sync_in. Deleted files are listed in
deleted.txt; they are not removed on the Mac automatically."""
import hashlib, json, os, sys, tarfile, io
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent; OUT = Path('/mnt/user-data/outputs/sync'); MAN = ROOT / '.sync' / 'manifest.json'
SKIP_DIRS = {'__pycache__', '.git', 'node_modules'}; SKIP_FILES = {'index.local.html'}
full = '--full' in sys.argv
old = {} if full or not MAN.exists() else json.loads(MAN.read_text())
cur = {}
for dp, dns, fns in os.walk(ROOT):
    dns[:] = [d for d in dns if d not in SKIP_DIRS and not (Path(dp) == ROOT and d == '.sync')]
    for f in fns:
        if f in SKIP_FILES or f.endswith('.blend1'): continue
        p = Path(dp) / f; rel = str(p.relative_to(ROOT)); st = p.stat()
        o = old.get(rel)
        if o and o['size'] == st.st_size and o.get('mtime') == int(st.st_mtime): cur[rel] = o; continue
        h = hashlib.sha1(p.read_bytes()).hexdigest(); cur[rel] = {'size': st.st_size, 'mtime': int(st.st_mtime), 'sha1': h}
changed = sorted(r for r in cur if r not in old or old[r]['sha1'] != cur[r]['sha1'])
deleted = sorted(r for r in old if r not in cur)
OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob('part_*'): f.unlink()
MAN.parent.mkdir(exist_ok=True); MAN.write_text(json.dumps(cur, indent=0))
LIM = 24 * 1000 * 1000   # the device transfer takes files up to ~25 MB: one tar stream cut into 24 MB chunks
class Chunks(io.RawIOBase):
    def __init__(self): self.n = 0; self.f = None; self.left = 0; self.paths = []
    def writable(self): return True
    def write(self, b):
        b = memoryview(b); done = 0
        while done < len(b):
            if self.left == 0:
                if self.f: self.f.close()
                self.n += 1; path = OUT / f'part_{self.n:03d}'; self.paths.append(path); self.f = open(path, 'wb'); self.left = LIM
            k = min(self.left, len(b) - done); self.f.write(b[done:done + k]); done += k; self.left -= k
        return len(b)
    def close(self):
        if self.f: self.f.close(); self.f = None
        super().close()
W = Chunks(); tf = tarfile.open(fileobj=W, mode='w|')
for rel in changed + ['.sync/manifest.json']: tf.add(ROOT / rel, arcname=rel)
tf.close(); W.close(); parts = W.paths
(OUT / 'deleted.txt').write_text('\n'.join(deleted))
print(json.dumps({'files': len(cur), 'changed': len(changed), 'deleted': len(deleted), 'bytes': sum(cur[r]['size'] for r in changed), 'parts': len(parts), 'last_mb': round(parts[-1].stat().st_size / 1e6, 1)}))
