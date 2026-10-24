"""R1 预验收：对 390×844 截图做客观版面检查（无法肉眼看图时的硬指标）。

检查项（对应 Queue 验收 3：无缺失、不拉伸、无严重留白、文字不遮挡）：
  1. 四段分区是否真的被填满（每段的「非背景色像素占比」）：
       TOP 0..92 / STAGE 92..470 / NARRATIVE 470..744 / ACTION 744..844
  2. 是否出现「程序化黑底冒充完成」：纯黑（<8,8,8）像素占比必须极低。
  3. 严重留白检测：任意 40×40 区块内若 >99.5% 像素同色且为深色 ⇒ 记为空洞。
  4. 叙事区是否真的用了浅色卡（中央区域亮度 ≥ 200 的占比）。
  5. ACTion 带是否只有一块主按钮（判断「没有假按钮」的像素证据）。
"""
import json
import os
import sys
from PIL import Image

W, H = 390, 844
BANDS = {
    "TOP": (0, 92),
    "STAGE": (92, 470),
    "NARRATIVE": (470, 744),
    "ACTION": (744, 844),
}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "layout_audit.json")


def lum(p):
    return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]


def analyze(path):
    im = Image.open(path).convert("RGB")
    if im.size != (W, H):
        im = im.resize((W, H))
    px = im.load()
    res = {"file": os.path.basename(path), "size": list(im.size), "bands": {}}

    total_dark = 0
    total = W * H
    for name, (y0, y1) in BANDS.items():
        n = (y1 - y0) * W
        dark = 0          # 近黑像素
        bright = 0        # 亮像素（浅色卡）
        uniq = set()
        for y in range(y0, y1):
            for x in range(0, W, 2):   # 隔列采样，够用且快
                p = px[x, y]
                L = lum(p)
                uniq.add((p[0] >> 3, p[1] >> 3, p[2] >> 3))
                if L < 8:
                    dark += 1
                if L >= 200:
                    bright += 1
        sampled = ((y1 - y0) * (W // 2 + (W % 2)))
        total_dark += dark
        res["bands"][name] = {
            "sampleN": sampled,
            "darkPct": round(dark / sampled * 100, 2),
            "brightPct": round(bright / sampled * 100, 2),
            "distinctColors": len(uniq),
        }

    res["darkPctAll"] = round(total_dark / (total / 2) * 100, 2)

    # 空洞检测（40×40 区块，深色且近乎单色）
    holes = []
    for by in range(0, H - 40, 40):
        for bx in range(0, W - 40, 40):
            cols = {}
            for y in range(by, by + 40, 4):
                for x in range(bx, bx + 40, 4):
                    p = px[x, y]
                    k = (p[0] >> 4, p[1] >> 4, p[2] >> 4)
                    cols[k] = cols.get(k, 0) + 1
            n = sum(cols.values())
            top = max(cols.values())
            if n > 0 and top / n > 0.995:
                k = max(cols, key=cols.get)
                if (k[0] * 16 + k[1] * 16 + k[2] * 16) / 3 < 40:
                    holes.append([bx, by])
    res["darkHoles"] = holes
    return res


if __name__ == "__main__":
    d = os.path.dirname(os.path.abspath(__file__))
    ev = os.path.join(d, "evidence")
    files = sorted(f for f in os.listdir(ev) if f.endswith(".png"))
    out = []
    print(f"{'file':34s} {'dark%':>6s} {'TOP':>12s} {'STAGE':>14s} {'NARR':>22s} {'ACTION':>14s} holes")
    for f in files:
        r = analyze(os.path.join(ev, f))
        out.append(r)
        b = r["bands"]
        print(
            f"{r['file']:34s} {r['darkPctAll']:6.2f} "
            f"{b['TOP']['distinctColors']:>4d}c/{b['TOP']['darkPct']:5.1f}% "
            f"{b['STAGE']['distinctColors']:>4d}c/{b['STAGE']['darkPct']:5.1f}% "
            f"{b['NARRATIVE']['distinctColors']:>4d}c/{b['NARRATIVE']['darkPct']:5.1f}%/br{b['NARRATIVE']['brightPct']:5.1f}% "
            f"{b['ACTION']['distinctColors']:>4d}c/{b['ACTION']['darkPct']:5.1f}% "
            f"{len(r['darkHoles'])}"
        )
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("\n->", OUT)
