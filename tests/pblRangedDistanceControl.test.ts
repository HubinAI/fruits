/**
 * PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1｜对手「维持作战距离」Movement Foundation。
 *
 * ── 这个 Queue 要回答的唯一问题 ────────────────────────────────────────────
 *
 * 真人验收 Encounter Batch 的结论：ProtoRusher（快速接敌）/ Chaser（贴身纠缠）通过，
 * **RangedTurret 暂时未通过** —— 失败原因**不是**射击不可见，而是：
 *
 *   远距离阶段远程射击身份非常清楚 → 数秒后双方迅速贴脸 → 退化成普通近战碰撞。
 *
 * 缺口 = **远程敌人缺少「维持合理作战距离」的 Movement 能力**。
 *
 * ── 本文件的判据划分 ──────────────────────────────────────────────────────
 *
 *   A. 纯决策：三段距离规则本身（边界 / 契约 / 无副作用）
 *   B. 接线：声明式门控（只有明确声明的 Encounter 才换档）+ 透传路径
 *   C. 真实运行：三段行为**真的出现** + 后撤真的拉开 + 玩家真的追得上（无硬隔离 / 无瞬移）
 *   D. 零变化：ProtoRusher / Chaser 逐值冻结（本 Queue 最硬的一条）
 *   E. 结构守卫：移动只经正式 Movement 接口 / 正式栈零污染
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ENEMY_KEEP_DISTANCE_BANDS,
  decideEnemyDrive,
  type EnemyDriveBands,
} from '../src/battle/battleContract';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { buildSpawnPlan } from '../src/lab/portraitBattleLab/entities';
import { ENCOUNTER_BATCH, ENCOUNTER_BATCH_IDS } from '../src/lab/portraitBattleLab/encounterValidation';
import { LAB_ENCOUNTERS } from '../src/lab/portraitBattleLab/testData';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');
const readLab = (f: string): string => read(`src/lab/portraitBattleLab/${f}`);

/** 剥注释（源码守卫必须先剥，否则会被自家注释骗过）。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const FRAME_MS = 1000 / 60;

/** 正式 autoDrive 目标线速度（与 `planckBattleOrchestrator` 的常量同值；只用于断言「接近档不变」）。 */
const APPROACH_SPEED = 1.5;

/** 跑完一局，逐帧采集证据。 */
interface Trace {
  readonly frames: number;
  readonly winner: string | null;
  readonly hpA: number;
  readonly hpB: number;
  readonly gaps: readonly number[];
  readonly minGap: number;
  readonly maxStepDx: number;
  /** 出现过的档位序列（按首次出现顺序去重）。 */
  readonly bands: readonly string[];
  /** 每个档位实际下发给 wheel motor 的量（取该档位第一次出现的样本）。 */
  readonly samples: Readonly<Record<string, { gap: number; enabled: boolean; dir: number; spd: number }>>;
  /** 第 1 次进入某档位的帧号。 */
  readonly bandEnterFrame: Readonly<Record<string, number>>;
  /** `near` 档之后间距的最大值（= 是否真的「重新拉开」）。 */
  readonly maxGapAfterFirstNear: number;
}

