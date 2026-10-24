/**
 * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜一屏式版面几何 + 九宫格绘制（纯函数 / 纯绘制，零状态）。
 *
 * 为什么单独成文件：版面几何是「验收 3：390×844 无缺失/拉伸/严重留白/文字遮挡」的**唯一真源**，
 * 也是 E2E 真实点击坐标与定向 vitest 的共同口径。放进 1986 行的 advPage 里就无法单测。
 *
 * 一屏式四段（Queue 必改 1）：
 *   ① TOP         0..92     常驻：DAY 进度 + 实时耐久 + 阶段（不随阶段消失）
 *   ② STAGE      92..470    常驻：**同一冒险舞台**（战斗/事件/胜利/败退都在这里，不换页）
 *   ③ NARRATIVE 470..744    常驻：固定叙事区（1–2 张浅色事件记录卡；需要二选一时就地变可点选项）
 *   ④ ACTION    744..844    常驻：底部**唯一**主操作位（战斗中不铺假按钮）
 *
 * 关键纪律（对应 Queue 禁止项）：
 *   - 舞台高度恒定 ⇒ F1/F6 的战斗裁切只在**一个固定高度**上求解，不会因换阶段改变舞台带尺寸
 *     （旧实现 RESULT 会把舞台从 648 缩到 468，这正是「结果页突然缩放」的结构性成因之一）；
 *   - 素材一律九宫格 / 等比 contain 绘制，**禁止非等比拉伸**（`drawNineSlice` 的 corners 保证角落像素 1:1）。
 */

/** 竖屏逻辑舞台（与 PORTRAIT_LOGICAL_W/H 同源；此处只做布局常量，不 import 运行时）。 */
export const UXW = 390;
export const UX_H = 844;
/** 别名（语义更直白；与 UXW 成对使用）。 */
export const UXH = UX_H;

export interface UxRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** ① 顶部常驻状态层。 */
export const UX_TOP: UxRect = { x: 0, y: 0, w: UXW, h: 92 };
/**
 * ② 同一冒险舞台（**高度恒定**；所有阶段共用，绝不因阶段改变尺寸）。
 * 92..470 = 378 高。战斗视图的安全区按此高度建，F1 等比 / F6 平滑在此固定范围内生效。
 */
export const UX_STAGE: UxRect = { x: 0, y: 92, w: UXW, h: 378 };
/** ③ 固定叙事区（底板 + 1–2 张记录卡；决策时就地换成选项卡）。 */
export const UX_NARRATIVE: UxRect = { x: 0, y: 470, w: UXW, h: 274 };
/** ④ 底部唯一主操作位。 */
export const UX_ACTION: UxRect = { x: 0, y: 744, w: UXW, h: 100 };

/** 主按钮矩形（底部带内居中；E2E / 命中区 / 绘制同源）。 */
export const UX_ACTION_BTN: UxRect = { x: 34, y: 758, w: 322, h: 66 };
/** 终局大号 CTA（完整包含 UX_ACTION_BTN 命中区，保证可见即可点）。 */
export const UX_TERMINAL_CTA: UxRect = { x: 34, y: 736, w: 322, h: 88 };

/** 叙事区内部几何。 */
export const UX_NARRATIVE_CARD: UxRect = { x: 14, y: 486, w: 362, h: 246 };

/**
 * 叙事区选项卡（事件二选一 / 强化三选一）。
 *
 * 卡片**全部在叙事区内**（不再覆盖整个舞台）：Queue 必改 1 要求「中下部承接事件、奖励和战斗结果」，
 * 因此决策也发生在叙事区的固定位置，上方的冒险舞台始终可见（对应卡皮巴拉录像的「覆在舞台上」语义，
 * 但采用更适合 390×844「上舞台下叙事」的分区布局，不遮挡战斗画面）。
 */
export function uxOptionRects(count: number): UxRect[] {
  const n = Math.max(0, Math.min(4, count));
  if (n === 0) return [];
  const x = UX_NARRATIVE_CARD.x;
  const w = UX_NARRATIVE_CARD.w;
  const top = UX_NARRATIVE_CARD.y;
  const availH = UX_NARRATIVE_CARD.h;
  /**
   * R2：卡片高度按「三行结构」的真实需要分配，不再一律均分满高。
   *
   * 旧实现把叙事区可用高度平均切给 n 张卡（n=2 ⇒ 118px，n=3 ⇒ 78px）。
   * 78px 要塞「名称 19px + 收益 14px + 代价 14px」三行 ⇒ 行距被压到 26px，
   * 观感就是「挤压」。R2 给每张卡一个**下限 92px**（三行 + 上下留白），
   * 数量多时自动减少间距而不是压行高；若所需总高超出，再按比例收缩（有下限保护）。
   */
  const minCardH = 78;
  /**
   * 目标高度：**先充分利用可用空间，再受上限约束**，且**必须容得下**。
   *   · n=2（事件二选一）：每张可达 128px —— 三行文字有充裕行距，不再「挤」；
   *   · n=3（强化三选一）：每张可达 100px —— 高于 78 下限，三行可读；
   *   · n=4（极端情形）：按可用空间均分，但不低于 78。
   * ⚠️ 无论 n 多少，总高**绝不超出**可用区（否则会压到下方动作带 —— 实测 n=4 时
   *    旧算法会溢出到 y=778 > 744）。先按可用高度均分，再用上限收敛，最后夹下限；
   *    下限只保证「不被压扁」，不会被用来突破可用区（若真放不下，宁可缩小 gap）。
   */
  const maxCardH = n <= 2 ? 132 : n === 3 ? 100 : 84;
  let gap = n >= 3 ? 8 : 12;
  let h = Math.floor((availH - (n - 1) * gap) / n);
  h = Math.min(maxCardH, h);
  h = Math.max(minCardH, h);
  // 兜底：若「n×h + (n−1)×gap」仍超出可用高，**先收 gap，再收 h**，直到严格放得下。
  // （实测 n=4：availH=274，若 h 取 floor(274/4)=68 而 gap 仍为 8，总高 296 ⇒ 溢出 22px）
  while (n * h + (n - 1) * gap > availH && gap > 0) gap -= 2;
  while (n * h + (n - 1) * gap > availH && h > 1) h -= 1;
  const totalH = n * h + (n - 1) * gap;
  // 居中；但**严格夹紧**在可用区内（实测 n=4 场景下居中公式会溢出 4px）
  const maxStart = UX_NARRATIVE_CARD.y + Math.max(0, availH - totalH);
  const startY = Math.min(maxStart, Math.max(UX_NARRATIVE_CARD.y, top + Math.floor((availH - totalH) / 2)));
  const out: UxRect[] = [];
  for (let i = 0; i < n; i++) out.push({ x, y: startY + i * (h + gap), w, h });
  return out;
}

