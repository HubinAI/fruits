/**
 * PRODUCT-LOOP-P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE（必改 3 / 4 / 8）｜
 * **结算页的战斗音频生命周期**回归测试。
 *
 * 真人录屏 P0（本次验收的另一半）：进入结算后战斗噪音**仍持续播放** —— 说明
 * Battle Audio 的生命周期延续到了结算页。
 *
 * ## 根因（本文件用真实产线类把它钉成事实，而不是靠读代码猜）
 *
 * Lab 的战斗表现层用了两个**职责不同**的停止入口，旧实现只调了第一个：
 *
 *   ① `BattlePresentationController.stop()` —— **只解绑事件订阅**。
 *      它保证「之后不再产生新的战斗音」，但**一个已经循环发声的音源都不会停**。
 *   ② `SfxAudioService.stopBattleAudio()` —— 把**已经在循环**的音源淡出 + stop + disconnect。
 *
 * 而战斗音源里唯一会**持续循环**的是镭射蓄能（`startLaserCharge` 建 oscillator 并
 * `start()`，没有任何自动停止）：它只由 `stopLaserCharge()`（开火）或
 * `stopBattleAudio()` 收掉。终局战斗的对手正是激光车（`d7-final` = `BananaRodLaser`）
 * ⇒ 只要它死在蓄能途中，`weaponFire` 不会再来，蓄能声就**一直响着**。
 * 旧实现里 `sfx.stopBattleAudio()` 在 Lab 侧**从未被调用过**，且 `dispose()` 只做 ①
 * ⇒ 结算页与战斗噪音的存活期重叠。这正是录屏里听到的东西。
 *
 * ## 本文件锁什么
 *
 * 只锁**生命周期**：`ACTIVE → STOPPED`。不测音量、不测音色、不测精确毫秒
 * （Queue 必改 8 明令「不要做真实音量精确数值测试」）。
 *
 *   T1 ACTIVE：蓄能音源活跃（`activeBgmSources === 1`）；
 *   T2 **只解绑不停音**（旧实现的缺口：解绑之后音源照样在响）；
 *   T3 终态停止：`stopBattleAudio()` 让活跃音源**立即**归零（不等任何计时器）；
 *   T4 幂等：重复 stop（模拟「终态停一次 + 页面 dispose 再停一次」）不报错、不新增音源；
 *   T5 停留不重启：停止后不再有任何新音源，淡出排程走完后计时器归零；
 *   T6 ≤200ms 覆盖生效：显式短淡出参数被接受，且同样立即归零；
 *   T7 无音频环境（node 无 AudioContext / 微信端）：全链路安全 no-op。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SfxAudioService } from '../src/presentation/audioService';
import { BattlePresentationController } from '../src/presentation/battlePresentationController';
import type { BattleEvent } from '../src/battle/combatEvents';

/* ---------------------------------------------------------------- Fake Web Audio */

