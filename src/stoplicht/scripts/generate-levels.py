#!/usr/bin/env python3
"""Generates public/levels/level1..20.json and index.json. Target times are set afterwards with
scripts/tune-level.ts --apply (see README). Run: python3 scripts/generate-levels.py"""
import json, os

TYPES = {
    "car": {"name": "Auto", "kind": "car", "length": 4.5, "width": 2, "maxSpeed": 14, "acceleration": 2.5, "deceleration": 4, "minGap": 1.5},
    "truck": {"name": "Vrachtwagen", "kind": "truck", "length": 10, "width": 2.5, "maxSpeed": 11, "acceleration": 1.2, "deceleration": 3, "minGap": 2},
    "motorcycle": {"name": "Motor", "kind": "motorcycle", "length": 2.2, "width": 0.9, "maxSpeed": 14, "acceleration": 4, "deceleration": 5, "minGap": 1},
    "bus": {"name": "Bus", "kind": "bus", "length": 12, "width": 2.5, "maxSpeed": 11, "acceleration": 1, "deceleration": 2.5, "minGap": 2.5},
    "van": {"name": "Bestelbus", "kind": "van", "length": 6, "width": 2.2, "maxSpeed": 13, "acceleration": 2, "deceleration": 3.5, "minGap": 1.5},
    "tractor": {"name": "Tractor", "kind": "tractor", "length": 5, "width": 2.4, "maxSpeed": 8, "acceleration": 1, "deceleration": 3, "minGap": 2},
}
CONST = {"clearanceTime": 2, "reactionTime": 0.3, "greenRange": {"min": 1, "max": 30, "step": 0.1}, "offsetRange": {"min": -30, "max": 30, "step": 0.1}, "amberRange": {"min": 1, "max": 10, "step": 0.1}}
# junctions whose green/amber stay coupled (puzzle rule): level -> junction letters ("*" = all)
SYMMETRIC = {3: ["A"], 7: ["B"], 12: ["*"], 14: ["B"], 17: ["*"], 19: ["A", "D"], 20: ["A", "E", "I"]}
SIDES = {(0, -1): "N", (1, 0): "E", (0, 1): "S", (-1, 0): "W"}
OPP = {"N": "S", "S": "N", "E": "W", "W": "E"}


def road(id, a, b, one_way=False):
    r = {"id": id, "from": list(a), "to": list(b)}
    if one_way:
        r["oneWay"] = True
    return r


def hrow(id, y, w, one_way=None):
    """Full-width horizontal road; one_way 'E' or 'W'."""
    if one_way == "W":
        return road(id, (w - 1, y), (0, y), True)
    return road(id, (0, y), (w - 1, y), one_way == "E")


def vcol(id, x, h, one_way=None):
    if one_way == "N":
        return road(id, (x, h - 1), (x, 0), True)
    return road(id, (x, 0), (x, h - 1), one_way == "S")


def series(at, start, every, until, pattern=("car",)):
    out, i, t = [], 0, start
    while t <= until + 1e-9:
        out.append((tuple(at), round(t, 1), pattern[i % len(pattern)]))
        t += every
        i += 1
    return out


def axis(r):
    return "h" if r["from"][1] == r["to"][1] else "v"


def analyse(roads, w, h):
    """Tiles, junctions and spawn points derived the same way as RoadNetwork/editor."""
    tiles = {}
    for r in roads:
        (x0, y0), (x1, y1) = r["from"], r["to"]
        dx, dy = (x1 > x0) - (x1 < x0), (y1 > y0) - (y1 < y0)
        x, y = x0, y0
        while True:
            tiles.setdefault((x, y), []).append(r)
            if (x, y) == (x1, y1):
                break
            x, y = x + dx, y + dy

    def seg_for(t, d):
        n = (t[0] + d[0], t[1] + d[1])
        if n not in tiles:
            return None
        ax = "h" if d[1] == 0 else "v"
        for r in tiles[t]:
            if axis(r) == ax and r in tiles[n]:
                return r
        return None

    def allowed(r, d):
        if not r.get("oneWay"):
            return True
        fx, fy = r["from"]; tx, ty = r["to"]
        return ((tx > fx) - (tx < fx), (ty > fy) - (ty < fy)) == d

    junctions, spawn_points = [], []
    for t in sorted(tiles, key=lambda t: (t[1], t[0])):
        nb = [d for d in SIDES if seg_for(t, d)]
        if len(nb) >= 3:
            junctions.append(t)
        on_edge = t[0] in (0, w - 1) or t[1] in (0, h - 1)
        if on_edge and len(nb) == 1 and allowed(seg_for(t, nb[0]), nb[0]):
            spawn_points.append((t, OPP[SIDES[nb[0]]]))
    return junctions, spawn_points


