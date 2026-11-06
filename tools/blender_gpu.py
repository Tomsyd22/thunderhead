"""Render device for every Thunderhead Blender scene (decided 2026-11-06): GPU compute.
On Tom's MacBook Air (M1) that is Metal; elsewhere OptiX / CUDA / HIP / oneAPI when present. Machines without a GPU
backend (the cloud VM) keep the scenes set to GPU and Cycles renders them on the CPU instead.

Generators call use_gpu(scene) right after choosing Cycles. Run as a script to set it in existing .blend files:
  blender -b --python tools/blender_gpu.py -- file.blend [more.blend ...]      (or bpy's python: python tools/blender_gpu.py files...)
"""
import sys

BACKENDS = ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI')


def enable_gpu_backend():
    """Pick the first GPU backend this machine has and enable only its devices. Returns its name or None."""
    import bpy
    try:
        cp = bpy.context.preferences.addons['cycles'].preferences
    except Exception:
        return None
    for t in BACKENDS:
        try:
            cp.compute_device_type = t
        except (TypeError, ValueError):
            continue                     # backend not compiled into this Blender
        try:
            cp.refresh_devices()
        except Exception:
            try: cp.get_devices()
            except Exception: pass
        gpus = [d for d in cp.devices if d.type == t]
        if gpus:
            for d in cp.devices: d.use = d.type == t
            return t
    try: cp.compute_device_type = 'NONE'
    except Exception: pass
    return None


def use_gpu(scene=None):
    """Set Cycles to GPU compute on `scene` (default: every scene) and enable this machine's GPU backend."""
    import bpy
    backend = enable_gpu_backend()
    for sc in ([scene] if scene is not None else list(bpy.data.scenes)):
        sc.cycles.device = 'GPU'
    return backend


def describe():
    """Human-readable render device, e.g. 'GPU · METAL · Apple M1 (GPU - 7 cores)' or 'CPU (no GPU backend)'."""
    import bpy
    try:
        cp = bpy.context.preferences.addons['cycles'].preferences; t = cp.compute_device_type
        on = [d.name for d in cp.devices if d.use and d.type == t] if t != 'NONE' else []
        if on: return f'GPU · {t} · ' + ', '.join(on)
    except Exception:
        pass
    import platform
    return f'CPU ({platform.processor() or platform.machine()}, {__import__("os").cpu_count()} threads; no GPU backend)'


def _set_in_files(paths):
    import bpy
    out = []
    for p in paths:
        raw = open(p, 'rb').read(7)
        compressed = raw != b'BLENDER'               # gzip / zstd containers start with their own magic
        bpy.ops.wm.open_mainfile(filepath=p, load_ui=False)
        before = {sc.name: sc.cycles.device for sc in bpy.data.scenes}
        use_gpu()
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=p, compress=compressed)
        out.append((p, before))
    return out


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    for p, before in _set_in_files([a for a in args if a.endswith('.blend')]):
        print('GPU', p, before)