/** 叙事区可视行数（信息卡：标题 + 至多 N 行正文 + 效果行）。 */
export const UX_NARRATIVE_MAX_LINES = 5;

export function uxHit(r: UxRect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/* ------------------------------------------------------------------ 九宫格 */

export interface NineSliceInsets {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * 九宫格绘制：四角保持**原始像素 1:1**，四边单轴拉伸，中心双轴拉伸。
 *
 * 非等比拉伸禁令（Queue 必改 3）的落实点：
 *   - 角落只要 `corners=true` 就不会被缩放（圆角/描边/高光保持原样）；
 *   - `insets` 由调用方按素材真实透明边给出（见 `advUiAssets.ts` 的 NINE_SLICE 表，逐张量过），
 *     不按「目测大概」猜；
 *   - 目标尺寸小于四角之和时自动按比例收缩 insets（避免负宽度导致 drawImage 抛错 / 出现裂缝）。
 *
 * @returns false = 素材不可用（调用方自行降级过程式绘制，绝不白屏）
 */
export function drawNineSlice(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  insets: NineSliceInsets,
): boolean {
  const sw = img.width;
  const sh = img.height;
  if (!(sw > 0 && sh > 0) || !(dw > 0 && dh > 0)) return false;
  // 目标小于「四角之和」时按比例收缩边角（保持四角比例关系，绝不产生负宽/负高）
  const kx = Math.min(1, dw / (insets.left + insets.right || 1));
  const ky = Math.min(1, dh / (insets.top + insets.bottom || 1));
  const l = Math.min(insets.left, sw / 2) ;
  const r = Math.min(insets.right, sw / 2);
  const t = Math.min(insets.top, sh / 2);
  const b = Math.min(insets.bottom, sh / 2);
  const dl = l * kx;
  const dr = r * kx;
  const dt = t * ky;
  const db = b * ky;
  const dwMid = dw - dl - dr;
  const dhMid = dh - dt - db;
  const swMid = sw - l - r;
  const shMid = sh - t - b;
  const push = (sx: number, sy: number, sWidth: number, sHeight: number, tx: number, ty: number, tw: number, th: number): void => {
    if (sWidth <= 0 || sHeight <= 0 || tw <= 0 || th <= 0) return;
    ctx.drawImage(img, sx, sy, sWidth, sHeight, tx, ty, tw, th);
  };
  // 四角（1:1 像素，仅按 kx/ky 等比收缩）
  push(0, 0, l, t, dx, dy, dl, dt);
  push(sw - r, 0, r, t, dx + dw - dr, dy, dr, dt);
  push(0, sh - b, l, b, dx, dy + dh - db, dl, db);
  push(sw - r, sh - b, r, b, dx + dw - dr, dy + dh - db, dr, db);
  // 四边
  push(l, 0, swMid, t, dx + dl, dy, dwMid, dt);
  push(l, sh - b, swMid, b, dx + dl, dy + dh - db, dwMid, db);
  push(0, t, l, shMid, dx, dy + dt, dl, dhMid);
  push(sw - r, t, r, shMid, dx + dw - dr, dy + dt, dr, dhMid);
  // 中心
  push(l, t, swMid, shMid, dx + dl, dy + dt, dwMid, dhMid);
  return true;
}

/**
 * 等比 contain 绘制（图标 / 宝箱 / 旗帜等不可拉伸素材）。
 * 返回实际绘制的矩形（供测试断言「未被拉伸」）。
 */
export function drawContain(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): UxRect | null {
  const sw = img.width;
  const sh = img.height;
  if (!(sw > 0 && sh > 0) || !(dw > 0 && dh > 0)) return null;
  const k = Math.min(dw / sw, dh / sh);
  const w = sw * k;
  const h = sh * k;
  const x = dx + (dw - w) / 2;
  const y = dy + (dh - h) / 2;
  ctx.drawImage(img, x, y, w, h);
  return { x, y, w, h };
}