def letter(i):
    """0 -> A, 25 -> Z, 26 -> AA"""
    out = ""
    i += 1
    while i > 0:
        i, r = divmod(i - 1, 26)
        out = chr(65 + r) + out
    return out


def is_symmetric(num, jid):
    rule = SYMMETRIC.get(num, [])
    return "*" in rule or jid in rule


def junction_def(num, i, t):
    d = {"id": letter(i), "at": list(t), "lightGroups": [{"id": "A", "approaches": ["N", "S"]}, {"id": "B", "approaches": ["E", "W"]}]}
    if is_symmetric(num, letter(i)):
        d["symmetric"] = True
    return d


def level(num, name, grid, roads, spawns, mode):
    w, h = grid
    junctions, points = analyse(roads, w, h)
    # spawn points are numbered 1..n in reading order, junctions lettered A, B, C ...
    point_ids = {t: str(i + 1) for i, (t, _) in enumerate(points)}
    for at, _, _ in spawns:
        if at not in point_ids:
            raise SystemExit(f"level{num}: {at} is not a valid spawn point; valid: {point_ids}")
    used = {TYPES_KEY for (_, _, TYPES_KEY) in spawns} | {"car", "truck"}
    return {
        "formatVersion": 1,
        "id": f"level{num}",
        "name": name,
        "grid": {"width": w, "height": h},
        "roads": roads,
        "intersections": [junction_def(num, i, t) for i, t in enumerate(junctions)],
        "spawnPoints": [{"id": point_ids[t], "at": list(t)} for t, _ in points],
        "spawns": [{"time": t, "spawnPoint": point_ids[at], "vehicleType": typ} for at, t, typ in sorted(spawns, key=lambda s: (s[1], point_ids[s[0]]))],
        "vehicleTypes": {k: TYPES[k] for k in TYPES if k in used},
        "constants": CONST,
        "targetTime": 60,
        "collisionMode": mode,
        "defaultLightSettings": {letter(i): {"green": {"A": 10, "B": 10}, "amber": {"A": 2, "B": 2}, "offset": 0, "linked": True} for i in range(len(junctions))},
    }


C, T, M, B, V, TR = "car", "truck", "motorcycle", "bus", "van", "tractor"
L = []

# 1 — tutorial (≈20 s of spawns): busy north-south, a trickle east-west -> learn to shift green time
L.append(level(1, "Eén kruispunt", (11, 9), [hrow("h", 4, 11), vcol("v", 5, 9)],
    series((5, 0), 0, 3, 18, (C, C, C, T)) + series((5, 8), 1.5, 4.5, 19.5) + series((0, 4), 4, 12, 16) + [((10, 4), 8, C)], "mild"))
# 2 — green wave (≈30 s): a steady stream west->east across two junctions -> learn the offset
L.append(level(2, "Groene golf", (15, 9), [hrow("h", 4, 15), vcol("v1", 4, 9), vcol("v2", 10, 9)],
    series((0, 4), 0, 3, 30, (C, C, C, T)) + series((14, 4), 2, 7, 30) + series((4, 0), 3, 9, 30) + series((4, 8), 6, 10, 26) + series((10, 0), 5, 9, 32) + series((10, 8), 8, 10, 28), "mild"))
# 3 — one-way verticals (≈40 s), first motorcycles and vans
L.append(level(3, "Eenrichting", (15, 11), [hrow("h", 5, 15), vcol("v1", 4, 11, "S"), vcol("v2", 10, 11, "N")],
    series((0, 5), 0, 3.5, 38, (C, M, C, C, T)) + series((14, 5), 1.5, 4, 37.5, (C, C, M)) + series((4, 0), 0.5, 4.5, 40, (C, V, C, T)) + series((10, 10), 2, 5, 37, (C, C, V)), "mild"))