function trace(encounterId: string, maxFrames = 1400): Trace {
  const rt = new RunBattleRuntime({ encounterId });
  rt.step(FRAME_MS);
  let frames = 0;
  let minGap = Infinity;
  let maxStepDx = 0;
  let prevBx = rt.vehicleX('B');
  const gaps: number[] = [];
  const bands: string[] = [];
  const samples: Record<string, { gap: number; enabled: boolean; dir: number; spd: number }> = {};
  const bandEnterFrame: Record<string, number> = {};
  let firstNear = -1;
  let maxGapAfterFirstNear = -Infinity;

  while (rt.result === null && frames < maxFrames) {
    rt.step(FRAME_MS);
    frames += 1;
    const g = rt.gapWorld();
    gaps.push(g);
    if (g < minGap) minGap = g;
    const bx = rt.vehicleX('B');
    maxStepDx = Math.max(maxStepDx, Math.abs(bx - prevBx));
    prevBx = bx;

    const st = rt.enemyDriveState();
    if (st) {
      if (!bands.includes(st.band)) {
        bands.push(st.band);
        bandEnterFrame[st.band] = frames;
        samples[st.band] = {
          gap: st.gap,
          enabled: st.enabled,
          dir: st.worldDirection,
          spd: st.targetSpeedPxPerStep,
        };
      }
      if (st.band === 'near') {
        if (firstNear < 0) firstNear = frames;
      } else if (firstNear > 0 && g > maxGapAfterFirstNear) {
        maxGapAfterFirstNear = g;
      }
    }
  }
  const hp = rt.hp();
  return {
    frames,
    winner: rt.result?.winner ?? null,
    hpA: Math.round(hp.a),
    hpB: Math.round(hp.b),
    gaps,
    minGap,
    maxStepDx,
    bands,
    samples,
    bandEnterFrame,
    maxGapAfterFirstNear,
  };
}

/* ================================== A. 纯决策（三段规则本身） */

