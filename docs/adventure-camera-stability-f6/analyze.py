"""
FRUITS-ADVENTURE-CAMERA-STABILITY-F6｜修复前后同条件指标对照（只读分析，不改任何产物）。

用法：
  python docs/adventure-camera-stability-f6/analyze.py <dir> [<dir> ...]
每个 <dir> 需含 `camera-adaptive.json`（P0 诊断脚本产出：同种子、正常速度、逐帧采样）。

指标口径与 E2E（tests/_e2e_adventure_camera_f6.cjs）一致：
  maxDz / p99Dz   —— 相邻两帧合成 zoom 的变化（旧实现 = 1.000→1.110 的一帧阶跃）
  steps           —— |Δz| > 5% 的「可见阶跃」帧数
  maxDcy / maxDcx —— 相邻两帧裁切窗纵向/横向位移（px，安全区坐标）
  cropViol        —— 裁切窗未包住「裁切到安全区后的玩家车」的帧数（P0 采样只记 A 车安全框）
  widthViol       —— 裁切窗宽度 < 主体框宽度（= 主体放不下）的帧数
  resultDrop      —— RESULT 首帧主体屏宽相对战斗末帧的变化（%，负 = 缩小）
  resultZoom      —— RESULT 首帧 zoom vs 战斗末帧 zoom
"""
import json
import os
import sys

SAFE_W, SAFE_H = 390, 648


def clip(box):
    if not box:
        return None
    x1, y1 = max(0, box["x"]), max(0, box["y"])
    x2, y2 = min(SAFE_W, box["x"] + box["w"]), min(SAFE_H, box["y"] + box["h"])
    return {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1} if x2 > x1 and y2 > y1 else None


def contains(crop, box, eps=2):
    if not crop or not box:
        return True
    return (box["x"] >= crop["x"] - eps and box["y"] >= crop["y"] - eps
            and box["x"] + box["w"] <= crop["x"] + crop["w"] + eps
            and box["y"] + box["h"] <= crop["y"] + crop["h"] + eps)


def runs_of(frames):
    """把逐帧序列切成「连续战斗段」（BATTLE 帧且 bf 存在）。"""
    out, cur = [], []
    for f in frames:
        if f["ph"] == "BATTLE" and f.get("bf"):
            cur.append(f)
        else:
            if len(cur) > 30:
                out.append(cur)
            cur = []
    if len(cur) > 30:
        out.append(cur)
    return out


def p99(xs):
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(len(s) - 1, int(len(s) * 0.99))]