# 4 — strict: two close junctions on a one-way avenue
L.append(level(4, "Blokkade", (13, 9), [hrow("h", 4, 13, "E"), vcol("v1", 5, 9), vcol("v2", 7, 9)],
    series((0, 4), 0, 2, 40, (C, C, V, C, M, C, T)) + series((5, 0), 1, 6, 37) + series((5, 8), 4, 7, 39, (C, M)) + series((7, 0), 2.5, 6, 38.5) + series((7, 8), 5.5, 7, 40.5), "strict"))
# 5 — a bend, three junctions
L.append(level(5, "De bocht", (15, 11), [road("a", (0, 6), (8, 6)), road("b", (8, 6), (8, 0)), vcol("v", 3, 11), hrow("h2", 2, 15)],
    series((0, 6), 0, 2.5, 45, (C, C, M, C, V, T)) + series((8, 0), 1, 3, 46, (C, M, C)) + series((3, 0), 0.5, 3, 45.5, (C, C, C, V, T)) + series((3, 10), 2, 6, 44) + series((0, 2), 1.5, 5, 46.5, (C, V)) + series((14, 2), 3, 4, 47, (C, C, M, T)), "strict"))
# 6 — 2x2 grid, everything incl. a bus line
L.append(level(6, "Het raster", (17, 13), [hrow("h1", 4, 17), hrow("h2", 8, 17), vcol("v1", 5, 13), vcol("v2", 11, 13)],
    series((0, 4), 0, 4, 52, (C, C, M, T)) + series((16, 4), 2, 5, 52, (C, B, C, C)) + series((0, 8), 1, 5, 51, (C, V)) + series((16, 8), 3, 4, 51, (C, C, C, C, T)) + series((5, 0), 0.5, 4.5, 50, (C, M, C)) + series((5, 12), 2.5, 5, 52.5, (C, C, T)) + series((11, 0), 1.5, 4.5, 51, (C, V, M)) + series((11, 12), 3.5, 5, 53.5), "strict"))
# 7 — bus line: a bus every 12 s eats a green phase
L.append(level(7, "Buslijn", (15, 9), [hrow("h", 4, 15), vcol("v1", 4, 9), vcol("v2", 10, 9)],
    series((0, 4), 0, 12, 48, (B,)) + series((0, 4), 2, 3, 47, (C, C, M)) + series((14, 4), 1, 4, 49, (C, V, C)) + series((4, 0), 3, 7, 45) + series((4, 8), 5, 8, 45) + series((10, 0), 4, 7, 46, (C, M)) + series((10, 8), 6, 8, 46), "mild"))
# 8 — harvest time: tractors crawl down the west lane
L.append(level(8, "Oogsttijd", (15, 11), [hrow("h", 5, 15), vcol("v1", 4, 11), vcol("v2", 10, 11)],
    series((4, 0), 0, 9, 45, (TR,)) + series((4, 0), 3, 9, 48, (C, C, V)) + series((4, 10), 2, 6, 44, (C, M)) + series((0, 5), 0.5, 3, 47, (C, C, M, C, T)) + series((14, 5), 1.5, 3.5, 47, (C, V, C)) + series((10, 0), 4, 8, 44) + series((10, 10), 6, 8, 46), "mild"))
# 9 — motor club: short, fast vehicles
L.append(level(9, "Motorclub", (13, 9), [hrow("h", 4, 13), vcol("v1", 4, 9), vcol("v2", 8, 9)],
    series((0, 4), 0, 1.5, 40, (M, M, C)) + series((12, 4), 0.7, 2, 41, (M, C, M)) + series((4, 0), 1, 5, 41, (C, M)) + series((4, 8), 3, 6, 39) + series((8, 0), 2, 5, 42, (M, C)) + series((8, 8), 4, 6, 40, (C, C, M)), "strict"))
# 10 — delivery service: vans everywhere on a 2x2 grid
L.append(level(10, "Bezorgdienst", (17, 13), [hrow("h1", 4, 17), hrow("h2", 8, 17), vcol("v1", 5, 13), vcol("v2", 11, 13)],
    series((0, 4), 0, 3, 48, (V, C, V)) + series((16, 4), 1, 4, 49, (C, V)) + series((0, 8), 2, 4, 50, (V, V, C)) + series((16, 8), 0.5, 3.5, 49, (C, V, M)) + series((5, 0), 1.5, 6, 49) + series((5, 12), 3, 6, 51, (C, V)) + series((11, 0), 2.5, 6, 50, (V,)) + series((11, 12), 4, 6, 52), "mild"))