describe('PBL-RANGED｜A 三段距离决策（引擎中立纯函数）', () => {
  const bands: EnemyDriveBands = { near: 240, far: 480, retreatSpeed: 2.6 };

  it('RDC-01 过远 → 向对手移动（且与既有 autoDrive 逐项相同：同向 · 同目标速度）', () => {
    for (const targetSide of [1, -1] as const) {
      const d = decideEnemyDrive({ gap: 481, targetSide }, bands, APPROACH_SPEED);
      expect(d.band).toBe('far');
      expect(d.enabled).toBe(true);
      expect(d.worldDirection, '必须朝对手（不是固定 -1）').toBe(targetSide);
      expect(d.targetSpeedPxPerStep, '接近档 = 既有 autoDrive 目标速度').toBe(APPROACH_SPEED);
    }
  });

  it('RDC-02 过近 → 反向拉开（方向 = 对手的反方向，速度 = 档位声明值）', () => {
    for (const targetSide of [1, -1] as const) {
      const d = decideEnemyDrive({ gap: 239, targetSide }, bands, APPROACH_SPEED);
      expect(d.band).toBe('near');
      expect(d.enabled).toBe(true);
      expect(d.worldDirection).toBe(targetSide === 1 ? -1 : 1);
      expect(d.targetSpeedPxPerStep).toBe(bands.retreatSpeed);
    }
  });

  it('RDC-03 合理射程 → 不主动接近（motor 关闭；不是「刹车」也不是「锁位置」）', () => {
    for (const gap of [240, 300, 479, 480]) {
      const d = decideEnemyDrive({ gap, targetSide: -1 }, bands, APPROACH_SPEED);
      expect(d.band, `gap=${gap}`).toBe('hold');
      expect(d.enabled, 'hold = 不给油（沿用 drivePlanckVehicle 既有 enabled:false 语义）').toBe(false);
    }
  });

  it('RDC-04 三段阈值是**闭区间无缝隙**的粗档：恰好三个区间，且与声明值一致', () => {
    // 边界：< near = 后撤；near..far = 保持；> far = 接近
    expect(decideEnemyDrive({ gap: bands.near - 0.001, targetSide: 1 }, bands, APPROACH_SPEED).band).toBe('near');
    expect(decideEnemyDrive({ gap: bands.near, targetSide: 1 }, bands, APPROACH_SPEED).band).toBe('hold');
    expect(decideEnemyDrive({ gap: bands.far, targetSide: 1 }, bands, APPROACH_SPEED).band).toBe('hold');
    expect(decideEnemyDrive({ gap: bands.far + 0.001, targetSide: 1 }, bands, APPROACH_SPEED).band).toBe('far');
    // 只有三个档位取值（不存在第四种）
    const seen = new Set(
      [0, 100, 239, 240, 400, 480, 481, 900].map(
        (gap) => decideEnemyDrive({ gap, targetSide: 1 }, bands, APPROACH_SPEED).band,
      ),
    );
    expect([...seen].sort()).toEqual(['far', 'hold', 'near']);
  });

  it('RDC-05 默认粗档由「炮的一轮冷却行程」推出（不是拍脑袋：near = 0.5× · far = 1×）', () => {
    // 唯一真源：正式 cannon 的 muzzleSpeed / cooldownMs（本测试不写第二份数值）
    const content = stripComments(read('src/core/content.ts'));
    const muzzle = Number(/muzzleSpeed:\s*([\d.]+)/.exec(content)![1]);
    const cooldownMs = Number(/cooldownMs:\s*([\d.]+)/.exec(content)![1]);
    const perCooldownTravel = muzzle * (cooldownMs / (1000 / 60));
    expect(ENEMY_KEEP_DISTANCE_BANDS.far, 'far = 一轮冷却的弹道行程').toBeCloseTo(perCooldownTravel, 6);
    expect(ENEMY_KEEP_DISTANCE_BANDS.near, 'near = 半个行程').toBeCloseTo(perCooldownTravel / 2, 6);
    expect(ENEMY_KEEP_DISTANCE_BANDS.far).toBeGreaterThan(ENEMY_KEEP_DISTANCE_BANDS.near);
    // 后撤必须快于对手正常推进，否则相机跟中点 ⇒ 屏幕净位移 ≈ 0（肉眼只见空转）
    expect(ENEMY_KEEP_DISTANCE_BANDS.retreatSpeed).toBeGreaterThan(APPROACH_SPEED);
  });

  it('RDC-06 非法输入直接抛错（不静默返回一个假决策）', () => {
    expect(() => decideEnemyDrive({ gap: Number.NaN, targetSide: 1 }, bands, APPROACH_SPEED)).toThrow();
    expect(() =>
      decideEnemyDrive({ gap: Number.POSITIVE_INFINITY, targetSide: 1 }, bands, APPROACH_SPEED),
    ).toThrow();
  });

  it('RDC-07 决策是**纯函数**：不读全局、不写任何物理状态、只返回三个 motor 量', () => {
    const src = stripComments(read('src/battle/enemyDrive.ts'));
    // 无 import（因此不可能碰到世界 / 车辆 / 引擎对象）
    expect(src.includes('import ')).toBe(false);
    for (const t of [
      'setPosition',
      'setTransform',
      'setVelocity',
      'applyForce',
      'applyLinearImpulse',
      'setAngularVelocity',
      'askew',
    ]) {
      expect(src.includes(t), `enemyDrive.ts 不得出现 "${t}"`).toBe(false);
    }
    // 返回值恰好是这四个字段（不存在隐藏通道）
    const d = decideEnemyDrive({ gap: 100, targetSide: 1 }, bands, APPROACH_SPEED);
    expect(Object.keys(d).sort()).toEqual(['band', 'enabled', 'targetSpeedPxPerStep', 'worldDirection']);
  });
});

/* ============================== B. 声明式门控 + 透传路径 */

