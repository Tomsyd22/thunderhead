"""Round-3 infantry / anti-air spec changes (H01 Conscript, T01 Pulse Trooper, A01 Ranger machine gun, T02 Disruptor AA lance
and the new A06 Halo Anti-Air Carrier). Idempotent. Writes the SOURCE spec units/data/unit_specs.json (units/sandbox/
build_assets.py copies it over units/sandbox/data/unit_specs.json on every asset build), the matching rows of
units/data/balance_roster.csv (units/sandbox/test_mech.mjs checks the spec's weapons against it) and the sandbox copy.
Then run python3 play/build.py.   Usage: python3 tools/round3_spec_patch.py"""
import json, csv, io, shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
P = ROOT / 'units' / 'data' / 'unit_specs.json'
d = json.loads(P.read_text()); U = {u['id']: u for u in d['units']}

def dps_block(u):
    out = []
    for w in u['weapons']:
        base = round(w['damage'] * w['burst'] / w['cycle_s'], 2)
        out.append({'weapon': w['name'], 'base_dps': base, 'effective_dps': {k: round(base * v, 2) for k, v in w['multipliers'].items()}})
    u['weapons_dps'] = out

# H01 Conscript: a true cheap rifleman (RA2): less health, less damage, same $100
h = U['H01']; h['health'] = 90; h['weapons'][0].update(damage=9, cycle_s=0.82)
# T01 Pulse Trooper: $250 -> $150 (playtester proposal)
U['T01']['cost'] = 150
# A01 Ranger: deployed machine gun 15 / 0.45 s -> 13 / 0.46 s
U['A01']['weapons'][1].update(damage=13, cycle_s=0.46)
# T02 Disruptor (game name Nullifier): a real anti-air lance (20 -> 50 damage per 2 s, 38 -> 45 m, faster bolt)
t = U['T02']; t['weapons'][1].update(damage=50, cycle_s=2, range_m=45, projectile_speed_mps=110, turn_deg_s=260)
for k in ('H01', 'A01', 'T02'): dps_block(U[k])