# 11 — S-curve with two junctions
L.append(level(11, "Dubbele bocht", (17, 13), [road("a", (0, 9), (6, 9)), road("b", (6, 9), (6, 3)), road("c", (6, 3), (16, 3)), vcol("v1", 3, 13), vcol("v2", 11, 13)],
    series((0, 9), 0, 2.5, 46, (C, C, M, V, C, T)) + series((16, 3), 1, 3, 46, (C, M, C, C)) + series((3, 0), 0.5, 4, 44.5, (C, V)) + series((3, 12), 2, 5, 47) + series((11, 0), 1.5, 4, 45.5, (C, C, T)) + series((11, 12), 3, 5, 48, (C, M)), "strict"))
# 12 — boulevard: three junctions, heavy two-way traffic with buses
L.append(level(12, "Boulevard", (21, 9), [hrow("h", 4, 21), vcol("v1", 4, 9), vcol("v2", 10, 9), vcol("v3", 16, 9)],
    series((0, 4), 0, 2.5, 50, (C, C, M, C, B)) + series((20, 4), 1, 2.5, 50, (C, V, C, C, T)) + series((4, 0), 2, 9, 47) + series((4, 8), 5, 9, 50, (C, M)) + series((10, 0), 3, 9, 48) + series((10, 8), 6, 9, 51) + series((16, 0), 4, 9, 49, (C, V)) + series((16, 8), 7, 9, 52), "strict"))
# 13 — one-way grid: every road one direction
L.append(level(13, "Eenrichtingsraster", (17, 13), [hrow("h1", 4, 17, "E"), hrow("h2", 8, 17, "W"), vcol("v1", 5, 13, "S"), vcol("v2", 11, 13, "N")],
    series((0, 4), 0, 2, 48, (C, C, M, V, C, T)) + series((16, 8), 1, 2, 49, (C, M, C, C, V)) + series((5, 0), 0.5, 2.5, 48, (C, V, C, M)) + series((11, 12), 1.5, 2.5, 49, (C, C, T, M)), "strict"))
# 14 — tractors on the side roads, buses on the main road
L.append(level(14, "Trekkers en bussen", (19, 11), [hrow("h", 5, 19), vcol("v1", 4, 11), vcol("v2", 9, 11), vcol("v3", 14, 11)],
    series((0, 5), 0, 3, 50, (C, C, B, C, M)) + series((18, 5), 1.5, 3, 50, (C, V, C, B)) + series((4, 0), 2, 10, 42, (TR, C)) + series((4, 10), 5, 8, 45) + series((9, 0), 3, 8, 43, (C, TR)) + series((9, 10), 6, 10, 46, (TR,)) + series((14, 0), 4, 8, 44, (C, M)) + series((14, 10), 7, 10, 47, (C, TR)), "mild"))
# 15 — rush hour: 2x3 grid
L.append(level(15, "Spitsuur", (21, 13), [hrow("h1", 4, 21), hrow("h2", 8, 21), vcol("v1", 5, 13), vcol("v2", 10, 13), vcol("v3", 15, 13)],
    series((0, 4), 0, 3, 54, (C, M, C, V)) + series((20, 4), 1, 3.5, 54, (C, C, M)) + series((0, 8), 2, 3.5, 55, (C, V, C, T)) + series((20, 8), 0.5, 3, 54, (C, M, C, C)) + series((5, 0), 1.5, 6, 55, (C, V)) + series((5, 12), 3, 6, 57) + series((10, 0), 2.5, 6, 56, (C, M)) + series((10, 12), 4, 6, 58, (C, C, T)) + series((15, 0), 3.5, 6, 57) + series((15, 12), 5, 6, 59, (C, V)), "mild"))
# 16 — shortcut: a bend feeding a busy main road
L.append(level(16, "Sluiproute", (17, 11), [hrow("h", 5, 17), vcol("v1", 4, 11, "S"), road("a", (0, 8), (10, 8)), road("b", (10, 8), (10, 0))],
    series((0, 5), 0, 3, 48, (C, C, V, M, T)) + series((16, 5), 1, 3, 48, (C, M, C, C)) + series((4, 0), 0.5, 4, 46.5, (C, V, C)) + series((0, 8), 2, 3.5, 47, (C, C, M, V)) + series((10, 0), 1.5, 3.5, 48, (C, M, C, T)), "strict"))
