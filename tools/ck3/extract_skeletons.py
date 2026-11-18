"""Snapshot the CK3 portrait head skeletons (bone names, parents, inverse binds) and the torso
attachment point into tools/ck3/ck3_skeletons.json, so the export does not need the game install.

    python -I tools/ck3/extract_skeletons.py ["D:/SteamLibrary/steamapps/common/Crusader Kings III/game"]

The portrait head entity is attached to the torso with head_root -> bn_sp_thoracic
(common/portrait_types/00_human_types.txt), so head-skeleton space = torso space - thoracic.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdxmesh as P  # noqa: E402

GAME = sys.argv[1] if len(sys.argv) > 1 else "D:/SteamLibrary/steamapps/common/Crusader Kings III/game"
PORTRAITS = os.path.join(GAME, "gfx/models/portraits")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ck3_skeletons.json")

out = {"game": GAME}
for sex in ("male", "female"):
    head = P.summarize(P.read(os.path.join(PORTRAITS, f"{sex}_head/{sex}_head.mesh")))
    body = P.summarize(P.read(os.path.join(PORTRAITS, f"{sex}_body/{sex}_body.mesh")))
    hp = P.bone_world_positions(head)
    bp = P.bone_world_positions(body)
    out[sex] = {
        "bones": [{"name": b["name"], "parent": b["pa"], "tx": b["tx"]} for b in head["skeleton"]],
        "head_bones": {k: v for k, v in hp.items() if v is not None},
        "thoracic": bp["bn_sp_thoracic"],
        "torso_bones": {k: bp[k] for k in ("ground_joint", "body_root", "bn_sp_thoracic", "bn_sp_cervical", "camera_torso_look_at")},
    }
    print(sex, "head bones", len(head["skeleton"]), "thoracic", [round(v, 3) for v in bp["bn_sp_thoracic"]],
          "head_mid (head space)", [round(v, 3) for v in hp["bn_h_head_mid"]])
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f)
print("wrote", OUT)
