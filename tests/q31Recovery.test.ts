/**
 * Queue Q31｜V0.8 Release Hardening — 必查 3. 异常恢复
 *
 * 头less 验证六类异常路径均不卡死 / 不抛未捕获错误 / 不重复发奖：
 * 1. 后台→前台：main.ts 游戏循环用 `dt = Math.min(50, now - last)`（main.ts:2216）钳制；
 *    本测试验证即便单次喂入巨大 dt（模拟 5s 后台），Runtime 仍有限、可继续抵达 End。
 * 2. 页面刷新 / 存档迁移：脏 / 缺失 / 旧版存档读回不抛错，落得合法库存（Q27 Save Version Foundation）。
 * 3. 广告失败：RewardedAdClaimer 在非 completed 下不发奖且不锁；tryInterstitialSafe 任何结果/异常都继续 proceed。
 * 4. 存档字段缺失：部分库存对象（缺键 / 类型非法）归一为合法 PartInventory。
 * 5. 快速点击去重：RefGuard / battleEndGuard 同引用只放行一次（模拟每帧 poll / 双击）。
 * 6. Result 重复触发：battle 抵达 End 后重复 step 安全（orchestrator.step 命中 _result 早退，不重入）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { Renderer } from '../src/render/renderer';
import { loadInventoryRaw, getInventory, ensureInventory } from '../src/core/partInventory';
import { stampVersion } from '../src/core/saveVersion';
import { battleEndGuard, RefGuard } from '../src/core/analytics';
import {
  RewardedAdClaimer,
  tryInterstitialSafe,
  setAdsMode,
  setPlatformAdsAdapter,
  setMockAdResult,
} from '../src/core/ads';

const registry = createRegistry();
const rendererStub = { bind: () => {} } as unknown as Renderer;

const INV_KEY_V2 = 'strongfruit.ownedParts.v2';
const INV_KEY_V1 = 'strongfruit.ownedParts.v1';

class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}
function installStorage(): MemStorage {
  const s = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = s;
  return s;
}

/** 一个合法的多武器 Build（压测 Projectile 等），保证 battle 能跑 */
function sampleDraft(bodyDefId: string): BuildDraft {
  const body = registry.bodies.get(bodyDefId);
  const slots = body ? body.functionalHardpoints.map((h) => h.id) : [];
  const weapons = ['cannon', 'shotgun', 'machineGun', 'hammer', 'saw', 'pushRod', 'thruster', 'flamethrower'];
  const sel: Record<string, string> = {};
  slots.forEach((hp, idx) => (sel[hp] = weapons[idx % weapons.length]));
  return { bodyDefId, rearRadius: 20, frontRadius: 20, functionalSelections: sel, drive: 'forward' };
}

function runToEnd(lab: PhysicsLab, cap = 4000): { o: PlanckBattleOrchestrator; steps: number } {
  const o = lab.orchestrator as PlanckBattleOrchestrator;
  let steps = 0;
  for (; steps < cap; steps++) {
    lab.step(16.6667);
    if (o.result?.phase === 'End') break;
  }
  return { o, steps };
}

function finiteOk(o: PlanckBattleOrchestrator): boolean {
  for (const v of [o.vehicleA, o.vehicleB]) {
    const pos = o.world.getPosition(v.body);
    const vel = o.world.getLinearVelocity(v.body);
    const ang = o.world.getAngle(v.body);
    const av = o.world.getAngularVelocity(v.body);
    if (![pos.x, pos.y, vel.x, vel.y, ang, av, v.hp].every(Number.isFinite)) return false;
  }
  return true;
}

