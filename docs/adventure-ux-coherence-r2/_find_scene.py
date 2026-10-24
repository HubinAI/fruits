"""R2：在拆包素材里找**横向场景底图**候选（宽>高、横向比例接近 390:378，且内容有细节）。

判据（客观、可复算）：
  1. 宽高比  0.85 ≤ w/h ≤ 2.2（接近舞台 1.03，或略宽可裁）；
  2. 尺寸   w ≥ 300（够铺 390 宽而不糊）；
  3. 细节  亮度标准差 ≥ 18（不是纯色/渐变板）；
  4. 亮度   平均亮度 ≥ 45（不是黑底）。
输出按「宽高比接近度 + 细节」排序的前若干张，供人工选定。
"""
import json
import os
import statistics
from PIL import Image

BASE = r"D:\1020卡皮巴拉\unpacked_1.9.3\assets\sprites"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scene_candidates.json")


def stats(path):
    try:
        im = Image.open(path).convert("RGBA")
    except Exception:
        return None
    w, h = im.size
    if w < 300 or h < 120:
        return None
    ar = w / h
    if not (0.85 <= ar <= 2.2):
        return None
    vals = []
    step = max(1, w // 60)
    for y in range(0, h, max(1, h // 40)):
        for x in range(0, w, step):
            p = im.getpixel((x, y))
            if p[3] < 40:
                continue
            vals.append(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2])
    if len(vals) < 200:
        return None
    mean = sum(vals) / len(vals)
    sd = statistics.pstdev(vals)
    return {"w": w, "h": h, "ar": round(ar, 3), "mean": round(mean, 1), "sd": round(sd, 1)}


rows = []
for root, _dirs, files in os.walk(BASE):
    for f in files:
        if not f.lower().endswith(".png"):
            continue
        p = os.path.join(root, f)
        st = stats(p)
        if not st:
            continue
        if st["sd"] < 18 or st["mean"] < 45:
            continue
        st["path"] = os.path.relpath(p, BASE).replace("\\", "/")
        # 接近度：|ar - 390/378|
        st["arDist"] = round(abs(st["ar"] - (390 / 378)), 3)
        rows.append(st)

rows.sort(key=lambda r: (r["arDist"], -r["sd"]))
top = rows[:40]
json.dump(top, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"候选 {len(rows)} 张，输出前 {len(top)}：")
for r in top:
    print(f"  {r['path']:52s} {r['w']:4d}x{r['h']:<4d} ar={r['ar']:.2f} mean={r['mean']:5.1f} sd={r['sd']:5.1f}")
print("->", OUT)