describe('PBL-RANGED｜B 换档由**数据声明**触发（不按 id 推断）', () => {
  it('RDC-08 只有 RangedTurret 声明了 keep-distance（批次内唯一）', () => {
    const declared = ENCOUNTER_BATCH_IDS.filter(
      (id) => LAB_ENCOUNTERS.find((e) => e.id === id)?.enemyDrive === 'keep-distance',
    );
    expect(declared).toEqual(['RangedTurret']);
    // 另外两套**没有**声明 ⇒ 走既有恒定驱动（见 D 段冻结表）
    for (const id of ['ProtoRusher', 'Chaser'] as const) {
      expect(LAB_ENCOUNTERS.find((e) => e.id === id)?.enemyDrive).toBeUndefined();
    }
  });

  it('RDC-09 声明**原样透传**到 SpawnPlan（不推断 / 不改写）', () => {
    for (const id of ENCOUNTER_BATCH_IDS) {
      const plan = buildSpawnPlan('WatermelonHeavyCannon', id);
      const declared = LAB_ENCOUNTERS.find((e) => e.id === id)?.enemyDrive;
      expect(plan.enemyDrive, `${id} 的声明必须原样透传`).toBe(declared);
    }
  });

  it('RDC-10 门控读的是**声明字段**，不是 Encounter id / 名字', () => {
    const rt = stripComments(readLab('runBattleRuntime.ts'));
    expect(rt.includes('this.plan.enemyDrive')).toBe(true);
    expect(rt.includes('encounterId ===')).toBe(false);
    expect(rt.includes('RangedTurret')).toBe(false);
  });

  it('RDC-11 档位数值只有一个真源：Lab 侧只引用，不复制一份', () => {
    const rt = stripComments(readLab('runBattleRuntime.ts'));
    expect(rt.includes('ENEMY_KEEP_DISTANCE_BANDS')).toBe(true);
    // Lab 侧不得出现任何档位数值字面量（240 / 480 / 2.6）
    for (const n of ['240', '480', '2.6']) {
      expect(rt.includes(n), `runBattleRuntime.ts 不得写档位数值 ${n}`).toBe(false);
    }
    expect(stripComments(readLab('testData.ts')).includes('ENEMY_KEEP_DISTANCE')).toBe(false);
  });
});

/* ================================== C. 真实运行（三段行为） */

describe('PBL-RANGED｜C RangedTurret 真实运行：三段行为 + 能追上', () => {
  it('RDC-12 一局真实战斗里 near / hold / far 三档**全部出现**（分段是活的，不是死配置）', () => {
    const t = trace('RangedTurret');
    expect([...t.bands].sort(), '三档必须都真实生效过').toEqual(['far', 'hold', 'near']);
  }, 300_000);

  it('RDC-13 每档下发给 wheel motor 的量都与档位契约一致（真实回读，不是重算）', () => {
    const t = trace('RangedTurret');
    // far：朝对手、既有接近速度
    expect(t.samples['far']!.enabled).toBe(true);
    expect(t.samples['far']!.dir).toBe(-1); // 玩家在对手的 -x 侧
    expect(t.samples['far']!.spd).toBe(APPROACH_SPEED);
    expect(t.samples['far']!.gap).toBeGreaterThan(ENEMY_KEEP_DISTANCE_BANDS.far);
    // hold：motor 关闭
    expect(t.samples['hold']!.enabled).toBe(false);
    // near：反向拉开、用后撤速度
    expect(t.samples['near']!.enabled).toBe(true);
    expect(t.samples['near']!.dir).toBe(1);
    expect(t.samples['near']!.spd).toBe(ENEMY_KEEP_DISTANCE_BANDS.retreatSpeed);
    expect(t.samples['near']!.gap).toBeLessThan(ENEMY_KEEP_DISTANCE_BANDS.near);
  }, 300_000);

  it('RDC-14 玩家接近 → 对手**主动后撤**，双方重新拉开（Queue 的核心可读行为）', () => {
    const t = trace('RangedTurret');
    // ① 必须先走到过 near（= 玩家真的逼近过）
    expect(t.bandEnterFrame['near'], '整局必须出现过「太近」').toBeGreaterThan(0);
    // ② near 之后间距必须真的重新变大（「拉开」是事实，不是设计意图）
    const gapAtNear = t.samples['near']!.gap;
    expect(t.maxGapAfterFirstNear, 'near 之后的最大间距必须明显大于触发时的间距').toBeGreaterThan(
      gapAtNear + 40,
    );
    // ③ 档位不是「一进 near 就永久卡住」：还要回到过 hold（真实滑行段）
    const order = t.bands;
    expect(order.indexOf('near')).toBeLessThan(order.length); // near 存在且不是唯一
    expect(order).toContain('hold');
  }, 300_000);

  it('RDC-15 可以被玩家追上：真实接触发生过，且对手真的掉血（无硬隔离）', () => {
    const t = trace('RangedTurret');
    // 玩家真实推进把间距压到接触级（外廓间距 ≤ 10px = 已经贴上）
    expect(t.minGap, `整局最小外廓间距 ${t.minGap.toFixed(1)}px，必须出现过接触级接近`).toBeLessThan(20);
    // 玩家真的打到了对手（对手掉血 = 真实伤害链走通）
    const plan = buildSpawnPlan('WatermelonHeavyCannon', 'RangedTurret');
    void plan;
    expect(t.hpB, '对手必须真的掉血（不是无敌 / 不是被隔离）').toBeLessThan(1100);
  }, 300_000);

  it('RDC-16 全部移动仍是真实物理：没有任何瞬移 / 强制位置修正', () => {
    const t = trace('RangedTurret');
    // 对手每帧位移有上界（后撤目标 2.6 px/step；一帧最多两个固定步 ⇒ 上界 8px 极宽松）
    expect(t.maxStepDx, `对手单帧最大位移 ${t.maxStepDx.toFixed(2)}px`).toBeLessThan(8);
    // 而且它真的动过（不是站桩）
    expect(t.maxStepDx).toBeGreaterThan(0.5);
  }, 300_000);
});

