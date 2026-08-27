/**
 * F-AUDIO-RESULT-LIFECYCLE-P0：战斗音频生命周期回归测试。
 * 用可控 FakeAudioContext 替代浏览器 AudioContext，断言：
 *  - Battle 阶段活跃循环音源恒 ≤1（startLaserCharge / startBattleAudio 均幂等，never 2）；
 *  - 胜负确定后 stopBattleAudio 立即使 activeBgmSources=0（满足「Result 后 500ms 内 source=0」）；
 *  - Result 停留后音源与计时器不再增长（淡出清理后 pendingTimers 归零）；
 *  - 连续两场 1→0→1→0，上一局泄漏音源被下一局 startBattleAudio 清理（不累积到 2）；
 *  - 攻击/结算音效 play()、stopLaserCharge 正常且不影响循环音源计数；
 *  - 单条循环音源在淡出后被 stop + disconnect（不只 volume=0）。
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { SfxAudioService } from '../src/presentation/audioService';

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
const install = () => {
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('F-AUDIO-RESULT-LIFECYCLE-P0', () => {
  let sfx: SfxAudioService;
  beforeEach(() => {
    install();
    sfx = new SfxAudioService();
  });
  afterAll(() => {
    (globalThis as { AudioContext?: unknown }).AudioContext = savedAudioContext;
  });

  it('T1: Battle 阶段活跃循环音源恒为 1（幂等，never 2）', () => {
    sfx.startBattleAudio('b1');
    sfx.startLaserCharge(0.5);
    let probe = sfx.getAudioProbe();
    expect(probe.activeBgmSources).toBe(1);
    expect(probe.state).toBe('battle-audio');
    expect(probe.battleSession).toBe('b1');
    // 每帧重复调用 startLaserCharge（蓄能进度更新）——仍只有 1 个源
    sfx.startLaserCharge(0.8);
    sfx.startLaserCharge(1.0);
    expect(sfx.getAudioProbe().activeBgmSources).toBe(1);
    // startBattleAudio 同会话重复调用不新增
    sfx.startBattleAudio('b1');
    expect(sfx.getAudioProbe().activeBgmSources).toBe(1);
  });

  it('T2: 进入 Result 后 stopBattleAudio 立即使 activeBgmSources=0', () => {
    sfx.startBattleAudio('b1');
    sfx.startLaserCharge(0.5);
    sfx.stopBattleAudio();
    const probe = sfx.getAudioProbe();
    expect(probe.activeBgmSources).toBe(0);
    expect(probe.state).toBe('idle');
    expect(probe.battleSession).toBeNull();
  });

  it('T3: Result 停留后音源与计时器不再增长（淡出清理后 pendingTimers 归零）', async () => {
    sfx.startBattleAudio('b1');
    sfx.startLaserCharge(0.5);
    sfx.stopBattleAudio();
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0);
    await delay(350); // 等待淡出 + 断开排程完成
    const probe = sfx.getAudioProbe();
    expect(probe.activeBgmSources).toBe(0);
    expect(probe.pendingAudioTimers).toBe(0); // 计时器已清理，不再增长
    await delay(80); // 模拟 Result 停留抽样——仍 0
    expect(sfx.getAudioProbe().pendingAudioTimers).toBe(0);
  });

  it('T4: 连续两场 1→0→1→0，不残留', () => {
    sfx.startBattleAudio('b1');
    sfx.startLaserCharge(0.5);
    expect(sfx.getAudioProbe().activeBgmSources).toBe(1);
    sfx.stopBattleAudio();
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0);
    sfx.startBattleAudio('b2');
    sfx.startLaserCharge(0.5);
    expect(sfx.getAudioProbe().activeBgmSources).toBe(1);
    expect(sfx.getAudioProbe().battleSession).toBe('b2');
    sfx.stopBattleAudio();
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0);
  });

  it('T5: 上一局泄漏音源被下一局 startBattleAudio 清理（不累积到 2）', () => {
    // 模拟：battle1 蓄能中战斗结束，未显式 stop（泄漏）
    sfx.startBattleAudio('b1');
    sfx.startLaserCharge(0.5);
    expect(sfx.getAudioProbe().activeBgmSources).toBe(1);
    // 未调用 stopBattleAudio 直接进入 battle2
    sfx.startBattleAudio('b2');
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0); // 旧泄漏源已被清理
    sfx.startLaserCharge(0.5);
    expect(sfx.getAudioProbe().activeBgmSources).toBe(1); // 只新建 1 个，绝不 = 2
    expect(sfx.getAudioProbe().battleSession).toBe('b2');
    sfx.stopBattleAudio();
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0);
  });

  it('T6: 攻击/结算音效正常且不计入循环音源；单条循环源淡出后被 stop+disconnect', async () => {
    sfx.startBattleAudio('b1');
    sfx.startLaserCharge(0.5);
    sfx.play('fire');
    sfx.play('hit');
    sfx.play('win');
    expect(sfx.getAudioProbe().activeBgmSources).toBe(1); // 短音不影响循环计数
    sfx.stopLaserCharge();
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0); // 同步移出活跃集
    expect(sfx.getAudioProbe().pendingAudioTimers).toBeGreaterThanOrEqual(1);
    await delay(150); // 等待断开排程
    const created = FakeAudioContext.lastInstance;
    const chargeOsc = created?.oscillators[0];
    expect(chargeOsc?.stopped).toBe(true);
    expect(chargeOsc?.disconnected).toBe(true); // 真正断开，不是只 volume=0
  });

  it('T7: 重复 stopBattleAudio 与无音频环境均安全 no-op', () => {
    sfx.startBattleAudio('b1');
    sfx.startLaserCharge(0.5);
    sfx.stopBattleAudio();
    expect(() => sfx.stopBattleAudio()).not.toThrow(); // 重复 stop 安全
    expect(sfx.getAudioProbe().activeBgmSources).toBe(0);
    // 无 AudioContext（缺资源 / 微信 no-op）
    const cur = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    const sfx2 = new SfxAudioService();
    expect(() => {
      sfx2.startBattleAudio('x');
      sfx2.startLaserCharge(0.5);
      sfx2.stopBattleAudio();
    }).not.toThrow();
    expect(sfx2.getAudioProbe().activeBgmSources).toBe(0);
    (globalThis as { AudioContext?: unknown }).AudioContext = cur;
  });
});
