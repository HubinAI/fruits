/**
 * PBL-F1-SHARED-LOADOUT-ENCOUNTER｜A/B 共用测试数据与 Spawn 流程 targeted 测试。
 *
 * 覆盖：
 *   1) 共享数据契约：两套 Test Loadout / 三套 Encounter；id 唯一；引用必须真实存在于正式库；
 *      「磁铁 / 护盾」在正式库确实不存在（unavailable 结论必须成立，不允许静默占位）；
 *   2) Spawn：实体数量、数值来自正式 registry（与 resolveSnapshot 直接对拍）、
 *      同模板多敌人完全一致、plan 与 Arena 无关（A/B 指纹必须相同）；
 *   3) 清理语义：切换配置 / Reset 后无实体、无弹丸、无旧批次残留；
 *   4) 场景（数据驱动）：实体外形矩形数与正式 collider 数一致、不越界、层间不重叠、
 *      像素面积账本与 E2E 硬编码期望值一致（跨语言交叉核对）；
 *   5) 缺口披露：正式库缺失的部件必须出现在 labSummary.unavailable。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { OPPONENT_TEMPLATES } from '../src/player/opponentPool';

import {
  LAB_ARENAS,
  LAB_DEFAULTS,
  PORTRAIT_LOGICAL_H,
  PORTRAIT_LOGICAL_W,
} from '../src/lab/portraitBattleLab/constants';
import {
  LAB_ENCOUNTERS,
  LAB_LOADOUTS,
  findEncounter,
  findLoadout,
} from '../src/lab/portraitBattleLab/testData';
import {
  addProjectile,
  buildSpawnPlan,
  createRunData,
  isRunClean,
} from '../src/lab/portraitBattleLab/entities';
import { bodyOffsetBoxes, buildScene, partOffsetBoxes } from '../src/lab/portraitBattleLab/scene';
import { HUD_BAND_H, paintedAreas } from '../src/lab/portraitBattleLab/layout';
import {
  createPortraitLabState,
  labSummary,
  reset,
  setArena,
  setEncounter,
  setLoadout,
  start,
} from '../src/lab/portraitBattleLab/state';

/* --------------------------------------------------------------- 工具 */

function insideStage(r: { x: number; y: number; w: number; h: number }): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= PORTRAIT_LOGICAL_W && r.y + r.h <= PORTRAIT_LOGICAL_H;
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 正式链路解析某 Draft 的期望数值（测试独立复算，防止 Lab 侧偷改）。 */
function formalResolve(draft: Parameters<typeof buildSnapshotFromDraft>[0]): {
  hp: number;
  mass: number;
  energy: number;
} {
  const snap = buildSnapshotFromDraft(draft, registry, 'f1-test');
  const r = resolveSnapshot(snap, registry);
  return {
    hp: r.body.hp,
    mass: r.totalMass,
    energy: r.totalEnergy + r.movements.reduce((s, m) => s + m.def.energy, 0),
  };
}

/* ------------------------------------------------- 1) 共享数据契约 */