A06 = {
 'id': 'A06', 'name': 'Halo Anti-Air Carrier', 'faction': 'A', 'category': 'Anti-air vehicle',
 'role': 'Mobile air defence: shreds aircraft, barely scratches ground targets',
 'dimensions_m': {'length': 7.2, 'width': 3.2, 'height': 3.0},
 'health': 400, 'armor': 'light', 'cost': 650, 'build_seconds': 16, 'speed_mps': 11, 'sight_m': 56, 'collision_radius_m': 1.4, 'tier': 1,
 'weapons': [
  {'name': 'Twin coil-laser - air', 'kind': 'hitscan', 'damage': 12, 'cycle_s': 0.2, 'burst': 1, 'burst_gap_s': 0, 'targets': ['air'],
   'multipliers': {'air': 1}, 'projectile_speed_mps': 0, 'splash_radius_m': 0, 'splash_edge_multiplier': 1, 'minimum_range_m': 0, 'range_m': 50},
  {'name': 'Coil-laser - ground', 'kind': 'hitscan', 'damage': 6, 'cycle_s': 0.5, 'burst': 1, 'burst_gap_s': 0, 'targets': ['infantry', 'light'],
   'multipliers': {'infantry': 0.5, 'light': 0.4}, 'projectile_speed_mps': 0, 'splash_radius_m': 0, 'splash_edge_multiplier': 1, 'minimum_range_m': 0, 'range_m': 30},
 ],
 'silhouette': 'Low faceted six-wheel carrier with a turret carrying two long coil-laser emitters side by side; reads as an anti-air mount, never as a tank gun.',
 'views': [
  'Front: narrow wedge nose, slit sensor bar, twin emitters either side of the turret face.',
  'Back: power-cell bay with magenta coolant glow, two heat vents, tow eye.',
  'Side: six road wheels in armoured skirts, turret just behind mid-hull, emitters level at rest.',
  'Top: hexagonal turret ring, emitter yoke and the radar plate on the turret.'],
 'wear': 'Black-glass panels with clean edges, brushed titanium emitters, light road dust on the skirts; emitter tips heat-tinted.',
 'weapon_visual': 'Two coil-laser emitters (2.95 m from trunnion to muzzle) on one pitch yoke ("gun") with a recoil node; one muzzle socket each ("muzzle_0" left, "muzzle_1" right); they fire alternately.',
 'projectile_visual': 'Instant gameplay hit. Thin 0.05 s magenta-white beam per shot from the firing emitter, small spark on the target; ground mode uses the same beam at a lower rate.',
 'ability': 'No manual ability. Prefers aircraft: an air target always wins over a ground one. Ground mode (infantry and light vehicles only, 30 m) is a weak self-defence fallback.',
 'movement': 'Acceleration 5 m/s2; hull turn 80 deg/s; turret 160 deg/s, emitter pitch -5 to +80 degrees at 90 deg/s. Fires while moving, aim tolerance 6 degrees.',
 'rig': "root > 'body' (hull) > 'turret' (yaw) > 'gun' (emitter pitch, level at 0) > 'recoil' > muzzle sockets 'muzzle_0' (left) and 'muzzle_1' (right); wheels 'wheel_L_0'..'wheel_L_2' and 'wheel_R_0'..'wheel_R_2' (r 0.56 m); 'radar' on the turret (cosmetic).",
 'animations': [
  'Drive: six wheels roll (r 0.56 m), light suspension motion.',
  'Turn: skid-steer pivot in place like the tracked units.',
  'Fire: emitters alternate with a 0.03 m kick on the recoil node and a short coil glow pulse.',
  'Idle: emitters level (pitch 0); any raised idle pose comes from the view, not the model.',
  'Death 1.2 s: power-cell flash; no damaging secondary explosion.'],
 'geometry': 'Emitters must stay readable from the default RTS camera; keep them thick enough to survive LOD reduction.',
 'pivots': "Ground root; hull 'body'; 'turret' at the ring centre; 'gun' at the emitter yoke trunnions; 'muzzle_0' / 'muzzle_1' at the emitter tips (sockets.json: turret [0, -0.8, 1.66], gun [0, 0.15, 0.96], muzzles [-/+0.84, 2.95, 0], hitZ 1.3).",
 'budget': [16000, 7500, 1900, 3, 2048],
 'counter': 'Hard counter to helicopters, drones and jets; loses to anything that shoots ground targets (tanks, rockets, rifles at close range).',
 'production': 'War factory; no additional tech. Helix has no rocket infantry: this is its anti-air.',
 'sfx': 'High electric whine on spin-up, crisp alternating zaps, coolant hiss.',
 'faction_name': 'VANGUARD ALLIANCE', 'unit_file': 'A06_Halo_AA_Carrier',
 'collision_shape': {'type': 'horizontal_capsule', 'radius_m': 1.4, 'total_length_m': 4.7, 'height_m': None, 'ground_blocking': True},
 'visual_reference': None, 'visual_state': 'New unit (round 3); modelled (units/out/A06.glb)',
}
dps_block(A06)
if 'A06' in U: d['units'][[u['id'] for u in d['units']].index('A06')] = A06
else: d['units'].insert([u['id'] for u in d['units']].index('A05') + 1, A06)
P.write_text(json.dumps(d, indent=2, ensure_ascii=True))
shutil.copy(P, ROOT / 'units' / 'sandbox' / 'data' / 'unit_specs.json')

# balance roster rows (cols: 4 cost, 5 HP, 10 weapon, 11 damage, 12 burst, 13 cycle, 14 base DPS, 15-20 DPS by class, 21 range)
R = ROOT / 'units' / 'data' / 'balance_roster.csv'; rows = list(csv.reader(io.StringIO(R.read_bytes().decode(), newline='')))
CLS = ['infantry', 'light', 'heavy', 'building', 'air', 'naval']
f = lambda x: f'{round(x, 2):.1f}' if round(x, 2) == round(x, 1) else str(round(x, 2))
for r in rows[1:]:
    if r[0] not in ('H01', 'T01', 'A01', 'T02'): continue
    u = U[r[0]]; r[4] = str(u['cost']); r[5] = str(u['health'])
    w = next(x for x in u['weapons'] if x['name'] == r[10]); base = w['damage'] * w['burst'] / w['cycle_s']
    r[11] = str(w['damage']); r[13] = str(w['cycle_s']); r[14] = f(base); r[21] = str(w['range_m'])
    for k, c in enumerate(CLS): r[15 + k] = f(base * w['multipliers'][c]) if c in w['multipliers'] else '-'
out = io.StringIO(); csv.writer(out, lineterminator='\r\n').writerows(rows); R.write_bytes(out.getvalue().encode())
print('applied to', P, '+ units/sandbox/data/unit_specs.json + units/data/balance_roster.csv')
