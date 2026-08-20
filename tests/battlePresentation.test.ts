/**
 * Queue W2-FX-1｜Battle VFX / SFX Runtime targeted test
 *
 * 覆盖验收：
 * 1. Cannon fire event → 一次 fire presentation（muzzle flash + fire sound 各一次）；
 * 2. damage event → 对应 hit（hit flash / spark / damage sound / damage number 各一次；
 *    damage=0 只 flash 不播伤害表现）；
 * 3. death → 一次 death presentation（death FX + death sound 各一次）；
 * 4. 同事件不会重复播放（重复 bind 先解绑旧订阅；stop 后不再消费）；
 * 5. Preview 不自动播放战斗 FX（loadCustomPreview → controller 不 bound；
 *    loadCustom → bound）——Fighting 才消费正式 Battle Event；
 * 6. SfxAudioService：node 无 AudioContext / muted → 安全 no-op 不抛错；
 * 7. 真实 Planck Runtime：Cannon 首个固定步真实发射 → presentation 恰好一次。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  BattlePresentationController,
  type BattleEventSource,
  type BattlePresentationHooks,
} from '../src/presentation/battlePresentationController';
import { SfxAudioService } from '../src/presentation/audioService';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { BattleEvent, DamageEvent, DeathEvent, WeaponFireEvent } from '../src/battle/combatEvents';
import type { BuildSnapshot } from '../src/core/types';
import type { Renderer } from '../src/render/renderer';
import { PHYSICS_HZ } from '../src/physics/units';

const registry = createRegistry();
const rendererStub = {} as unknown as Renderer;
const STEP = 1000 / PHYSICS_HZ;

function makeSource() {
  let cb: ((ev: BattleEvent) => void) | null = null;
  const source: BattleEventSource = {
    onEvent: (fn) => {
      cb = fn;
      return () => {
        cb = null;
      };
    },
  };
  return {
    source,
    emit: (ev: BattleEvent) => cb?.(ev),
    isSubscribed: () => cb !== null,
  };
}

function counterHooks() {
  const counts = {
    muzzleFlash: 0,
    fireSound: 0,
    hitFlash: 0,
    hitSpark: 0,
    damageSound: 0,
    damageNumber: 0,
    deathFx: 0,
    deathSound: 0,
  };
  const hooks: BattlePresentationHooks = {
    onMuzzleFlash: () => counts.muzzleFlash++,
    onFireSound: () => counts.fireSound++,
    onHitFlash: () => counts.hitFlash++,
    onHitSpark: () => counts.hitSpark++,
    onDamageSound: () => counts.damageSound++,
    onDamageNumber: () => counts.damageNumber++,
    onDeathFx: () => counts.deathFx++,
    onDeathSound: () => counts.deathSound++,
  };
  return { counts, hooks };
}

const fireEvent: WeaponFireEvent = {
  type: 'weaponFire',
  team: 'A',
  partId: 'part:front',
  behavior: 'cannon',
  worldPosition: { x: 500, y: 600 },
  worldDirection: { x: 1, y: 0 },
  timestamp: 100,
};

function damageEvent(damage: number): DamageEvent {
  return {
    type: 'damage',
    source: 'A',
    target: 'B',
    damageSource: 'weapon',
    partId: 'cannon-1',
    behavior: 'cannon',
    contactPoint: { x: 510, y: 610 },
    contactNormal: { x: 1, y: 0 },
    relativeVelocity: 5,
    damage,
    hpBefore: 1000,
    hpAfter: 1000 - damage,
    timestamp: 200,
  };
}

const deathEvent: DeathEvent = {
  type: 'death',
  team: 'B',
  sourceTeam: 'A',
  damageSource: 'weapon',
  timestamp: 300,
};

describe('W2-FX-1 BattlePresentationController', () => {
  it('1. weaponFire → 一次 fire presentation（muzzle flash + fire sound 各一次）', () => {
    const { counts, hooks } = counterHooks();
    const ctrl = new BattlePresentationController(hooks);
    const { source, emit } = makeSource();
    ctrl.bind(source);
    emit(fireEvent);
    expect(counts.muzzleFlash).toBe(1);
    expect(counts.fireSound).toBe(1);
    expect(counts.hitFlash).toBe(0); // 与 damage/death 互不影响
    expect(counts.deathFx).toBe(0);
  });

  it('2. damage event → 对应 hit（flash/spark/sound/number 各一次）；damage=0 只 flash', () => {
    const { counts, hooks } = counterHooks();
    const ctrl = new BattlePresentationController(hooks);
    const { source, emit } = makeSource();
    ctrl.bind(source);
    emit(damageEvent(80));
    expect(counts.hitFlash).toBe(1);
    expect(counts.hitSpark).toBe(1);
    expect(counts.damageSound).toBe(1);
    expect(counts.damageNumber).toBe(1);

    const { counts: c2, hooks: h2 } = counterHooks();
    const ctrl2 = new BattlePresentationController(h2);
    const { source: s2, emit: e2 } = makeSource();
    ctrl2.bind(s2);
    e2(damageEvent(0)); // 0 伤害接触：只闪白，不播火花/音效/数字
    expect(c2.hitFlash).toBe(1);
    expect(c2.hitSpark).toBe(0);
    expect(c2.damageSound).toBe(0);
    expect(c2.damageNumber).toBe(0);
  });

  it('3. death → 一次 death presentation（FX + sound 各一次）', () => {
    const { counts, hooks } = counterHooks();
    const ctrl = new BattlePresentationController(hooks);
    const { source, emit } = makeSource();
    ctrl.bind(source);
    emit(deathEvent);
    expect(counts.deathFx).toBe(1);
    expect(counts.deathSound).toBe(1);
    expect(counts.muzzleFlash).toBe(0);
  });

  it('4. 同事件不重复播放：重复 bind 先解绑旧订阅；stop 后不再消费', () => {
    const { counts, hooks } = counterHooks();
    const ctrl = new BattlePresentationController(hooks);
    const s1 = makeSource();
    const s2 = makeSource();
    ctrl.bind(s1.source);
    expect(s1.isSubscribed()).toBe(true);
    ctrl.bind(s2.source); // 重新绑定：旧订阅必须解除
    expect(s1.isSubscribed()).toBe(false);
    expect(s2.isSubscribed()).toBe(true);
    expect(ctrl.bound).toBe(true);
    s2.emit(fireEvent);
    expect(counts.muzzleFlash).toBe(1); // 恰好一次

    ctrl.stop();
    expect(s2.isSubscribed()).toBe(false);
    expect(ctrl.bound).toBe(false);
    s2.emit(fireEvent); // 已解绑：不再消费
    s1.emit(fireEvent);
    expect(counts.muzzleFlash).toBe(1);
  });

  it('5. Preview 不消费：loadCustomPreview → 不 bound；loadCustom（Fighting）→ bound', () => {
    const { hooks } = counterHooks();
    const ctrl = new BattlePresentationController(hooks);
    const lab = new PhysicsLab(rendererStub, ctrl);
    const build = (id: string): BuildSnapshot => ({
      id,
      bodyDefId: 'boxBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: [{ hardpointId: 'front', defId: 'cannon' }],
    });
    // 装配预览：不消费战斗 FX
    lab.loadCustomPreview(build('A'), build('B'));
    expect(ctrl.bound).toBe(false);
    // 正式战斗：消费 Battle Event
    lab.loadCustom(build('A'), build('B'), { autoDrive: true, engine: 'planck' });
    expect(ctrl.bound).toBe(true);
    // Clear：解绑
    lab.clear();
    expect(ctrl.bound).toBe(false);
  });

  it('6. SfxAudioService：node 无 AudioContext / muted → 安全 no-op 不抛错', () => {
    const sfx = new SfxAudioService();
    expect(() => sfx.play('fire')).not.toThrow();
    expect(() => sfx.play('hit')).not.toThrow();
    expect(() => sfx.play('death')).not.toThrow();
    sfx.setMuted(true);
    expect(sfx.isMuted()).toBe(true);
    expect(() => sfx.play('fire')).not.toThrow(); // muted 下也安全
    sfx.setMuted(false);
  });

  it('7. 真实 Planck：Cannon 首个固定步真实发射 → presentation 恰好一次', () => {
    const { counts, hooks } = counterHooks();
    const ctrl = new BattlePresentationController(hooks);
    const build = (id: string, withCannon: boolean): BuildSnapshot => ({
      id,
      bodyDefId: 'boxBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: withCannon ? [{ hardpointId: 'front', defId: 'cannon' }] : [],
    });
    const orch = new PlanckBattleOrchestrator(
      build('A', true), // 只有 A 装炮 → 首步恰好一次 fire
      build('B', false),
      registry,
      { autoDrive: true, engine: 'planck', settleToGround: true },
    );
    ctrl.bind({ onEvent: (cb) => orch.onCombatEvent(cb) });
    orch.step(STEP); // 首步：Cannon 就绪 → 真实发射（weaponFire）
    expect(counts.muzzleFlash).toBe(1);
    expect(counts.fireSound).toBe(1);
    expect(counts.hitFlash).toBe(0); // 无接触伤害
  });
});