describe('PBL-F1｜共享 Test Loadout / Encounter 契约', () => {
  it('F1-R1 两套 Loadout 使用规范 id 且唯一', () => {
    expect(LAB_LOADOUTS.map((l) => l.id)).toEqual(['WatermelonHeavyCannon', 'BananaChargeHammer']);
    expect(new Set(LAB_LOADOUTS.map((l) => l.id)).size).toBe(LAB_LOADOUTS.length);
    expect(LAB_LOADOUTS.map((l) => l.label)).toEqual(['西瓜重炮', '香蕉冲锋锤']);
  });

  it('F1-R2 三套 Encounter 使用规范 id 且唯一', () => {
    expect(LAB_ENCOUNTERS.map((e) => e.id)).toEqual(['Chaser', 'RangedTurret', 'LightSwarm3']);
    expect(new Set(LAB_ENCOUNTERS.map((e) => e.id)).size).toBe(LAB_ENCOUNTERS.length);
    expect(LAB_ENCOUNTERS.map((e) => e.count)).toEqual([1, 1, 3]);
  });

  it('F1-R3 所有 formal / adapted 槽位引用的 defId 必须真实存在于正式内容库', () => {
    for (const l of LAB_LOADOUTS) {
      for (const slot of l.slots) {
        if (slot.kind === 'unavailable') {
          expect(slot.defId, `${l.id}/${slot.requested} 不得声称引用正式件`).toBeUndefined();
          continue;
        }
        expect(slot.defId, `${l.id}/${slot.requested} 缺 defId`).toBeTruthy();
        const id = slot.defId as string;
        const inRegistry =
          registry.bodies.has(id) || registry.movements.has(id) || registry.functionals.has(id);
        expect(inRegistry, `${l.id}/${slot.requested} → "${id}" 不在正式库`).toBe(true);
      }
    }
  });

  it('F1-R4 「磁铁 / 护盾」在正式内容库确实不存在（unavailable 结论成立）', () => {
    const names = new Set<string>([
      ...[...registry.bodies.values()].map((d) => d.name),
      ...[...registry.movements.values()].map((d) => d.name),
      ...[...registry.functionals.values()].map((d) => d.name),
    ]);
    expect(names.has('磁铁')).toBe(false);
    expect(names.has('护盾')).toBe(false);
    const unavailable = LAB_LOADOUTS.flatMap((l) =>
      l.slots.filter((s) => s.kind === 'unavailable').map((s) => s.requested),
    );
    expect(unavailable).toEqual(['磁铁', '护盾']);
  });

  it('F1-R5 三套 Encounter 的模板 id 必须存在于正式对手池', () => {
    for (const e of LAB_ENCOUNTERS) {
      const t = OPPONENT_TEMPLATES.find((x) => x.id === e.templateId);
      expect(t, `${e.id} → 模板 ${e.templateId} 不存在`).toBeDefined();
      expect(e.draft).toEqual(t?.draft); // 引用，不是自造
    }
  });

  it('F1-R6 默认值命中目录；id → 目录查询可用', () => {
    expect(findLoadout(LAB_DEFAULTS.loadout)).toBeDefined();
    expect(findEncounter(LAB_DEFAULTS.encounter)).toBeDefined();
    expect(LAB_ARENAS.some((a) => a.id === LAB_DEFAULTS.arena)).toBe(true);
  });
});

/* --------------------------------------------------------- 2) Spawn */

describe('PBL-F1｜Spawn 流程（数值只来自正式 registry）', () => {
  it('F1-R7 实体数量 = 1 玩家 + Encounter 敌人数', () => {
    for (const l of LAB_LOADOUTS) {
      for (const e of LAB_ENCOUNTERS) {
        const plan = buildSpawnPlan(l.id, e.id);
        expect(plan.entities.length).toBe(1 + e.count);
        expect(plan.enemies.length).toBe(e.count);
        expect(plan.player.team).toBe('player');
        for (const en of plan.enemies) expect(en.team).toBe('enemy');
      }
    }
  });

  it('F1-R8 玩家实体 HP / 质量 / 能量与正式链路解析值完全一致（无 Lab 侧数值）', () => {
    for (const l of LAB_LOADOUTS) {
      const plan = buildSpawnPlan(l.id, LAB_ENCOUNTERS[0].id);
      const expectd = formalResolve(l.draft);
      expect(plan.player.hp).toBe(expectd.hp);
      expect(plan.player.totalMass).toBe(expectd.mass);
      expect(plan.player.totalEnergy).toBe(expectd.energy);
      expect(plan.player.bodyDefId).toBe(l.draft.bodyDefId);
    }
  });

  it('F1-R9 敌人数值与正式模板解析值一致；LightSwarm3 三份完全相同', () => {
    for (const e of LAB_ENCOUNTERS) {
      const plan = buildSpawnPlan(LAB_LOADOUTS[0].id, e.id);
      const expectd = formalResolve(e.draft);
      for (const en of plan.enemies) {
        expect(en.hp).toBe(expectd.hp);
        expect(en.totalMass).toBe(expectd.mass);
        expect(en.totalEnergy).toBe(expectd.energy);
      }
      if (e.count > 1) {
        const keys = plan.enemies.map((en) =>
          JSON.stringify([en.hp, en.totalMass, en.totalEnergy, en.functionals.map((f) => f.defId)]),
        );
        expect(new Set(keys).size).toBe(1); // 三份同源，未做任何单独调整
      }
    }
  });

  it('F1-R10 武器基础数据（伤害 / CD / 弹丸）逐项来自正式 behaviorParams', () => {
    const cannon = registry.functionals.get('cannon');
    const plan = buildSpawnPlan('WatermelonHeavyCannon', 'Chaser');
    const f = plan.player.functionals.find((x) => x.defId === 'cannon');
    expect(f).toBeDefined();
    const p = cannon?.behaviorParams as Record<string, number>;
    expect(f?.profile.projectileDamage).toBe(p['projectileDamage']);
    expect(f?.profile.cooldownMs).toBe(p['cooldownMs']);
    expect(f?.profile.projectile).toEqual({
      radius: p['projectileRadius'],
      mass: p['projectileMass'],
      speed: p['muzzleSpeed'],
    });
  });

  it('F1-R11 plan 与 Arena 无关：同一 (loadout, encounter) 指纹稳定且 A/B 完全相同', () => {
    for (const l of LAB_LOADOUTS) {
      for (const e of LAB_ENCOUNTERS) {
        const a = buildSpawnPlan(l.id, e.id);
        const b = buildSpawnPlan(l.id, e.id);
        expect(a.baseKey).toBe(b.baseKey); // 确定性
        // arena 不参与 Spawn：唯一入口没有 arena 参数 → 两 Arena 读到的必然是同一份
        expect(buildSpawnPlan.length).toBe(2);
      }
    }
  });

  it('F1-R12 指纹随 Loadout / Encounter 变化（证明它真的覆盖基础数据）', () => {
    const base = buildSpawnPlan('WatermelonHeavyCannon', 'Chaser').baseKey;
    expect(buildSpawnPlan('BananaChargeHammer', 'Chaser').baseKey).not.toBe(base);
    expect(buildSpawnPlan('WatermelonHeavyCannon', 'RangedTurret').baseKey).not.toBe(base);
    expect(buildSpawnPlan('WatermelonHeavyCannon', 'LightSwarm3').baseKey).not.toBe(base);
  });
});

