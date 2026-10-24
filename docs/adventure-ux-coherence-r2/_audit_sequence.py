"""R2 连续帧的客观校验（回答验收 1/3，不靠肉眼也不靠几何推断）。

对 evidence/seq-*.png 逐帧计算：
  1. 地平线位置：从左缘 x=12 向下找「连续 14 行都是暖色地面(R>B+10)」的首行；
  2. 背景一致性：以「事件帧」为基准，对其它帧搜索最优 (scale, dx, dy) 的横向色差，
     报告最佳对齐色差（<15 视为同一块背景图）；
  3. 战车存在感：绿色车体像素簇的像素数与包围盒（非战斗阶段要求面积 ≥ 800px²）；
  4. 卡片可读性由 sequence.json 的 measureText 结果给出（不在此脚本重复）。
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
EV = os.path.join(HERE, "evidence")


def horizon(im, x=12):
    """地平线 = 从该行起**一直到舞台带底部（y=466）**都保持暖色地面（R>B+8）的首行。

    ⚠️ 两个坑（都实测踩过）：
      ① 不能用「连续 14 行」短窗口：王座厅素材中部本身有一条暖色带（y≈134–170），
         短窗口会把它误判成地面；
      ② 不能把下界放到 y>466：舞台带在 470 结束，470 之后是叙事区（深色），
         若把 470 也算进来就会永远判不出（全帧都返回 None 或越界值）。
    """
    px = im.load()
    bottom = 458  # 实测：地面暖色一直延续到 y≈458，460+ 已被叙事带上沿的暗色覆盖
    for y in range(200, bottom):
        if all(px[x, yy][0] > px[x, yy][2] + 8 for yy in range(y, bottom, 3)):
            return y
    return None


def green_box(im):
    px = im.load()
    xs, ys = [], []
    for y in range(92, 470, 2):
        for x in range(0, 390, 2):
            r, g, b = px[x, y]
            if g > r + 12 and g > b + 10 and g > 45:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return {
        "n": len(xs) * 4,  # 采样了 1/4 像素，近似总面积
        "x": [min(xs), max(xs)],
        "y": [min(ys), max(ys)],
    }


def best_align(a, b, y0=110, y1=450):
    """在 a 与 b 之间搜索最优缩放/平移，返回最小平均色差。"""
    pa, pb = a.load(), b.load()
    best = None
    for scale in (1.0, 1.05, 1.1, 1.15, 1.2, 1.25):
        for dx in range(-30, 31, 5):
            for dy in range(-30, 31, 5):
                tot = n = 0
                for y in range(y0, y1, 14):
                    for x in range(20, 370, 14):
                        sx = int(195 + (x - 195) / scale) + dx
                        sy = int(280 + (y - 280) / scale) + dy
                        if not (0 <= sx < 390 and 0 <= sy < 844):
                            continue
                        p1, p2 = pa[x, y], pb[sx, sy]
                        tot += abs(p1[0] - p2[0]) + abs(p1[1] - p2[1]) + abs(p1[2] - p2[2])
                        n += 1
                if n > 200:
                    avg = tot / n / 3
                    if best is None or avg < best[0]:
                        best = (avg, scale, dx, dy)
    return best


def mean_lum(im, y0=100, y1=460):
    px = im.load()
    vals = [0.299 * px[x, y][0] + 0.587 * px[x, y][1] + 0.114 * px[x, y][2]
            for y in range(y0, y1, 6) for x in range(0, 390, 6)]
    return sum(vals) / len(vals)


def main():
    seq = json.load(open(os.path.join(EV, "sequence.json"), encoding="utf-8"))
    frames = []
    for item in seq["sequence"]:
        p = os.path.join(EV, item["file"])
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGB")
        frames.append({
            "file": item["file"],
            "phase": item["phase"],
            "im": im,
            "horizon": horizon(im),
            "green": green_box(im),
            "lum": round(mean_lum(im), 1),
        })

    # 基准：第一个「非战斗」帧（EVENT / EVENT_CHOICE / CHOICE 优先）
    base = next((f for f in frames if f["phase"] in ("EVENT", "EVENT_CHOICE", "CHOICE")), frames[0])

    print(f"{'file':30s} {'phase':13s} {'horizon':>8s} {'lum':>6s} {'green n':>8s} {'green y':>12s} {'对齐色差':>9s}")
    rows = []
    for f in frames:
        al = best_align(f["im"], base["im"]) if f is not base else (0.0, 1.0, 0, 0)
        g = f["green"]
        print(
            f"{f['file']:30s} {f['phase']:13s} {str(f['horizon']):>8s} {f['lum']:>6.1f} "
            f"{(g['n'] if g else 0):>8d} {str(g['y'] if g else '-'):>12s} {al[0]:>9.1f}"
        )
        rows.append({
            "file": f["file"], "phase": f["phase"], "horizon": f["horizon"],
            "lum": f["lum"], "green": g, "alignDelta": round(al[0], 1),
            "alignScale": al[1], "alignOffset": [al[2], al[3]],
        })

    hs = [r["horizon"] for r in rows if r["horizon"] is not None]
    print(f"\n地平线范围: {min(hs)}..{max(hs)}（跨度 {max(hs) - min(hs)}px）")
    print(f"基准帧: {base['file']}")
    worst = max(r["alignDelta"] for r in rows if r["file"] != base["file"])
    print(f"最差对齐色差: {worst:.1f}（<15 视为同一块背景图）")
    out = {
        "baseFrame": base["file"],
        "horizonRange": [min(hs), max(hs)],
        "horizonSpan": max(hs) - min(hs),
        "worstAlignDelta": round(worst, 1),
        "frames": rows,
    }
    json.dump(out, open(os.path.join(EV, "sequence-audit.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("->", os.path.join(EV, "sequence-audit.json"))


if __name__ == "__main__":
    main()