def analyze(path):
    d = json.load(open(path, encoding="utf-8"))
    frames = d["frames"]
    runs = runs_of(frames)
    transitions = [(frames[i - 1], frames[i]) for i in range(1, len(frames))
                   if frames[i - 1]["ph"] == "BATTLE" and frames[i]["ph"] == "RESULT"]

    per = []
    for k, r in enumerate(runs):
        dz, dcy, dcx, viol, wviol = [], [], [], 0, 0
        for a, b in zip(r, r[1:]):
            ba, bb = a["bf"], b["bf"]
            if ba["z"] is not None and bb["z"] is not None:
                dz.append(abs(bb["z"] - ba["z"]))
            if ba.get("cy") is not None and bb.get("cy") is not None:
                dcy.append(abs(bb["cy"] - ba["cy"]))
            if ba.get("cx") is not None and bb.get("cx") is not None:
                dcx.append(abs(bb["cx"] - ba["cx"]))
        for f in r:
            bf = f["bf"]
            crop = {"x": bf["cx"], "y": bf["cy"], "w": bf["cw"], "h": bf["ch"]}
            a_box = {"x": bf["ax"], "y": bf["ay"], "w": bf["aw"], "h": bf["ah"]}
            if not contains(crop, clip(a_box)):
                viol += 1
            # z≈1 = 主体比安全区还宽（正式相机已框满）⇒ 本轮不裁切，不计入「放不下」
            if bf["z"] > 1.002 and bf.get("subw") and crop["w"] < bf["subw"] - 0.5:
                wviol += 1
        eng = min(r, key=lambda f: f["bf"]["gap"] if f["bf"].get("gap") is not None else 1e9)
        px = [f["bf"]["apxw"] for f in r if f["bf"].get("apxw")]
        per.append({
            "battle": k,
            "frames": len(r),
            "durMs": r[-1]["t"] - r[0]["t"],
            "maxDz": max(dz) if dz else 0,
            "p99Dz": p99(dz),
            "steps": sum(1 for x in dz if x > 0.05),
            "maxDcy": max(dcy) if dcy else 0,
            "maxDcx": max(dcx) if dcx else 0,
            "cropViol": viol,
            "widthViol": wviol,
            "engageGap": eng["bf"].get("gap"),
            "engageZoom": eng["bf"]["z"],
            "aPxW": [min(px), max(px)] if px else None,
        })

    res = []
    for a, b in transitions:
        aw, bw = a["bf"].get("apxw"), (b["bf"] or {}).get("apxw")
        res.append({
            "t": b["t"],
            "dtMs": b["t"] - a["t"],
            "zoomBefore": a["bf"]["z"],
            "zoomAfter": (b["bf"] or {}).get("z"),
            "aPxWBefore": aw,
            "aPxWAfter": bw,
            "dropPct": (bw / aw - 1) * 100 if aw and bw else None,
            "cyBefore": a["bf"].get("cy"),
            "cyAfter": (b["bf"] or {}).get("cy"),
        })

    return {
        "dir": os.path.dirname(path).replace("\\", "/"),
        "mode": d.get("meta", {}).get("mode"),
        "head": d.get("meta", {}).get("head"),
        "battles": len(per),
        "frames": sum(p["frames"] for p in per),
        "maxDz": max((p["maxDz"] for p in per), default=0),
        "p99Dz": max((p["p99Dz"] for p in per), default=0),
        "steps": sum(p["steps"] for p in per),
        "maxDcy": max((p["maxDcy"] for p in per), default=0),
        "maxDcx": max((p["maxDcx"] for p in per), default=0),
        "cropViol": sum(p["cropViol"] for p in per),
        "widthViol": sum(p["widthViol"] for p in per),
        "engageZoomMax": max((p["engageZoom"] for p in per if p["engageZoom"]), default=0),
        "resultDropWorstPct": min((r["dropPct"] for r in res if r["dropPct"] is not None), default=None),
        "resultDropAvgPct": (sum(r["dropPct"] for r in res if r["dropPct"] is not None) / len(res)) if res else None,
        "resultZoomMismatchMax": max((abs((r["zoomAfter"] or 0) - r["zoomBefore"]) for r in res), default=None),
        "perBattle": per,
        "result": res,
    }


if __name__ == "__main__":
    out = {}
    for dirpath in sys.argv[1:]:
        p = os.path.join(dirpath, "camera-adaptive.json")
        if not os.path.exists(p):
            print("missing:", p)
            continue
        agg = analyze(p)
        out[dirpath] = agg
        print(f"\n=== {dirpath} (head={agg['head']}) ===")
        print(f"  战场数={agg['battles']} 战斗帧={agg['frames']}")
        print(f"  max|Δz|={agg['maxDz']:.4f}  p99={agg['p99Dz']:.4f}  可见阶跃(>5%)={agg['steps']} 帧")
        print(f"  max|Δcy|={agg['maxDcy']:.1f}px  max|Δcx|={agg['maxDcx']:.1f}px  "
              f"裁车帧={agg['cropViol']}  主体放不下帧={agg['widthViol']}")
        print(f"  交战 zoom 峰值={agg['engageZoomMax']:.2f}")
        print(f"  RESULT 主体屏宽变化 最差={agg['resultDropWorstPct']:.1f}%  "
              f"均={agg['resultDropAvgPct']:.1f}%  zoom差 max={agg['resultZoomMismatchMax']:.3f}")
        for r in agg["result"]:
            print(f"    t={r['t']} z {r['zoomBefore']:.2f}→{r['zoomAfter']:.2f} "
                  f"px {r['aPxWBefore']:.1f}→{r['aPxWAfter']:.1f} ({r['dropPct']:+.1f}%)")
    outp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "metrics.json")
    json.dump(out, open(outp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("\n->", outp)
