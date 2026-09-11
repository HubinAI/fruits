/**
 * PBL-F0-PORTRAIT-BATTLE-LAB-FOUNDATION｜竖屏战场实验台 targeted 测试。
 *
 * 覆盖四层：
 *   1) 常量契约：逻辑基准竖屏 390×844（宽 < 高）；
 *   2) 目录完整性：Arena A/B、Loadout ×2、Encounter ×3，id 唯一且默认值合法；
 *   3) 状态机：选择项切换 / running 中变更回 idle / Start 幂等 / Reset 归零；
 *   4) 固定摄像机：正式共享契约 PlayerViewportTransform 直接支持竖屏逻辑尺寸
 *      （contain 数学 + client→logical 归一化），证明本实验台未引入第二套坐标系统；
 *   5) 隔离守卫：Lab 源码不得 import 任何正式玩法模块；正式入口 / 正式构建配置
 *      不得引用 portrait-lab（防止竖屏实验规则被写入正式玩法默认路径）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  LAB_ARENAS,
  LAB_DEFAULTS,
  LAB_ENCOUNTERS,
  LAB_LOADOUTS,
  PORTRAIT_LOGICAL_H,
  PORTRAIT_LOGICAL_W,
} from '../src/lab/portraitBattleLab/constants';
import {
  createPortraitLabState,
  findArena,
  findEncounter,
  findLoadout,
  labSummary,
  reset,
  setArena,
  setEncounter,
  setLoadout,
  start,
} from '../src/lab/portraitBattleLab/state';
import {
  LAB_GROUND_Y,
  arenaMarkers,
  enemyMarkerRects,
  playerBodyRect,
  stageRect,
} from '../src/lab/portraitBattleLab/layout';
import { PlayerViewportTransform } from '../src/platform/playerViewport';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAB_DIR = join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab');

/** 近似相等（浮点）。 */
function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

/** 矩形是否完整落在舞台内。 */
function insideStage(r: { x: number; y: number; w: number; h: number }): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= PORTRAIT_LOGICAL_W && r.y + r.h <= PORTRAIT_LOGICAL_H;
}

/** 矩形相交判定（严格相交；边贴边不算）。 */
function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('PBL-F0｜逻辑基准：竖屏 390×844', () => {
  it('R1 逻辑舞台宽高为 390×844 且为竖屏（宽 < 高）', () => {
    expect(PORTRAIT_LOGICAL_W).toBe(390);
    expect(PORTRAIT_LOGICAL_H).toBe(844);
    expect(PORTRAIT_LOGICAL_W).toBeLessThan(PORTRAIT_LOGICAL_H);
  });

  it('R2 stageRect 覆盖整个逻辑舞台', () => {
    expect(stageRect()).toEqual({ x: 0, y: 0, w: 390, h: 844 });
  });
});

describe('PBL-F0｜目录完整性（Arena A/B · Loadout ×2 · Encounter ×3）', () => {
  it('R3 Arena 恰好为 A / B 两个占位且 id 唯一', () => {
    expect(LAB_ARENAS.map((a) => a.id)).toEqual(['A', 'B']);
    expect(new Set(LAB_ARENAS.map((a) => a.id)).size).toBe(LAB_ARENAS.length);
  });

  it('R4 Loadout 为西瓜重炮 / 香蕉冲锋锤且 id 唯一', () => {
    expect(LAB_LOADOUTS.map((l) => l.label)).toEqual(['西瓜重炮', '香蕉冲锋锤']);
    expect(new Set(LAB_LOADOUTS.map((l) => l.id)).size).toBe(LAB_LOADOUTS.length);
  });

  it('R5 Encounter 为追猎者 / 远程炮台 / 3 轻敌人且 id 唯一', () => {
    expect(LAB_ENCOUNTERS.map((e) => e.label)).toEqual(['追猎者', '远程炮台', '3 轻敌人']);
    expect(new Set(LAB_ENCOUNTERS.map((e) => e.id)).size).toBe(LAB_ENCOUNTERS.length);
  });

  it('R6 默认值必须命中各自目录（不允许悬空默认）', () => {
    expect(findArena(LAB_DEFAULTS.arena)).toBeDefined();
    expect(findLoadout(LAB_DEFAULTS.loadout)).toBeDefined();
    expect(findEncounter(LAB_DEFAULTS.encounter)).toBeDefined();
  });
});

