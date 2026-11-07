"""Round-3 infantry / anti-air spec changes (H01, T01, A01, T02 and the new A06 Halo), applied to the game's source spec
units/sandbox/data/unit_specs.json. Idempotent. units/sandbox/build_assets.py copies the pack's units/data/unit_specs.json over
that file on every run, which drops these changes: re-run this after build_assets.py, then python3 play/build.py.
Usage: python3 tools/round3_spec_patch.py [path-to-unit_specs.json]"""
import json, sys
P = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/thunderhead/units/sandbox/data/unit_specs.json'
d = json.load(open(P)); U = {u['id']: u for u in d['units']}

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
# T02 Disruptor (game name Nullifier): a real anti-air lance
t = U['T02']; t['weapons'][1].update(damage=50, cycle_s=2, range_m=45, projectile_speed_mps=110, turn_deg_s=260)
t['movement'] = t['movement'].replace('AA and ground weapons share a 2 s firing lock.', 'AA and ground weapons share one firing lock (ground lance 2 s, AA lance 2 s).')
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
 'silhouette': 'Low faceted six-wheel carrier with a tall slim turret mast carrying two coil-laser emitters side by side; reads as a vertical antenna stack, never as a tank gun.',
 'views': [
  'Front: narrow wedge nose, slit sensor bar, twin emitter barrels stacked on the mast either side of a central radar lens.',
  'Back: power-cell bay with magenta coolant glow, two heat vents, tow eye.',
  'Side: six road wheels in armoured skirts, mast set just behind mid-hull, emitters pitched up at rest.',
  'Top: hexagonal turret ring, mast footprint and the flat rotating radar plate on the turret roof.'],
 'wear': 'Black-glass panels with clean edges, brushed titanium mast, light road dust on the skirts; emitter tips heat-tinted.',
 'weapon_visual': 'Two 1.4 m coil-laser emitters on one pitch yoke ("barrel"), one muzzle socket each ("muzzle_0" left, "muzzle_1" right); they fire alternately.',
 'projectile_visual': 'Instant gameplay hit. Thin 0.05 s magenta-white beam per shot from the firing emitter, small spark on the target; ground mode uses the same beam at a lower rate.',
 'ability': 'No manual ability. Prefers aircraft: the air target always wins over a ground one. Ground mode (infantry and light vehicles only, 30 m) is a weak self-defence fallback.',
 'movement': 'Acceleration 5 m/s2; hull turn 80 deg/s; turret 160 deg/s, emitter pitch -5 to +80 degrees at 90 deg/s. Fires while moving, aim tolerance 6 degrees.',
 'rig': "Rigid hull root 'body', turret yaw node 'turret', emitter pitch node 'barrel' (child of turret), muzzle sockets 'muzzle_0' and 'muzzle_1' (children of barrel), hit socket 'hit'.",
 'animations': [
  'Drive: wheels rotate, light suspension motion.',
  'Turn: skid-steer pivot in place like the tracked units.',
  'Fire: emitters alternate with a 0.03 m kick and a short coil glow pulse.',
  'Idle: mast scans slowly with emitters raised 30 degrees.',
  'Death 1.2 s: power-cell flash, mast topples; no damaging secondary explosion.'],
 'geometry': 'Mast and emitters must stay readable from the default RTS camera; keep the barrels thick enough to survive LOD reduction.',
 'pivots': "Ground hull root 'body'; 'turret' at the turret ring centre; 'barrel' at the emitter yoke trunnions; 'muzzle_0' / 'muzzle_1' at the emitter tips.",
 'budget': [14000, 6500, 1700, 3, 2048],
 'counter': 'Hard counter to helicopters, drones and jets; loses to anything that shoots ground targets (tanks, rockets, rifles at close range).',
 'production': 'War factory; no additional tech. Helix has no rocket infantry: this is its anti-air.',
 'sfx': 'High electric whine on spin-up, crisp alternating zaps, coolant hiss.',
 'faction_name': 'VANGUARD ALLIANCE', 'unit_file': 'A06_Halo_AA_Carrier',
 'collision_shape': {'type': 'horizontal_capsule', 'radius_m': 1.4, 'total_length_m': 4.7, 'height_m': None, 'ground_blocking': True},
 'visual_reference': None, 'visual_state': 'New unit (round 3); model in progress',
}
dps_block(A06)
if 'A06' in U: d['units'][[u['id'] for u in d['units']].index('A06')] = A06
else: d['units'].insert([u['id'] for u in d['units']].index('A05') + 1, A06)
json.dump(d, open(P, 'w'), indent=2, ensure_ascii=True)
print('applied to', P)
