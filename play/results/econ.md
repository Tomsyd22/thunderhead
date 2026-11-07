# Economy balance (round 1 ore fields)

Game speed 2.4× · harvester 500 credits per load, loading 50 credits / game s · regrowth 5 % of that per field (2.5 / game s)

| map | start | home round trip (real s) | income, 1 harvester ($/real min) | 2 harvesters | patch moves per load |
|---|---|---|---|---|---|
| 01 | B1 | 27.3 | 1100 | 2400 | 3.0 |
| 01 | R1 | 29.0 | 1033 | 2200 | 3.0 |
| 02 | B1 | 23.7 | 1268 | 2000 | 3.8 |
| 02 | R1 | 23.1 | 1298 | 2000 | 3.6 |
| 03 | B1 | 25.7 | 1169 | 2400 | 3.3 |
| 03 | R1 | 26.7 | 1126 | 2200 | 3.0 |
| 04 | B1 | 25.8 | 1165 | 2000 | 3.8 |
| 04 | R1 | 26.6 | 1128 | 2000 | 4.5 |
| 05 | B1 | 23.7 | 1268 | 2000 | 3.4 |
| 05 | R1 | 23.0 | 1305 | 2000 | 3.6 |

| map | fields (kind: patches, ore) | 3 harvesters strip a home field in (real min) |
|---|---|---|
| 01 | B1-H1 home: 111, 20000<br>B1-H2 home: 99, 20000<br>R1-H1 home: 100, 20000<br>R1-H2 home: 117, 20000<br>E1 expansion: 116, 30000<br>E2 expansion: 130, 30000<br>C1 contested: 130, 40000<br>C2 contested: 132, 40000 | 6.2 (B1-H1) |
| 02 | B1-H1 home: 126, 20000<br>B1-H2 home: 119, 20000<br>B2-H1 home: 131, 20000<br>B2-H2 home: 125, 20000<br>R1-H1 home: 130, 20000<br>R1-H2 home: 131, 20000<br>R2-H1 home: 135, 20000<br>R2-H2 home: 138, 20000<br>E1 expansion: 125, 30000<br>E2 expansion: 131, 30000<br>E3 expansion: 133, 30000<br>E4 expansion: 133, 30000<br>C1 contested: 134, 40000<br>C2 contested: 132, 40000 | 5.9 (B1-H1) |
| 03 | B1-H1 home: 116, 20000<br>B1-H2 home: 107, 20000<br>R1-H1 home: 113, 20000<br>R1-H2 home: 116, 20000<br>E1 expansion: 113, 30000<br>E2 expansion: 130, 30000<br>C1 contested: 132, 40000<br>C2 contested: 132, 40000 | 6.1 (B1-H1) |
| 04 | B1-H1 home: 125, 20000<br>B1-H2 home: 130, 20000<br>B2-H1 home: 138, 20000<br>B2-H2 home: 123, 20000<br>R1-H1 home: 127, 20000<br>R1-H2 home: 132, 20000<br>R2-H1 home: 138, 20000<br>R2-H2 home: 131, 20000<br>E1 contested-expansion: 114, 35000<br>E2 contested-expansion: 124, 35000<br>E3 contested-expansion: 128, 35000<br>E4 contested-expansion: 133, 35000 | 6.3 (B1-H1) |
| 05 | B1-H1 home: 126, 20000<br>B1-H2 home: 121, 20000<br>B2-H1 home: 124, 20000<br>B2-H2 home: 128, 20000<br>R1-H1 home: 136, 20000<br>R1-H2 home: 130, 20000<br>R2-H1 home: 134, 20000<br>R2-H2 home: 132, 20000<br>E1 expansion: 133, 30000<br>E2 expansion: 137, 30000<br>E3 expansion: 130, 30000<br>E4 expansion: 133, 30000<br>C1 contested: 134, 40000<br>C2 contested: 132, 40000 | 5.8 (B1-H1) |