describe('PBL-F0｜状态机：选择切换 / Start / Reset', () => {
  it('R7 初始状态为 idle、startCount=0、选择项=默认', () => {
    const s = createPortraitLabState();
    expect(s.phase).toBe('idle');
    expect(s.startCount).toBe(0);
    expect(s.arena).toBe(LAB_DEFAULTS.arena);
    expect(s.loadout).toBe(LAB_DEFAULTS.loadout);
    expect(s.encounter).toBe(LAB_DEFAULTS.encounter);
  });

  it('R8 Arena A→B 切换生效且 revision 递增；同值切换为 no-op（同引用）', () => {
    const s0 = createPortraitLabState();
    expect(setArena(s0, 'A')).toBe(s0); // 同值 no-op
    const s1 = setArena(s0, 'B');
    expect(s1.arena).toBe('B');
    expect(s1.revision).toBe(s0.revision + 1);
  });

  it('R9 Loadout / Encounter 切换生效；未知 id 忽略（不抛错、不递增 revision）', () => {
    const s0 = createPortraitLabState();
    const s1 = setLoadout(s0, LAB_LOADOUTS[1].id);
    expect(s1.loadout).toBe(LAB_LOADOUTS[1].id);
    expect(setLoadout(s1, 'not-a-loadout')).toBe(s1);

    const s2 = setEncounter(s0, LAB_ENCOUNTERS[2].id);
    expect(s2.encounter).toBe(LAB_ENCOUNTERS[2].id);
    expect(setEncounter(s2, 'not-an-encounter')).toBe(s2);
  });

  it('R10 Start：idle → running 且 startCount+1；running 中重复 Start 幂等', () => {
    const s0 = createPortraitLabState();
    const s1 = start(s0);
    expect(s1.phase).toBe('running');
    expect(s1.startCount).toBe(1);
    expect(start(s1)).toBe(s1); // 幂等：同引用
    expect(start(s1).startCount).toBe(1);
  });

  it('R11 running 中切换任一选择项 → 回到 idle（配置已变，占位运行中止）', () => {
    const running = start(createPortraitLabState());
    expect(running.phase).toBe('running');
    expect(setArena(running, 'B').phase).toBe('idle');
    expect(setLoadout(running, LAB_LOADOUTS[1].id).phase).toBe('idle');
    expect(setEncounter(running, LAB_ENCOUNTERS[1].id).phase).toBe('idle');
  });

  it('R12 Reset：回到 idle + 选择项恢复默认 + startCount 归零', () => {
    let s = createPortraitLabState();
    s = setArena(s, 'B');
    s = setLoadout(s, LAB_LOADOUTS[1].id);
    s = setEncounter(s, LAB_ENCOUNTERS[2].id);
    s = start(s);
    expect(s.phase).toBe('running');

    const r = reset(s);
    expect(r.phase).toBe('idle');
    expect(r.startCount).toBe(0);
    expect(r.arena).toBe(LAB_DEFAULTS.arena);
    expect(r.loadout).toBe(LAB_DEFAULTS.loadout);
    expect(r.encounter).toBe(LAB_DEFAULTS.encounter);
    expect(r.revision).toBeGreaterThan(s.revision); // 显式动作必递增
  });

  it('R13 Start → 切换 → Start：startCount 累计为 2（Reset 前不清零）', () => {
    let s = start(createPortraitLabState());
    s = setArena(s, 'B'); // → idle
    s = start(s);
    expect(s.startCount).toBe(2);
    expect(s.phase).toBe('running');
  });

  it('R14 labSummary 解析标签（UI 视图，不改变状态）', () => {
    const s = setEncounter(setArena(createPortraitLabState(), 'B'), LAB_ENCOUNTERS[2].id);
    const sum = labSummary(s);
    expect(sum.arenaLabel).toBe('Arena B');
    expect(sum.encounterLabel).toBe('3 轻敌人');
    expect(sum.phase).toBe('idle');
  });
});

describe('PBL-F0｜占位几何（全部为逻辑 px 且不越界）', () => {
  it('R15 地面线 = 舞台高度 74% 取整', () => {
    expect(LAB_GROUND_Y).toBe(Math.round(844 * 0.74));
    expect(LAB_GROUND_Y).toBeGreaterThan(0);
    expect(LAB_GROUND_Y).toBeLessThan(PORTRAIT_LOGICAL_H);
  });

  it('R16 玩家占位轮廓贴地、居中于左半区、落在舞台内（两种 Loadout）', () => {
    for (const l of LAB_LOADOUTS) {
      const r = playerBodyRect(l.body);
      expect(insideStage(r)).toBe(true);
      expect(r.y + r.h).toBe(LAB_GROUND_Y); // 贴地
      expect(r.x + r.w / 2).toBeLessThan(PORTRAIT_LOGICAL_W / 2); // 左半区
    }
  });

  it('R17 敌人占位标记数量 = enemyCount，贴地（或按 lift 抬高）且不越界', () => {
    for (const e of LAB_ENCOUNTERS) {
      const rects = enemyMarkerRects(e);
      expect(rects.length).toBe(e.enemyCount);
      for (const r of rects) {
        expect(insideStage(r)).toBe(true);
        expect(r.y + r.h).toBe(LAB_GROUND_Y - e.markerLift);
      }
    }
  });

  it('R18 Arena 占位标记：A / B 布局不同（切换可见），且均不越界', () => {
    const a = arenaMarkers('A');
    const b = arenaMarkers('B');
    expect(a.length).toBe(2);
    expect(b.length).toBe(3);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    for (const r of [...a, ...b]) expect(insideStage(r)).toBe(true);
  });

  it('R25 占位矩形互不重叠（各占位色块像素面积可精确断言的前提）', () => {
    for (const arena of LAB_ARENAS) {
      const markers = arenaMarkers(arena.id);
      for (const l of LAB_LOADOUTS) {
        const player = playerBodyRect(l.body);
        for (const e of LAB_ENCOUNTERS) {
          const enemies = enemyMarkerRects(e);
          const tag = `${arena.id}/${l.id}/${e.id}`;
          for (const en of enemies) expect(overlaps(player, en), `${tag} 玩家与敌人重叠`).toBe(false);
          for (const r of [player, ...enemies]) {
            for (const m of markers) expect(overlaps(r, m), `${tag} 占位与 Arena 标记重叠`).toBe(false);
          }
        }
      }
    }
  });
});

