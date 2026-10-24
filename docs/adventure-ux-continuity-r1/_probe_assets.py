"""R1 素材勘察：透明边 / 九宫格可拉伸区 / 主色，供一屏式布局选型（只读，不改素材）。"""
import sys
from PIL import Image

BASE = r"D:\1020卡皮巴拉\unpacked_1.9.3\assets\sprites"

TARGETS = [
    "atlasraft/battle_event_text_bg.png",
    "atlasraft/battle_event_bg.png",
    "atlasraft/battlenew_event_bg.png",
    "atlasraft/battle_event_title_bg.png",
    "atlasraft/battle_event_res_bg.png",
    "atlasraft/event_line.png",
    "atlasraft/btn_green.png",
    "atlasraft/btn_yellow.png",
    "atlasraft/btn_yellow_big.png",
    "atlasraft/battle_event_btn_chat.png",
    "art-uispritelarge/bb_story_bg.png",
]


def alpha_bbox_report(im):
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    a = im.getchannel("A")
    bbox = a.getbbox()
    w, h = im.size
    # 透明边（相对全图）
    if bbox is None:
        return None
    return bbox, (bbox[0], bbox[1], w - bbox[2], h - bbox[3])


def uniform_run(px_row, w, tol=6):
    """从两端向中间找「可被视为边框」的稳定像素长度（相邻差 <= tol）。"""
    def run(seq):
        n = 0
        for i in range(1, len(seq)):
            p, q = seq[i - 1], seq[i]
            if abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol and abs(p[2] - q[2]) <= tol:
                n += 1
            else:
                break
        return n
    return run(px_row)


for rel in TARGETS:
    path = f"{BASE}\\{rel}"
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    print(f"\n=== {rel}  {w}x{h} ===")
    rep = alpha_bbox_report(im)
    if rep:
        bb, margins = rep
        print(f"  opaque bbox={bb}  margins L/T/R/B={margins}")
    # 水平中线与垂直中线的边框稳定性（估计九宫格 border 像素）
    mid_y = h // 2
    mid_x = w // 2
    row = [im.getpixel((x, mid_y)) for x in range(w)]
    col = [im.getpixel((mid_x, y)) for y in range(h)]
    print(f"  horiz border run: left={uniform_run(row, w)} right={uniform_run(row[::-1], w)}")
    print(f"  vert  border run: top={uniform_run(col, h)} bottom={uniform_run(col[::-1], h)}")
    # 角/中心/边中点取样（帮助判断底板色系）
    pts = {
        "TL": (2, 2), "T": (w // 2, 2), "TR": (w - 3, 2),
        "L": (2, h // 2), "C": (w // 2, h // 2), "R": (w - 3, h // 2),
        "BL": (2, h - 3), "B": (w // 2, h - 3), "BR": (w - 3, h - 3),
    }
    s = "  samples: " + "  ".join(f"{k}={im.getpixel(v)}" for k, v in pts.items())
    print(s)