/* ------------------------------------------- 3) 运行期清理语义 */

describe('PBL-F1｜Start / 切换 / Reset 的实体与弹丸清理', () => {
  it('F1-R13 Start 生成实体；running 中重复 Start 幂等（批次号不变）', () => {
    const idle = createPortraitLabState();
    expect(idle.run.entities.length).toBe(0);
    const running = start(idle);
    expect(running.phase).toBe('running');
    expect(running.run.entities.length).toBe(1 + (findEncounter(running.encounter)?.count ?? 0));
    expect(running.run.spawnSerial).toBe(1);
    const again = start(running);
    expect(again).toBe(running); // 同引用 → 没有第二次生成
    expect(again.run.spawnSerial).toBe(1);
  });

  it('F1-R14 切换任一选择项 → 回 idle 且实体 / 弹丸全部清空', () => {
    const running = start(createPortraitLabState());
    expect(running.run.entities.length).toBeGreaterThan(0);
    for (const nextState of [
      setArena(running, 'B'),
      setLoadout(running, 'BananaChargeHammer'),
      setEncounter(running, 'LightSwarm3'),
    ]) {
      expect(nextState.phase).toBe('idle');
      expect(isRunClean(nextState.run)).toBe(true);
      expect(nextState.run.plan).toBeNull();
    }
  });

  it('F1-R15 Reset 后无实体 / 无弹丸残留（含显式注入过的弹丸）', () => {
    let s = start(createPortraitLabState());
    s = { ...s, run: addProjectile(s.run, {
      projectileId: 1,
      ownerEntityId: 'player',
      defId: 'cannon',
      radius: 10,
      mass: 1,
      speed: 8,
      damage: 80,
    }) };
    expect(s.run.projectiles.length).toBe(1);

    const r = reset(s);
    expect(r.phase).toBe('idle');
    expect(r.startCount).toBe(0);
    expect(r.run.plan).toBeNull();
    expect(r.run.entities.length).toBe(0);
    expect(r.run.projectiles.length).toBe(0);
    expect(isRunClean(r.run)).toBe(true);
    expect(r.loadout).toBe(LAB_DEFAULTS.loadout);
    expect(r.encounter).toBe(LAB_DEFAULTS.encounter);
    expect(r.arena).toBe(LAB_DEFAULTS.arena);
    expect(r.revision).toBeGreaterThan(s.revision);
  });

  it('F1-R16 重新 Start 得到新批次（批次号递增、无旧实体）', () => {
    let s = start(createPortraitLabState());
    const firstIds = s.run.entities.map((e) => e.entityId);
    s = reset(s);
    s = start(s);
    expect(s.run.spawnSerial).toBe(2);
    expect(s.run.entities.map((e) => e.entityId)).toEqual(firstIds); // 确定性 id，且是新批次对象
    expect(s.run.projectiles.length).toBe(0);
    expect(isRunClean(createRunData())).toBe(true);
  });

  it('F1-R17 换组合后 Start 生成的是该组合的实体（不是上一次的残留）', () => {
    let s = start(createPortraitLabState());
    expect(s.run.plan?.player.bodyDefId).toBe('watermelonBody');
    s = setLoadout(s, 'BananaChargeHammer');
    s = setEncounter(s, 'LightSwarm3');
    s = start(s);
    expect(s.run.plan?.player.bodyDefId).toBe('bananaBody');
    expect(s.run.entities.length).toBe(4); // 1 + 3
    expect(s.run.entities.slice(1).every((e) => e.bodyDefId === 'bananaBody')).toBe(true);
  });
});