class FakeParam {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
}
class FakeNode {
  disconnected = false;
  connect() {
    return this;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  started = false;
  stopped = false;
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeAudioContext {
  static lastInstance: FakeAudioContext | null = null;
  currentTime = 0;
  destination = new FakeNode();
  oscillators: FakeOsc[] = [];
  gains: FakeGain[] = [];
  constructor() {
    FakeAudioContext.lastInstance = this;
  }
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    const o = new FakeOsc();
    this.oscillators.push(o);
    return o;
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
}

const savedAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
const installAudio = () => {
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
};
const removeAudio = () => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 用**真实** `BattlePresentationController` 复刻 Lab 侧的表现接线（`playerPresentation.ts`
 * 的 `onWeaponCharge` → `sfx.startLaserCharge`）。只需要这一条 hook 就能复现 P0 的音源。
 */
function makePresentation(sfx: SfxAudioService): BattlePresentationController {
  return new BattlePresentationController({
    onWeaponCharge: (ev) => sfx.startLaserCharge(ev.progress),
    onWeaponChargeEnd: () => sfx.stopLaserCharge(),
  });
}

/** 真实事件形状（`WeaponChargeEvent`，与 laserBehavior 发出来的一致）。 */
const chargeEvent = (progress: number): BattleEvent => ({
  type: 'weaponCharge',
  timestamp: 0,
  behavior: 'laser',
  partId: 'laser',
  team: 'B',
  progress,
  worldPosition: { x: 0, y: 0 },
});

describe('PRODUCT-LOOP-P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE｜结算页战斗音频生命周期', () => {
  let sfx: SfxAudioService;

  beforeEach(() => {
    installAudio();
    sfx = new SfxAudioService();
  });
  afterAll(() => {
    (globalThis as { AudioContext?: unknown }).AudioContext = savedAudioContext;
  });

  it('T1 ACTIVE：激光蓄能建立**循环**战斗音源（此刻它就是真人听到的那个声音）', () => {
    const ctrl = makePresentation(sfx);
    ctrl.bind({ onEvent: (cb) => { cb(chargeEvent(0.4)); return () => {}; } });
    const probe = sfx.getAudioProbe();
    expect(probe.state).toBe('battle-audio');
    expect(probe.activeBgmSources).toBe(1);
  });

  it('T2 **只解绑不停音**：旧实现的缺口 —— 解绑之后音源照样在响（P0 根因）', () => {
    const ctrl = makePresentation(sfx);
    ctrl.bind({ onEvent: (cb) => { cb(chargeEvent(0.6)); return () => {}; } });
    expect(sfx.getAudioProbe().activeBgmSources).toBe(1);

    // 旧实现里「进终态」只做了这一件事，而且只在 dispose() 里做
    ctrl.stop();

    expect(ctrl.bound, '解绑本身是生效的（不再消费事件）').toBe(false);
    expect(
      sfx.getAudioProbe().activeBgmSources,
      '⚠️ 解绑**不会**停掉已经在循环的音源 —— 这正是录屏里结算页仍在响的战斗噪音',
    ).toBe(1);
  });

  it('T3 STOPPED：终态停止让活跃音源**立即**归零（不等任何计时器）', () => {
    const ctrl = makePresentation(sfx);
    ctrl.bind({ onEvent: (cb) => { cb(chargeEvent(0.9)); return () => {}; } });

    // `RunBattleView.stopBattleAudio()` 实际做的两件事（顺序与产线一致）
    ctrl.stop();
    sfx.stopBattleAudio();

    const probe = sfx.getAudioProbe();
    expect(probe.state).toBe('idle');
    expect(probe.activeBgmSources, '必改 3：终态必须立即安静').toBe(0);
    expect(probe.battleSession).toBeNull();
  });

  it('T4 幂等：重复 stop（终态一次 + dispose 再一次）不报错、不新增音源', () => {
    const ctrl = makePresentation(sfx);
    ctrl.bind({ onEvent: (cb) => { cb(chargeEvent(0.5)); return () => {}; } });
    ctrl.stop();
    sfx.stopBattleAudio();

    const before = FakeAudioContext.lastInstance!.oscillators.length;
    for (let i = 0; i < 4; i++) {
      expect(() => {
        ctrl.stop();
        sfx.stopBattleAudio();
      }, '必改 4：stop 必须幂等').not.toThrow();
    }
    expect(FakeAudioContext.lastInstance!.oscillators.length, '重复 stop 不得新增音源').toBe(before);
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0);
  });

  it('T5 停留结算页不重启：停止后没有新音源，淡出排程走完后计时器归零', async () => {
    const ctrl = makePresentation(sfx);
    ctrl.bind({ onEvent: (cb) => { cb(chargeEvent(0.5)); return () => {}; } });
    ctrl.stop();
    sfx.stopBattleAudio();
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0);

    // 「在结算页停留一会儿」= 时间和事件都继续走，但订阅已解绑 ⇒ 不可能再起新音源
    await delay(320);
    const probe = sfx.getAudioProbe();
    expect(probe.activeBgmSources, '停留期间不得重新启动').toBe(0);
    expect(probe.state).toBe('idle');
    expect(probe.pendingAudioTimers, '淡出排程已回收（节点断开，不留悬挂计时器）').toBe(0);
  });

  it('T6 短淡出覆盖：显式传 ≤200ms 被接受，且同样立即归零（必改 3 的上限）', () => {
    const ctrl = makePresentation(sfx);
    ctrl.bind({ onEvent: (cb) => { cb(chargeEvent(0.5)); return () => {}; } });
    ctrl.stop();
    // 180 = Lab 侧 `RUN_BATTLE_AUDIO_FADE_MS` 的取值（真源由 `portraitRunPage.test.ts`
    // 的 PL-P0-04 从源码正则钉住 ≤200ms，这里只验证「可覆盖」这条接口能力）。
    expect(() => sfx.stopBattleAudio(180)).not.toThrow();
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0);
    // 非法值回落到缺省，不得把 NaN 传进 Web Audio 的 ramp
    expect(() => sfx.stopBattleAudio(Number.NaN)).not.toThrow();
    expect(() => sfx.stopBattleAudio(-5)).not.toThrow();
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0);
  });

  it('T7 无音频环境（微信端 / node）全链路安全 no-op', () => {
    removeAudio();
    const bare = new SfxAudioService();
    const ctrl = makePresentation(bare);
    expect(() => {
      ctrl.bind({ onEvent: (cb) => { cb(chargeEvent(0.5)); return () => {}; } });
      ctrl.stop();
      bare.stopBattleAudio(180);
      bare.stopBattleAudio();
    }).not.toThrow();
    expect(bare.getAudioProbe().activeBgmSources).toBe(0);
    expect(bare.getAudioProbe().state).toBe('idle');
  });
});
