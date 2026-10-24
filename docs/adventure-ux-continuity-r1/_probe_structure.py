"""R1 素材结构速览 v5：把素材量化成字符图，直接读出边框/圆角/文本区的位置。

输出到 stdout；每张图最多 60 列 x 40 行（采样），字符表示亮度：
  ' ' 透明   '.' 很暗   ':' 暗   '-' 中   '=' 亮   '#' 很亮   '@' 近白
这样无需看图即可判断「四角圆角半径 / 边框厚度 / 中央是否平色」。
"""
from PIL import Image

BASE = r"D:\1020卡皮巴拉\unpacked_1.9.3\assets\sprites"
TARGETS = [
    "atlasraft/battle_event_text_bg.png",
    "atlasraft/btn_green.png",
    "atlasraft/battle_event_bg.png",
    "atlasraft/battle_event_btn_chat.png",
    "atlasraft/battle_event_title_bg.png",
]
RAMP = " .:-=#@"


def gray(p):
    if p[3] < 8:
        return -1
    return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) * (p[3] / 255)


for rel in TARGETS:
    im = Image.open(f"{BASE}\\{rel}").convert("RGBA")
    w, h = im.size
    COLS, ROWS = 58, 30
    print(f"\n===== {rel}  {w}x{h} =====")
    for ry in range(ROWS):
        line = ""
        for rx in range(COLS):
            x = min(w - 1, int((rx + 0.5) * w / COLS))
            y = min(h - 1, int((ry + 0.5) * h / ROWS))
            g = gray(im.getpixel((x, y)))
            if g < 0:
                line += " "
            else:
                idx = 1 + min(len(RAMP) - 2, int(g / 256 * (len(RAMP) - 2)))
                line += RAMP[idx]
        print(f"  {line}")