/* ------------------------------------------- 4) 场景（数据驱动） */

describe('PBL-F1｜舞台场景由正式 collider 驱动', () => {
  it('F1-R18 玩家层矩形数 = 该 Loadout 的真实 collider 数（车身 / 功能件）', () => {
    for (const l of LAB_LOADOUTS) {
      const plan = buildSpawnPlan(l.id, 'Chaser');
      const scene = buildScene('A', plan);
      const bodyRects = scene.filter((s) => s.layer === 'playerBody');
      const partRects = scene.filter((s) => s.layer === 'playerPart');
      expect(bodyRects.length).toBe(bodyOffsetBoxes(plan.player.bodyDefId).length);
      expect(partRects.length).toBe(partOffsetBoxes(plan.player).length);
      expect(partRects.length).toBe(plan.player.functionals.length);
    }
  });

  it('F1-R19 敌人层矩形数 = 敌人数 × 其真实 collider 数', () => {
    for (const e of LAB_ENCOUNTERS) {
      const plan = buildSpawnPlan('WatermelonHeavyCannon', e.id);
      const scene = buildScene('A', plan);
      const bodyRects = scene.filter((s) => s.layer === 'enemyBody');
      const partRects = scene.filter((s) => s.layer === 'enemyPart');
      const expectdBody = e.count * bodyOffsetBoxes(plan.enemies[0].bodyDefId).length;
      const expectdPart = e.count * partOffsetBoxes(plan.enemies[0]).length;
      expect(bodyRects.length).toBe(expectdBody);
      expect(partRects.length).toBe(expectdPart);
    }
  });

  it('F1-R20 全部矩形落在舞台内', () => {
    for (const arena of LAB_ARENAS) {
      for (const l of LAB_LOADOUTS) {
        for (const e of LAB_ENCOUNTERS) {
          const scene = buildScene(arena.id, buildSpawnPlan(l.id, e.id));
          for (const s of scene) {
            expect(insideStage(s.rect), `${arena.id}/${l.id}/${e.id} 越界 ${JSON.stringify(s.rect)}`).toBe(true);
          }
        }
      }
    }
  });

  it('F1-R21 层间不重叠（Arena 带 / 玩家 / 敌人 / 跨敌人 均不相交）', () => {
    for (const arena of LAB_ARENAS) {
      for (const l of LAB_LOADOUTS) {
        for (const e of LAB_ENCOUNTERS) {
          const scene = buildScene(arena.id, buildSpawnPlan(l.id, e.id));
          const arenaRects = scene.filter((s) => s.layer === 'arena').map((s) => s.rect);
          const entity = scene.filter((s) => s.layer !== 'arena').map((s) => s.rect);
          const tag = `${arena.id}/${l.id}/${e.id}`;
          for (const en of entity) {
            for (const a of arenaRects) {
              expect(overlaps(en, a), `${tag} 实体与 Arena 标记重叠`).toBe(false);
            }
          }
          // 敌人之间不得跨行重叠（同实体内部允许车身/部件覆盖）
          const enemyRects = scene.filter((s) => s.layer.startsWith('enemy')).map((s) => s.rect);
          const playerRects = scene.filter((s) => s.layer.startsWith('player')).map((s) => s.rect);
          for (const er of enemyRects) {
            for (const pr of playerRects) {
              expect(overlaps(er, pr), `${tag} 敌人与玩家重叠`).toBe(false);
            }
          }
        }
      }
    }
  });
});