describe('PBL-F0｜固定摄像机复用正式共享契约（竖屏逻辑尺寸）', () => {
  it('R19 PlayerViewportTransform 直接支持 390×844，contain 缩放居中（横屏容器）', () => {
    const vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
    vp.update(1280, 720, 1);
    const expected = Math.min(1280 / 390, 720 / 844);
    expect(near(vp.scale, expected)).toBe(true);
    expect(near(vp.scale, 720 / 844)).toBe(true); // 受高度约束（竖屏舞台）
    expect(near(vp.offsetX, (1280 - 390 * vp.scale) / 2)).toBe(true);
    expect(near(vp.offsetY, 0)).toBe(true);
    // CSS rect 必须完整落在容器内，且为竖屏比例
    const rect = vp.cssRect();
    const h = rect.h;
    expect(rect.y + h).toBeLessThanOrEqual(720 + 1e-9);
    expect(h / rect.w).toBeGreaterThan(1); // 高 > 宽 → 竖屏
    expect(near(h / rect.w, 844 / 390, 1e-6)).toBe(true);
  });

  it('R20 容器恰为 390×844 → scale=1、无偏移（逻辑 px 即屏幕 px）', () => {
    const vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
    vp.update(390, 844, 2);
    expect(near(vp.scale, 1)).toBe(true);
    expect(near(vp.offsetX, 0)).toBe(true);
    expect(near(vp.offsetY, 0)).toBe(true);
    expect(vp.dpr).toBe(2);
    expect(vp.logicalToSurface(390, 844)).toEqual({ x: 780, y: 1688 });
  });

  it('R21 client→logical 归一化：竖屏 rect 下两端点精确映射到 (0,0) / (390,844)', () => {
    const vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
    const rect = { left: 100, top: 50, width: 195, height: 422 }; // 0.5x 显示
    const p0 = vp.clientToLogical(100, 50, rect);
    const p1 = vp.clientToLogical(295, 472, rect);
    expect(near(p0.x, 0, 1e-9)).toBe(true);
    expect(near(p0.y, 0, 1e-9)).toBe(true);
    expect(near(p1.x, 390, 1e-9)).toBe(true);
    expect(near(p1.y, 844, 1e-9)).toBe(true);
  });
});

describe('PBL-F0｜隔离守卫（实验不得写入正式玩法路径）', () => {
  it('R22 Lab 源码不得 import 任何正式玩法 / 平台 bootstrap 模块', () => {
    const files = readdirSync(LAB_DIR).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    // 允许的唯一外部相对依赖：../../platform/playerViewport（纯坐标契约，无副作用）
    const forbidden =
      /from\s+['"]\.\.\/\.\.\/(battle|game|render|ui|core|presentation|physics|player|dev)\/|from\s+['"]\.\.\/\.\.\/(main|platform\/bootstrap|platform\/bootstrap-wechat)/;
    for (const f of files) {
      const src = readFileSync(join(LAB_DIR, f), 'utf8');
      expect(forbidden.test(src), `${f} 不得 import 正式玩法模块`).toBe(false);
    }
  });

  it('R23 正式入口 index.html 与四个正式构建配置均不得引用 portrait-lab', () => {
    const targets = [
      'index.html',
      'vite.config.ts',
      'vite.pages.config.ts',
      'vite.e2e.config.ts',
      'vite.wechat.config.ts',
    ];
    for (const t of targets) {
      const src = readFileSync(join(REPO_ROOT, t), 'utf8');
      expect(src.includes('portrait-lab'), `${t} 不得引用 portrait-lab`).toBe(false);
      expect(src.includes('portraitBattleLab'), `${t} 不得引用 portraitBattleLab`).toBe(false);
    }
  });

  it('R24 Lab 入口文件独立存在且不被正式入口引用', () => {
    const labEntry = readFileSync(join(REPO_ROOT, 'portrait-lab.html'), 'utf8');
    expect(labEntry.includes('src/lab/portraitBattleLab/main.ts')).toBe(true);
    const labMain = readFileSync(join(LAB_DIR, 'main.ts'), 'utf8');
    expect(labMain.includes("from './lab'")).toBe(true);
  });
});