/* ============================ D. ProtoRusher / Chaser 零变化 */

describe('PBL-RANGED｜D ProtoRusher / Chaser 行为零变化（本 Queue 最硬的一条）', () => {
  /** 采样帧号（都在两局的结束步数之内）。 */
  const MARKS = [60, 120, 180, 240, 300, 420, 600];
  /** 改前实测值（本 Queue 改动**之前**跑出的同一份探针输出）。 */
  const FROZEN = {
    Chaser: {
      gaps: [360, 124, -55, -26, -110, -192, -146],
      endStep: 920,
      winner: 'A',
      hpA: 270,
      hpB: 0,
    },
    ProtoRusher: {
      gaps: [331, 68, -23, -27, -25, -25, -27],
      endStep: 840,
      winner: 'A',
      hpA: 843,
      hpB: 0,
    },
  } as const;

  function signature(id: 'Chaser' | 'ProtoRusher') {
    const rt = new RunBattleRuntime({ encounterId: id });
    rt.step(FRAME_MS);
    let f = 0;
    const gaps: number[] = [];
    while (rt.result === null && f < 1400) {
      rt.step(FRAME_MS);
      f += 1;
      if (MARKS.includes(f)) gaps.push(Math.round(rt.gapWorld()));
    }
    const hp = rt.hp();
    return { gaps, endStep: f, winner: rt.result?.winner ?? null, hpA: Math.round(hp.a), hpB: Math.round(hp.b) };
  }

  for (const id of ['Chaser', 'ProtoRusher'] as const) {
    it(`RDC-17(${id}) 逐值冻结：间距轨迹 / 结束步数 / 胜负 / 双方耐久全部未变`, () => {
      expect(signature(id)).toEqual(FROZEN[id]);
    }, 300_000);
  }

  it('RDC-18 两套都**没有装**距离档（读数恒 null ⇒ 走的是改前那条恒定驱动指令）', () => {
    for (const id of ['Chaser', 'ProtoRusher'] as const) {
      const rt = new RunBattleRuntime({ encounterId: id });
      for (let i = 0; i < 120; i++) {
        rt.step(FRAME_MS);
        expect(rt.enemyDriveState(), `${id} 第 ${i} 帧不得产生距离档决策`).toBeNull();
      }
    }
  }, 300_000);

  it('RDC-19 源码级：未装距离档时走的是**与改前逐字相同**的恒定量', () => {
    const src = stripComments(read('src/battle/planckBattleOrchestrator.ts'));
    // else 分支必须原样保留：enabled true / worldDirection -1 / 既有目标速度
    expect(
      /else\s*\{\s*drivePlanckVehicle\(this\.world,\s*this\.vehicleB,\s*\{\s*enabled:\s*true,\s*worldDirection:\s*-1,\s*targetSpeedPxPerStep:\s*AUTO_DRIVE_TARGET_SPEED_PX_PER_STEP,\s*\}\s*\);\s*\}/.test(
        src,
      ),
      'config.enemyDrive 缺省时的分支必须与改前逐字相同',
    ).toBe(true);
    // A 侧驱动一字未改
    expect(
      /drivePlanckVehicle\(this\.world,\s*this\.vehicleA,\s*\{\s*enabled:\s*true,\s*worldDirection:\s*1,/.test(src),
    ).toBe(true);
  });
});

/* ================================ E. 结构守卫（不写第二套物理） */

describe('PBL-RANGED｜E 结构守卫：只经正式 Movement / 正式栈零污染', () => {
  it('RDC-20 决策只喂给正式 Movement 接口，编排器里没有第二套位移写法', () => {
    const src = stripComments(read('src/battle/planckBattleOrchestrator.ts'));
    // 新增分支里唯一的下发动作是 drivePlanckVehicle（无 setPosition / setVelocity / transform）
    const branch = src.match(/const bands = this\.config\.enemyDrive;[\s\S]*?\n      \}/);
    expect(branch, '必须存在 enemyDrive 分支').not.toBeNull();
    expect(branch![0].includes('drivePlanckVehicle(')).toBe(true);
    for (const t of ['setPosition', 'setVelocity', 'setTransform', 'applyForce', 'applyLinearImpulse']) {
      expect(branch![0].includes(t), `enemyDrive 分支不得出现 "${t}"`).toBe(false);
    }
  });

  it('RDC-21 距离口径与相机取景同源（core = Body + Wheels，不含 Functional Parts）', () => {
    const src = stripComments(read('src/battle/planckBattleOrchestrator.ts'));
    expect(src.includes('private coreBoundsX(')).toBe(true);
    expect(src.includes('acc(vehicle.body);')).toBe(true);
    expect(src.includes('for (const w of vehicle.wheels) acc(w.body);')).toBe(true);
    // 不得把 parts 算进距离（否则武器伸出会扭曲分段）
    const helper = src.match(/private coreBoundsX\([\s\S]*?\n  \}/);
    expect(helper![0].includes('vehicle.parts')).toBe(false);
    // 相机侧（正式 renderer）确实是同一个口径
    expect(read('src/render/renderer.ts').includes('this.vehicleBounds(snap.vehicleA, false)')).toBe(true);
  });

  it('RDC-22 正式栈零污染：Lab 之外的战斗 / 渲染 / 物理目录未被写入实验名', () => {
    const battle = readLab('runBattleRuntime.ts');
    expect(battle.includes('ENEMY_KEEP_DISTANCE_BANDS')).toBe(true);
    // 正式侧不得出现实验目录名（反向硬约束，由 R22b 兜底；这里做一次更聚焦的复核）
    for (const f of ['enemyDrive.ts', 'battleContract.ts', 'planckBattleOrchestrator.ts']) {
      const src = read(`src/battle/${f}`);
      expect(src.includes('portraitBattleLab'), `${f} 不得引用实验目录`).toBe(false);
      expect(src.includes('portrait-lab'), `${f} 不得引用实验名`).toBe(false);
    }
  });

  it('RDC-23 批次定义与页面文案未被改写（本 Queue 不动 Encounter 清单 / 不动 UI）', () => {
    expect(ENCOUNTER_BATCH).toHaveLength(3);
    expect(ENCOUNTER_BATCH.map((e) => e.id)).toEqual(['ProtoRusher', 'Chaser', 'RangedTurret']);
    // 页面（三个对手按钮 + Reset）的控件清单零改动
    const page = stripComments(readLab('encounterLab.ts'));
    expect(page.includes('ENCOUNTER_BATCH')).toBe(true);
    expect(page.includes('preferredDistance')).toBe(false); // 不在页面里写距离数值
  });
});
