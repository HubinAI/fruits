/**
 * PBL-F0-PORTRAIT-BATTLE-LAB-FOUNDATION｜竖屏战场实验台 targeted 测试（F0 契约层）。
 *
 * 覆盖四层：
 *   1) 常量契约：逻辑基准竖屏 390×844（宽 < 高）；
 *   2) 目录完整性：Arena A/B、Loadout ×2、Encounter ×3，id 唯一且默认值合法；
 *   3) 状态机：选择项切换 / running 中变更回 idle / Start 幂等 / Reset 归零；
 *   4) 固定摄像机：正式共享契约 PlayerViewportTransform 直接支持竖屏逻辑尺寸
 *      （contain 数学 + client→logical 归一化），证明本实验台未引入第二套坐标系统；
 *   5) 隔离守卫（PBL-F1 起收紧为**单向**）：
 *      - 反向硬约束：正式源码 / 正式入口 / 四个正式构建配置 0 引用本实验台；
 *      - 正向白名单：本实验台只允许 import 明确列出的**只读纯数据模块**
 *        （registry / 解析 / 校验 / 坐标契约 / 对手模板），且不得 import
 *        任何 Runtime / DOM / 平台 / 物理模块。
 *
 * F1 的共享测试数据与 Spawn 流程断言见 tests/portraitBattleLabF1.test.ts。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  LAB_ARENAS,
  LAB_DEFAULTS,
  PORTRAIT_LOGICAL_H,
  PORTRAIT_LOGICAL_W,
} from '../src/lab/portraitBattleLab/constants';
import { LAB_ENCOUNTERS, LAB_LOADOUTS } from '../src/lab/portraitBattleLab/testData';
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
  ARENA_BAND_BOTTOM,
  ENTITY_CENTER_X,
  LAB_GROUND_Y,
  arenaMarkerArea,
  arenaMarkers,
  boxBounds,
  enemyPlacement,
  overlaps,
  playerPlacement,
  rectsArea,
  stageRect,
} from '../src/lab/portraitBattleLab/layout';
import { bodyOffsetBoxes, buildScene } from '../src/lab/portraitBattleLab/scene';
import { arenaAScene } from '../src/lab/portraitBattleLab/arenaScene';
import { ArenaARuntime } from '../src/lab/portraitBattleLab/arenaA';
import { buildSpawnPlan } from '../src/lab/portraitBattleLab/entities';
import { paintedAreas } from '../src/lab/portraitBattleLab/layout';
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
  it('R3 Arena 恰好为 A / B 两个且 id 唯一', () => {
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
  it('R7 初始状态为 idle、startCount=0、选择项=默认、场上无实体', () => {
    const s = createPortraitLabState();
    expect(s.phase).toBe('idle');
    expect(s.startCount).toBe(0);
    expect(s.arena).toBe(LAB_DEFAULTS.arena);
    expect(s.loadout).toBe(LAB_DEFAULTS.loadout);
    expect(s.encounter).toBe(LAB_DEFAULTS.encounter);
    expect(s.run.entities.length).toBe(0);
    expect(s.run.projectiles.length).toBe(0);
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

  it('R11 running 中切换任一选择项 → 回到 idle（配置已变，运行中止）', () => {
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
    expect(sum.unavailable).toEqual(['磁铁']); // 默认 Loadout 的缺口如实暴露
  });
});

describe('PBL-F0｜占位几何（全部为逻辑 px 且不越界）', () => {
  it('R15 地面线 = 舞台高度 74% 取整', () => {
    expect(LAB_GROUND_Y).toBe(Math.round(844 * 0.74));
    expect(LAB_GROUND_Y).toBeGreaterThan(0);
    expect(LAB_GROUND_Y).toBeLessThan(PORTRAIT_LOGICAL_H);
  });

  it('R16 玩家实体矩形组：贴地、水平居中的左右对称、落在舞台内（两种 Loadout）', () => {
    for (const l of LAB_LOADOUTS) {
      const boxes = bodyOffsetBoxes(l.draft.bodyDefId);
      const rects = playerPlacement(boxes);
      expect(rects.length).toBe(boxes.length);
      for (const r of rects) expect(insideStage(r)).toBe(true);
      const b = boxBounds(boxes);
      const lowest = Math.max(...rects.map((r) => r.y + r.h));
      expect(lowest).toBe(LAB_GROUND_Y); // 贴地
      // 外接框中心 == 舞台中心（居中排布）
      const cx = b.dx + b.w / 2;
      expect(near(cx, 0)).toBe(true);
    }
    expect(ENTITY_CENTER_X).toBe(Math.round(PORTRAIT_LOGICAL_W / 2));
  });

  it('R17 敌人实体矩形组：数量 = 该 Body 的 collider 数、逐行下移、落在舞台内', () => {
    for (const e of LAB_ENCOUNTERS) {
      const boxes = bodyOffsetBoxes(e.draft.bodyDefId);
      const bounds = boxBounds(boxes);
      const rows = Array.from({ length: e.count }, (_, i) => enemyPlacement(boxes, bounds, i));
      expect(rows.length).toBe(e.count);
      for (const row of rows) {
        expect(row.length).toBe(boxes.length);
        for (const r of row) expect(insideStage(r)).toBe(true);
      }
      for (let i = 1; i < rows.length; i++) {
        const prevBottom = Math.max(...rows[i - 1].map((r) => r.y + r.h));
        const curTop = Math.min(...rows[i].map((r) => r.y));
        expect(curTop).toBeGreaterThan(prevBottom); // 行间留空隙，不与上一行重叠
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
    expect(arenaMarkerArea('A')).toBe(4200);
    expect(arenaMarkerArea('B')).toBe(5480);
    expect(rectsArea(a)).toBe(4200);
  });

  it('R25 Arena 标记互不重叠，且整体位于实体活动区之下（不与任何实体相交）', () => {
    for (const arena of LAB_ARENAS) {
      const markers = arenaMarkers(arena.id);
      for (let i = 0; i < markers.length; i++) {
        for (let j = i + 1; j < markers.length; j++) {
          expect(overlaps(markers[i], markers[j]), `${arena.id} 标记自重叠`).toBe(false);
        }
        // 全部标记在下方信息带内（底边 = ARENA_BAND_BOTTOM）
        expect(markers[i].y + markers[i].h).toBe(ARENA_BAND_BOTTOM);
      }
      for (const l of LAB_LOADOUTS) {
        const player = playerPlacement(bodyOffsetBoxes(l.draft.bodyDefId));
        for (const p of player) {
          for (const m of markers) expect(overlaps(p, m)).toBe(false);
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

describe('PBL-F0/F1｜隔离守卫（单向：实验不得写入正式玩法路径）', () => {
  /**
   * PBL-F1 起，Lab 必须**只读引用**正式内容库来建立 A/B 共用数据；
   * PBL-A1 起，Arena A 必须复用**共享 Battle Foundation**（F2 的真实多实体碰撞 +
   * 实例级伤害路由 + 正式武器行为链）与 Planck 物理原语 —— 否则只能自造代理碰撞体 /
   * 第二套物理语义，那是 Queue 明令禁止的。因此守卫从「禁止一切正式 import」收紧为
   * 「**显式枚举的白名单** + 反单向」，白名单只列到具体模块（不允许整目录通配），
   * 且下列正式玩法 Runtime / 渲染 / UI / 平台 / 开发工具**永远禁止**：
   *   planckBattleOrchestrator / planckMovement / playerGameRuntime / canvasPlayerUIHost /
   *   webDomPlayerUIHost / garage* / fusion* / render* / ui* / dev* / platform 引导。
   */
  const ALLOWED_RELATIVE_IMPORTS = new Set([
    '../buildEditorModel', // Lab 既有纯模型（BuildDraft / EMPTY_SLOT）
    '../../core/content', // 只读内容库（PBL-F1）
    '../../core/buildSnapshot', // 纯解析
    '../../core/buildValidator', // 纯校验
    '../../core/types', // 仅类型
    '../../player/opponentPool', // 只读对手模板数据（PBL-F1）
    '../../platform/playerViewport', // 纯坐标契约（PBL-F0）
    // ---- PBL-A1：共享 Battle Foundation（真实 1vN 复用的最小必要集，逐个枚举）----
    '../../battle/planckVehicleAssembly', // 真实车辆装配（含 F2 的 collision policy）
    '../../battle/contactRouter', // 实例级接触路由（F2）
    '../../battle/damageResolver', // 真实伤害结算
    '../../battle/combatEvents', // 事件总线（仅类型 + 纯实现）
    '../../battle/behaviorRuntime', // 行为运行时接口（仅类型）
    '../../battle/behaviorRegistry', // 正式武器 / 辅助行为工厂
    // ---- PBL-A1：Planck 物理原语（俯视世界，不做第二套物理）----
    '../../physics/planckWorld',
    '../../physics/units',
  ]);

  const FORBIDDEN_RELATIVE =
    /^\.\.\/\.\.\/(game|render|ui|presentation|dev|platform\/(?!playerViewport))|^\.\.\/\.\.\/(main|platform\/bootstrap)/;

  /** 即便落在允许目录内，也不得被 Lab 引用的正式玩法 / 侧视驱动模块（A1 起显式钉死）。 */
  const FORBIDDEN_MODULES = [
    '../../battle/planckBattleOrchestrator',
    '../../battle/planckMovement',
    '../../battle/vehicleAssembly',
    '../../battle/battleHost',
  ];

  function labSourceFiles(): string[] {
    return readdirSync(LAB_DIR).filter((f) => f.endsWith('.ts'));
  }

  function importSpecifiers(src: string): string[] {
    const out: string[] = [];
    const re = /from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
    return out;
  }

  it('R22a Lab 源码只 import 白名单内的只读模块，且不含任何 Runtime / DOM / 平台 / 物理模块', () => {
    const files = labSourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const f of files) {
      for (const spec of importSpecifiers(readFileSync(join(LAB_DIR, f), 'utf8'))) {
        if (!spec.startsWith('.')) continue; // 裸包名不在守卫范围
        if (spec.startsWith('./')) continue; // Lab 内部互相引用
        seen.add(spec);
        expect(FORBIDDEN_RELATIVE.test(spec), `${f} 不得 import "${spec}"`).toBe(false);
        expect(
          FORBIDDEN_MODULES.includes(spec),
          `${f} 不得 import 正式玩法 / 侧视驱动模块 "${spec}"`,
        ).toBe(false);
        expect(ALLOWED_RELATIVE_IMPORTS.has(spec), `${f} import "${spec}" 不在白名单内`).toBe(true);
      }
    }
    // 白名单必须真被用到（防止守卫写成空转）
    expect(seen.size).toBeGreaterThan(0);
    // 白名单条目必须全部命中（防止成为「看起来宽松」的死配置）
    for (const allowed of ALLOWED_RELATIVE_IMPORTS) {
      if (allowed.startsWith('../') && !allowed.startsWith('../../')) continue; // Lab 内部模块名不参与
      expect(seen.has(allowed), `白名单条目 "${allowed}" 从未被任何 Lab 文件引用`).toBe(true);
    }
  });

  it('R22a-2 PBL-A1：Arena A 不得调用正式侧视驱动（不伪造 wheel-ground grounded）', () => {
    // 必须先剥掉注释：本文件的注释里**刻意**写着「不调用 drivePlanckVehicle / 不 setPosition」，
    // 直接做字符串匹配会被自家注释骗过（守卫必须能扛住这种自指陷阱）。
    const raw = readFileSync(join(LAB_DIR, 'arenaA.ts'), 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // 正式侧视驱动与 1v1 编排器都不得出现在 Arena A 的可执行代码中
    expect(code.includes('drivePlanckVehicle')).toBe(false);
    expect(code.includes('PlanckBattleOrchestrator')).toBe(false);
    expect(code.includes('planckBattleOrchestrator')).toBe(false);
    // 不得写速度 / 位置状态（驱动只能来自真实冲量）
    expect(code.includes('setLinearVelocity')).toBe(false);
    expect(code.includes('setAngularVelocity')).toBe(false);
    expect(code.includes('grounded')).toBe(false);
    // setPosition 只允许出现在「出生定位」辅助函数里（唯一一次），不得用于运行期移动
    expect(code.split('setPosition(').length - 1).toBe(1);
    expect(code.includes('function translateVehicle(')).toBe(true);
    // 注释剥除不能把整个文件削空（防止正则写错导致守卫空转）
    expect(code.length).toBeGreaterThan(raw.length * 0.5);
  });

  it('R22a-3 PBL-A1：Lab 的 Arena A 场景必须来自真实物理快照（arenaScene），且与占位舞台可区分', () => {
    const lab = readFileSync(join(LAB_DIR, 'lab.ts'), 'utf8');
    // 接线：Lab 必须从 arenaScene 取 Arena A 场景
    expect(lab.includes("from './arenaScene'")).toBe(true);
    expect(lab.includes('arenaAScene(')).toBe(true);
    // 路由：arenaScene 只在 arena === 'A' 时走真实快照（其余 Arena 仍走占位舞台）
    const routing = readFileSync(join(LAB_DIR, 'arenaScene.ts'), 'utf8');
    expect(routing.includes("arena === 'A'")).toBe(true);
    expect(routing.includes('arenaAScene(arenaAView)')).toBe(true);
    // 两条来源确实不同 → 防止「悄悄换回占位舞台」而外部断言看不出来（Arena A 的 arena 层
    // 从占位窄带 4200 变成四边实体边界 25200）
    const plan = buildSpawnPlan('WatermelonHeavyCannon', 'Chaser');
    const placeholder = paintedAreas(buildScene('A', plan));
    const real = paintedAreas(arenaAScene(new ArenaARuntime(plan).view()));
    expect(real.arena).toBe(25200);
    expect(placeholder.arena).not.toBe(real.arena);
  });

  it('R22b 反向硬约束：src/ 下（Lab 目录之外）0 处引用 portraitBattleLab / portrait-lab', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'portraitBattleLab') continue;
          walk(p);
        } else if (entry.name.endsWith('.ts')) {
          const src = readFileSync(p, 'utf8');
          if (src.includes('portraitBattleLab') || src.includes('portrait-lab')) {
            offenders.push(p.replace(REPO_ROOT, '').replace(/\\/g, '/'));
          }
        }
      }
    };
    walk(join(REPO_ROOT, 'src'));
    expect(offenders).toEqual([]);
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