✓ 01: every deposit has an ore field around its rig — 8 fields, patches 99–132  
✓ 01 B1: round trip to the nearest home field in the 20–40 s band — 29.3, 26.8, 25.8 s real (first, from the bay: 27.0 s) · field B1-H1  
✓ 01 B1: a load comes from several patches, the harvester moving on by itself — 3.0 patch moves per load  
✓ 01 B1: two harvesters per refinery earn more than one — one $1100/min, two $2400/min (real minutes)  
✓ 01 R1: round trip to the nearest home field in the 20–40 s band — 30.1, 27.2, 29.8 s real (first, from the bay: 30.6 s) · field R1-H2  
✓ 01 R1: a load comes from several patches, the harvester moving on by itself — 3.0 patch moves per load  
✓ 01 R1: two harvesters per refinery earn more than one — one $1033/min, two $2200/min (real minutes)  
✓ 01: home round trips match across starts (within 10 %) — B1 27.3 s, R1 29.0 s  
✓ 01: three harvesters empty a home field, then move on to the next field by themselves — B1-H1 (20000) empty after 6.2 real min; next fields B1-H2; 0 idle events  
✓ 01: an empty field regrows at 5 % of the loading rate, from the rig outward — 2.50 credits / game s (want 2.50), regrown patches 5/111, mean distance 17 m vs field 23 m  
✓ 01: regrowth stops at the starting amount; slider at 0 stops it — 100 % of start after a long regrow at 4×  
✓ 02: every deposit has an ore field around its rig — 14 fields, patches 119–138  
✓ 02 B1: round trip to the nearest home field in the 20–40 s band — 22.4, 25.5, 24.8, 21.9 s real (first, from the bay: 22.4 s) · field B1-H1  
✓ 02 B1: a load comes from several patches, the harvester moving on by itself — 3.8 patch moves per load  
✓ 02 B1: two harvesters per refinery earn more than one — one $1268/min, two $2000/min (real minutes)  
✓ 02 R1: round trip to the nearest home field in the 20–40 s band — 22.8, 22.2, 22.9, 24.5 s real (first, from the bay: 23.2 s) · field R1-H2  
✓ 02 R1: a load comes from several patches, the harvester moving on by itself — 3.6 patch moves per load  
✓ 02 R1: two harvesters per refinery earn more than one — one $1298/min, two $2000/min (real minutes)  
✓ 02: home round trips match across starts (within 10 %) — B1 23.7 s, R1 23.1 s  
✓ 02: three harvesters empty a home field, then move on to the next field by themselves — B1-H1 (20000) empty after 5.9 real min; next fields B1-H2; 0 idle events  
✓ 02: an empty field regrows at 5 % of the loading rate, from the rig outward — 2.50 credits / game s (want 2.50), regrown patches 3/126, mean distance 12 m vs field 23 m  
✓ 02: regrowth stops at the starting amount; slider at 0 stops it — 100 % of start after a long regrow at 4×  
✓ 03: every deposit has an ore field around its rig — 8 fields, patches 107–132  
✓ 03 B1: round trip to the nearest home field in the 20–40 s band — 25.7, 25.5, 25.8 s real (first, from the bay: 29.1 s) · field B1-H1  
✓ 03 B1: a load comes from several patches, the harvester moving on by itself — 3.3 patch moves per load  
✓ 03 B1: two harvesters per refinery earn more than one — one $1169/min, two $2400/min (real minutes)  
✓ 03 R1: round trip to the nearest home field in the 20–40 s band — 27.3, 26.1, 26.5 s real (first, from the bay: 27.1 s) · field R1-H2  
✓ 03 R1: a load comes from several patches, the harvester moving on by itself — 3.0 patch moves per load  
✓ 03 R1: two harvesters per refinery earn more than one — one $1126/min, two $2200/min (real minutes)  
✓ 03: home round trips match across starts (within 10 %) — B1 25.7 s, R1 26.7 s  
✓ 03: three harvesters empty a home field, then move on to the next field by themselves — B1-H1 (20000) empty after 6.1 real min; next fields B1-H2; 0 idle events  
✓ 03: an empty field regrows at 5 % of the loading rate, from the rig outward — 2.50 credits / game s (want 2.50), regrown patches 3/116, mean distance 12 m vs field 23 m  
✓ 03: regrowth stops at the starting amount; slider at 0 stops it — 100 % of start after a long regrow at 4×  
✓ 04: every deposit has an ore field around its rig — 12 fields, patches 114–138  
✓ 04 B1: round trip to the nearest home field in the 20–40 s band — 27.7, 24.1, 25.5 s real (first, from the bay: 26.8 s) · field B1-H1  
✓ 04 B1: a load comes from several patches, the harvester moving on by itself — 3.8 patch moves per load  
✓ 04 B1: two harvesters per refinery earn more than one — one $1165/min, two $2000/min (real minutes)  
✓ 04 R1: round trip to the nearest home field in the 20–40 s band — 26.0, 26.5, 27.2 s real (first, from the bay: 24.8 s) · field R1-H2  
✓ 04 R1: a load comes from several patches, the harvester moving on by itself — 4.5 patch moves per load  
✓ 04 R1: two harvesters per refinery earn more than one — one $1128/min, two $2000/min (real minutes)  
✓ 04: home round trips match across starts (within 10 %) — B1 25.8 s, R1 26.6 s  
✓ 04: three harvesters empty a home field, then move on to the next field by themselves — B1-H1 (20000) empty after 6.3 real min; next fields B1-H2; 0 idle events  
✓ 04: an empty field regrows at 5 % of the loading rate, from the rig outward — 2.50 credits / game s (want 2.50), regrown patches 7/125, mean distance 17 m vs field 24 m  
✓ 04: regrowth stops at the starting amount; slider at 0 stops it — 100 % of start after a long regrow at 4×  
✓ 05: every deposit has an ore field around its rig — 14 fields, patches 121–137  
✓ 05 B1: round trip to the nearest home field in the 20–40 s band — 22.1, 25.3, 23.6, 23.8 s real (first, from the bay: 22.4 s) · field B1-H1  
✓ 05 B1: a load comes from several patches, the harvester moving on by itself — 3.4 patch moves per load  
✓ 05 B1: two harvesters per refinery earn more than one — one $1268/min, two $2000/min (real minutes)  
✓ 05 R1: round trip to the nearest home field in the 20–40 s band — 22.5, 22.5, 23.6, 23.3 s real (first, from the bay: 23.2 s) · field R1-H2  
✓ 05 R1: a load comes from several patches, the harvester moving on by itself — 3.6 patch moves per load  
✓ 05 R1: two harvesters per refinery earn more than one — one $1305/min, two $2000/min (real minutes)  
✓ 05: home round trips match across starts (within 10 %) — B1 23.7 s, R1 23.0 s  
✓ 05: three harvesters empty a home field, then move on to the next field by themselves — B1-H1 (20000) empty after 5.8 real min; next fields E1, B1-H2; 0 idle events  
✓ 05: an empty field regrows at 5 % of the loading rate, from the rig outward — 2.50 credits / game s (want 2.50), regrown patches 3/126, mean distance 5 m vs field 23 m  
✓ 05: regrowth stops at the starting amount; slider at 0 stops it — 100 % of start after a long regrow at 4×

55/55 checks passed