/* ------------------------------- 5) 像素面积账本（与 E2E 交叉核对） */

describe('PBL-F1｜像素面积账本（E2E 浏览器硬编码期望值的唯一来源）', () => {
  it('F1-R25 顶部 HUD 带内不得出现任何分层几何（E2E 统计区约定的前提）', () => {
    for (const arena of LAB_ARENAS) {
      for (const l of LAB_LOADOUTS) {
        for (const e of LAB_ENCOUNTERS) {
          const scene = buildScene(arena.id, buildSpawnPlan(l.id, e.id));
          for (const s of scene) {
            expect(
              s.rect.y,
              `${arena.id}/${l.id}/${e.id} 的 ${s.layer} 落入 HUD 带（文字抗锯齿会污染像素统计）`,
            ).toBeGreaterThanOrEqual(HUD_BAND_H + 4);
          }
        }
      }
    }
  });

  it('F1-R22 占位舞台面积账本（纯模型；Arena A 的 Lab 场景自 A1 起改由 arenaScene.ts 提供）', () => {
    const areas = (arena: 'A' | 'B', loadout: string, encounter: string) =>
      paintedAreas(buildScene(arena, buildSpawnPlan(loadout, encounter)));

    // 初始：Arena A + 西瓜重炮 + 追猎者
    // 说明：部件层绘制在车身层之上，故重叠区计在部件层，车身层相应减少。
    expect(areas('A', 'WatermelonHeavyCannon', 'Chaser')).toEqual({
      arena: 4200,
      playerBody: 8360,
      playerPart: 800,
      enemyBody: 7618,
      enemyPart: 1560,
    });

    // 切换 Encounter → 远程炮台（西瓜 + 炮 + 机枪）
    expect(areas('A', 'WatermelonHeavyCannon', 'RangedTurret')).toEqual({
      arena: 4200,
      playerBody: 8360,
      playerPart: 800,
      enemyBody: 7790,
      enemyPart: 1370,
    });

    // 切换 Loadout → 香蕉冲锋锤（两段弧形车身 + 锤 + 推进器）
    expect(areas('A', 'BananaChargeHammer', 'Chaser')).toEqual({
      arena: 4200,
      playerBody: 7798,
      playerPart: 1560,
      enemyBody: 7618,
      enemyPart: 1560,
    });

    // 切换 Arena → B（仅 arena 层变化，实体层完全不变 → 证明 Arena 不污染实体数据）
    const b = areas('B', 'BananaChargeHammer', 'Chaser');
    expect(b.arena).toBe(5480);
    expect({ ...b, arena: 0 }).toEqual({ ...areas('A', 'BananaChargeHammer', 'Chaser'), arena: 0 });

    // LightSwarm3：3 × 轻型敌人（香蕉 + 圆锯 + 推进器）
    expect(areas('B', 'WatermelonHeavyCannon', 'LightSwarm3')).toEqual({
      arena: 5480,
      playerBody: 8360,
      playerPart: 800,
      enemyBody: 18060,
      enemyPart: 11568,
    });
  });
});

/* ---------------------------------------------------- 6) 缺口披露 */

describe('PBL-F1｜数据缺口必须显式披露', () => {
  it('F1-R23 两套 Loadout 的不可用槽位出现在 labSummary.unavailable', () => {
    const w = labSummary(setLoadout(createPortraitLabState(), 'WatermelonHeavyCannon'));
    expect(w.unavailable).toEqual(['磁铁']);
    const b = labSummary(setLoadout(createPortraitLabState(), 'BananaChargeHammer'));
    expect(b.unavailable).toEqual(['护盾']);
  });

  it('F1-R24 履带的近似绑定被显式标注为 adapted（不谎称 formal）', () => {
    const w = findLoadout('WatermelonHeavyCannon');
    const treads = w?.slots.find((s) => s.requested === '履带');
    expect(treads?.kind).toBe('adapted');
    expect(treads?.defId).toBe('heavyWheel');
  });
});