describe('Q31 异常恢复 1 — 后台→前台 dt 钳制韧性', () => {
  it('单次巨大 dt（模拟 5s 后台）后仍有限并可继续抵达 End', () => {
    const lab = new PhysicsLab(rendererStub);
    const snapA = buildSnapshotFromDraft(sampleDraft('boxBody'), registry, 'A');
    const snapB = buildSnapshotFromDraft(sampleDraft('heavyBox'), registry, 'B');
    lab.loadCustom(snapA, snapB, { autoDrive: true, engine: 'planck' });

    // 模拟「切到后台 5 秒再回前台」：单步喂 5000ms（main.ts 实际会钳到 50）
    let hugeThrew = '';
    try {
      lab.step(5000);
    } catch (e) {
      hugeThrew = (e as Error).message;
    }
    expect(hugeThrew, `巨大 dt 抛错：${hugeThrew}`).toBe('');
    expect(finiteOk(lab.orchestrator as PlanckBattleOrchestrator), '巨大 dt 后车辆状态非有限').toBe(true);

    // 之后正常步进仍能抵达 End（不卡死、不爆 NaN）
    const { o, steps } = runToEnd(lab);
    expect(o.result?.phase, `巨大 dt 后未能在 ${steps} 步内抵达 End`).toBe('End');
    expect(finiteOk(o), '巨大 dt 后抵达 End 时状态非有限').toBe(true);
  });
});

describe('Q31 异常恢复 2/4 — 页面刷新 / 存档字段缺失迁移', () => {
  it('脏 JSON 存档读回不抛错（回退默认库存）', () => {
    installStorage();
    localStorage.setItem(INV_KEY_V2, '{ this is not json');
    expect(() => loadInventoryRaw()).not.toThrow();
    expect(loadInventoryRaw()).toBeNull(); // 该 key 失效，但不波及其它 key / 不抛
    const inv = getInventory(); // 无合法存档 → 默认 starter
    expect(inv['cannon'].one).toBe(1);
  });

  it('部分库存对象（缺键 / 类型非法）归一为合法库存，无崩溃', () => {
    installStorage();
    // 只写了 cannon，且故意给非法类型；其余键缺失
    const partial = stampVersion({ cannon: { one: 3, two: 0 }, hammer: 'oops', saw: null } as unknown);
    localStorage.setItem(INV_KEY_V2, JSON.stringify(partial));
    const inv = loadInventoryRaw();
    expect(inv).toBeTruthy();
    expect(inv!['cannon'].one).toBe(3); // 合法字段保留
    expect(inv!['hammer'].one).toBe(0); // 类型非法 → 回退默认 0
    expect(inv!['saw'].one).toBe(0); // 缺失键 → 默认 0
    expect(inv!['pushRod'].one).toBe(0);
  });

  it('旧版 v0 owned-id 数组存档迁移为数量化库存', () => {
    installStorage();
    localStorage.setItem(INV_KEY_V1, JSON.stringify(['cannon', 'saw', 'cannon']));
    const inv = loadInventoryRaw();
    expect(inv).toBeTruthy();
    expect(inv!['cannon'].one).toBe(1); // 去重为 1★=1
    expect(inv!['saw'].one).toBe(1);
  });

  it('ensureInventory 对坏存档幂等（种子一次后重复调用不重复种子）', () => {
    const s = installStorage();
    s.setItem(INV_KEY_V2, '{bad');
    const a = ensureInventory(sampleDraft('boxBody'));
    const b = ensureInventory(sampleDraft('boxBody'));
    expect(a).toEqual(b); // 内容一致（不重复种子产生新对象/多份）
    expect(a['cannon'].one).toBeGreaterThanOrEqual(1);
    // 二次调用不重新落盘产生多份：持久化库存 cannon 仍为 1 份（starter 默认）
    expect(loadInventoryRaw()!['cannon'].one).toBe(1);
  });
});

