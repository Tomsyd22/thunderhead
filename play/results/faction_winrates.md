# Faction win rates in the AI batches

From play/results/ai.json, ai_seed2.json, ai_2v1.json, ai_2v1_seed2.json (seed sets 1 and 2). Wins / games; a draw is a game without a win. 1v1 = Hard vs Normal and Normal vs Normal on maps 01 and 03; 2v1 = Normal vs 2 Easy and Hard vs 2 Normal on maps 02, 04 and 05 (both factions of the pair share its result). Factions rotate by match index, so each faction plays a similar number of games but not always the same opponents.

## After this pass

| faction | 1v1 all | 1v1 Normal vs Normal | 1v1 as Hard (vs Normal) | 1v1 as Normal (vs Hard) | 2v1 all | 2v1 as the single AI | 2v1 in the pair |
|---|---|---|---|---|---|---|---|
| Compact | 16/32 (50 %) | 8/16 (50 %) | 8/8 (100 %) | 0/8 (0 %) | 16/24 (67 %) | 8/8 (100 %) | 8/16 (50 %) |
| Lattice | 16/32 (50 %) | 8/16 (50 %) | 8/8 (100 %) | 0/8 (0 %) | 7/24 (29 %) | 3/8 (38 %) | 4/16 (25 %) |
| Helix | 16/32 (50 %) | 8/16 (50 %) | 8/8 (100 %) | 0/8 (0 %) | 8/24 (33 %) | 4/8 (50 %) | 4/16 (25 %) |

## Before this pass (the batch results that were in play/results before this pass; ai_seed2 and ai_2v1_seed2 came from an earlier version of the harness)

| faction | 1v1 all | 1v1 Normal vs Normal | 1v1 as Hard (vs Normal) | 1v1 as Normal (vs Hard) | 2v1 all | 2v1 as the single AI | 2v1 in the pair |
|---|---|---|---|---|---|---|---|
| Compact | 19/32 (59 %) | 11/16 (69 %) | 8/8 (100 %) | 0/8 (0 %) | 14/24 (58 %) | 8/8 (100 %) | 6/16 (38 %) |
| Lattice | 15/32 (47 %) | 7/16 (44 %) | 8/8 (100 %) | 0/8 (0 %) | 6/24 (25 %) | 4/8 (50 %) | 2/16 (13 %) |
| Helix | 13/32 (41 %) | 5/16 (31 %) | 8/8 (100 %) | 0/8 (0 %) | 10/24 (42 %) | 6/8 (75 %) | 4/16 (25 %) |

