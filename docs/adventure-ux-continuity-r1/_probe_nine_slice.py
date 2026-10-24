"""R1 九宫格边距终版：用「不透明外框的圆角弧线」精确测 inset。

做法：对每个角落，统计「从该角出发、第一处 alpha>200 的像素」的偏移，
取四角平均后加 2px 余量 ⇒ 角落安全区；这就是九宫格 corners。
"""
import json
from PIL import Image

BASE = r"D:\1020卡皮巴拉\unpacked_1.9.3\assets\sprites"
OUT = r"D:\workbuddy\fruits\src\lab\portraitBattleLab\adventure\_nine_slice_probe.json"
ALPHA = 200

TARGETS = [
    "atlasraft/battle_event_text_bg.png",
    "atlasraft/battlenew_event_bg.png",
    "atlasraft/btn_green.png",
    "atlasraft/btn_yellow.png",
    "atlasraft/btn_yellow_big.png",
    "atlasraft/battle_event_btn_chat.png",
    "atlasraft/event_line.png",
]


def corner_radius(im, corner, span=40):
    """从角落沿对角线方向找到第一个不透明像素，返回 (dx, dy) 到该像素的距离。"""
    w, h = im.size
    px = im.load()
    for d in range(span):
        pts = []
        for k in range(d + 1):
            if corner == "TL":
                pts.append((k, d - k))
            elif corner == "TR":
                pts.append((w - 1 - k, d - k))
            elif corner == "BL":
                pts.append((k, h - 1 - (d - k)))
            else:
                pts.append((w - 1 - k, h - 1 - (d - k)))
        for x, y in pts:
            if 0 <= x < w and 0 <= y < h and px[x, y][3] >= ALPHA:
                return d
    return span


result = {}
for rel in TARGETS:
    im = Image.open(f"{BASE}\\{rel}").convert("RGBA")
    w, h = im.size
    r = {c: corner_radius(im, c) for c in ("TL", "TR", "BL", "BR")}
    # corners = 各角半径 + 2px 余量；左右取 max(TL,BL)/max(TR,BR)，上下同理
    left = min(max(r["TL"], r["BL"]) + 2, w // 3)
    right = min(max(r["TR"], r["BR"]) + 2, w // 3)
    top = min(max(r["TL"], r["TR"]) + 2, h // 3)
    bottom = min(max(r["BL"], r["BR"]) + 2, h // 3)
    ins = {"left": left, "right": right, "top": top, "bottom": bottom}
    result[rel] = {"size": [w, h], "radii": r, "insets": ins}
    print(f"{rel:44s} {w:4d}x{h:<4d} radii={r} => insets L{left:3d} T{top:3d} R{right:3d} B{bottom:3d}")

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=1)
print("->", OUT)