describe('Q31 异常恢复 3 — 广告失败不发奖且不卡死', () => {
  it('Rewarded 广告 failed → 不发奖、不锁，completed 重置后仍可发', async () => {
    installStorage();
    setAdsMode('dev');
    const claimer = new RewardedAdClaimer();

    // 广告失败：不发奖
    setMockAdResult({ status: 'failed' });
    claimer.reset();
    const f1 = await claimer.claim();
    expect(f1.granted).toBe(false);

    // 广告被关闭 / 无填充：同样不发
    setMockAdResult({ status: 'dismissed' });
    const f2 = await claimer.claim();
    expect(f2.granted).toBe(false);

    // 网络/平台异常（PROD + 注入 reject 平台 adapter）：catch 后不发奖、不卡死
    setAdsMode('prod');
    setPlatformAdsAdapter({
      showRewarded: () => Promise.reject(new Error('network down')),
      showInterstitial: () => Promise.reject(new Error('network down')),
    });
    const f3 = await claimer.claim();
    expect(f3.granted).toBe(false);
    setPlatformAdsAdapter(null);

    // 广告成功（DEV mock）：发一次 +50
    setAdsMode('dev');
    setMockAdResult({ status: 'completed' });
    claimer.reset();
    const ok = await claimer.claim();
    expect(ok.granted).toBe(true);
    expect(ok.coinAfter).toBe(50);
    // 同场重复 claim → 已发过，拒绝（不重复发）
    const dup = await claimer.claim();
    expect(dup.granted).toBe(false);
  });

  it('插屏 tryInterstitialSafe 任何结果/异常都继续主流程（不阻塞 Result/Garage/下一场）', async () => {
    installStorage();
    setAdsMode('prod'); // PROD 无 adapter → Noop；失败/异常都不阻塞
    let proceeded = false;
    await tryInterstitialSafe(() => {
      proceeded = true;
    });
    expect(proceeded, '无 adapter 时插屏不应阻塞 proceed').toBe(true);

    // 注入会 reject 的平台 adapter：异常也必须继续
    setPlatformAdsAdapter({
      showRewarded: () => Promise.resolve({ status: 'completed' }),
      showInterstitial: () => Promise.reject(new Error('boom')),
    });
    proceeded = false;
    await tryInterstitialSafe(() => {
      proceeded = true;
    });
    expect(proceeded, '插屏异常仍应继续 proceed').toBe(true);
    setPlatformAdsAdapter(null);
    setAdsMode(null);
  });
});

describe('Q31 异常恢复 5/6 — 快速点击 / Result 重复触发去重', () => {
  it('RefGuard：同引用只放行一次（双击 / 每帧 poll 不重复触发）', () => {
    const g = new RefGuard();
    const ref = { battle: 1 };
    expect(g.firstTime(ref)).toBe(true);
    expect(g.firstTime(ref)).toBe(false); // 重复 → 拒绝
    expect(g.firstTime(ref)).toBe(false);
    g.clear();
    expect(g.firstTime(ref)).toBe(true); // 清后新一场可再触发
  });

  it('battleEndGuard：同一 result 引用只触发一次埋点', () => {
    battleEndGuard.clear();
    const r = { winner: 'A' as const, hpA: 100, hpB: 0 };
    expect(battleEndGuard.firstTime(r)).toBe(true);
    expect(battleEndGuard.firstTime(r)).toBe(false); // 每帧 poll 只首帧触发
  });

  it('battle 抵达 End 后重复 step 安全（不重入、状态稳定、不抛错）', () => {
    const lab = new PhysicsLab(rendererStub);
    const snapA = buildSnapshotFromDraft(sampleDraft('wedgeBody'), registry, 'A');
    const snapB = buildSnapshotFromDraft(sampleDraft('tallBody'), registry, 'B');
    lab.loadCustom(snapA, snapB, { autoDrive: true, engine: 'planck' });
    const { o } = runToEnd(lab);
    expect(o.result?.phase).toBe('End');

    // 重复 step（模拟 Result 轮询仍驱动循环）
    let threw = '';
    try {
      for (let i = 0; i < 50; i++) lab.step(16.6667);
    } catch (e) {
      threw = (e as Error).message;
    }
    expect(threw, `End 后重复 step 抛错：${threw}`).toBe('');
    expect(o.result?.phase, 'End 后状态应保持 End（不重入）').toBe('End');
    expect(finiteOk(o), 'End 后状态应有限').toBe(true);
  });
});