# 17 — country road: tractors on the main road slow everyone down
L.append(level(17, "Landweg", (15, 9), [hrow("h", 4, 15), vcol("v1", 4, 9), vcol("v2", 10, 9)],
    series((0, 4), 0, 8, 48, (TR, C, C)) + series((0, 4), 1.5, 4, 47, (C, M, C, V)) + series((14, 4), 3, 8, 47, (C, TR)) + series((14, 4), 1, 4, 49, (C, C, M)) + series((4, 0), 2, 6, 44, (C, V)) + series((4, 8), 4, 7, 46) + series((10, 0), 3, 6, 45, (C, M)) + series((10, 8), 5, 7, 47, (C, C, T)), "strict"))
# 18 — city centre: 3x2 grid, everything
L.append(level(18, "Stadshart", (21, 15), [hrow("h1", 4, 21), hrow("h2", 10, 21), vcol("v1", 5, 15), vcol("v2", 10, 15), vcol("v3", 15, 15)],
    series((0, 4), 0, 3.5, 56, (C, B, C, M, V)) + series((20, 4), 1, 3.5, 56, (C, C, M, T)) + series((0, 10), 2, 4, 58, (C, V, C, TR)) + series((20, 10), 0.5, 3.5, 56, (C, M, C, B)) + series((5, 0), 1.5, 7, 57, (C, V)) + series((5, 14), 3, 7, 59, (C, M)) + series((10, 0), 2.5, 7, 58, (C, C, TR)) + series((10, 14), 4, 7, 60, (C, T)) + series((15, 0), 3.5, 7, 59, (C, M, V)) + series((15, 14), 5, 7, 61), "mild"))
# 19 — night bus: one-way grid, buses and motorcycles
L.append(level(19, "Nachtbus", (17, 13), [hrow("h1", 4, 17, "W"), hrow("h2", 8, 17, "E"), vcol("v1", 5, 13, "N"), vcol("v2", 11, 13, "S")],
    series((16, 4), 0, 2.5, 50, (B, M, M, C, M)) + series((0, 8), 1, 2.5, 51, (M, C, B, M, C)) + series((5, 12), 0.5, 3, 50, (M, M, C, V)) + series((11, 0), 1.5, 3, 51, (C, M, B, M)), "strict"))
# 20 — grand finale: 3x3 strict grid with wide spacing, every vehicle type
L.append(level(20, "Grote finale", (23, 17), [hrow("h1", 3, 23), hrow("h2", 8, 23), hrow("h3", 13, 23), vcol("v1", 5, 17), vcol("v2", 11, 17), vcol("v3", 17, 17)],
    series((0, 3), 0, 6, 60, (C, M, V, C, B)) + series((22, 3), 1, 6, 61, (C, C, T, M)) + series((0, 8), 2, 5, 62, (C, V, C, TR)) + series((22, 8), 0.5, 5, 60, (C, M, C, B)) + series((0, 13), 1.5, 6, 61, (C, C, M, V)) + series((22, 13), 3, 6, 63, (C, T, C, M)) + series((5, 0), 2.5, 7, 62, (C, V)) + series((5, 16), 3.5, 7, 63, (C, M, TR)) + series((11, 0), 1, 7, 61, (C, C, T)) + series((11, 16), 4.5, 7, 64, (C, M)) + series((17, 0), 2, 7, 62, (C, V, M)) + series((17, 16), 5.5, 7, 65, (C, B)), "strict"))

os.makedirs("public/levels", exist_ok=True)
for lvl in L:
    path = f"public/levels/{lvl['id']}.json"
    if os.path.exists(path):  # keep an already tuned target time
        try:
            lvl["targetTime"] = json.load(open(path)).get("targetTime", lvl["targetTime"])
        except Exception:
            pass
    json.dump(lvl, open(path, "w"), ensure_ascii=False, indent=1)
    print(f"{lvl['id']:8} {lvl['name']:22} {lvl['grid']['width']}x{lvl['grid']['height']}  {len(lvl['intersections'])} junctions  {len(lvl['spawns'])} vehicles  {lvl['collisionMode']}")
json.dump({"formatVersion": 1, "levels": [{"id": l["id"], "file": f"{l['id']}.json", "name": l["name"], "targetTime": l["targetTime"], "collisionMode": l["collisionMode"]} for l in L]},
          open("public/levels/index.json", "w"), ensure_ascii=False, indent=2)
