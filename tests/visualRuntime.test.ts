/**
 * Queue W2-VIS-1｜Sprite Visual Asset Runtime
 *
 * 1. VisualRegistry：register / has / setImage / isReady / 缺资源 fallback / 未注册注入拒绝；
 * 2. Renderer 消费 RenderVisual：body sprite 跟随世界 transform（translate+rotate）、
 *    wheel sprite（movement 层）、part sprite（functional 层，如 Hammer 跟随真实 Revolute）；
 * 3. facing 镜像：mirror=true → ctx.scale(-1,1)（真正的水平翻转）；
 * 4. 缺资源：drawImage 不调用，Collider graybox 照常（不白屏/不报错）；
 * 5. layer 顺序：同组多 part visual 按 layer 升序绘制；
 * 6. Preview / Battle 共用：同一 renderer.render 消费同一 snapshot（RenderVisual 已
 *    由双 orchestrator 输出，visualDef.test 覆盖 snapshot 层；此处验证 renderer 消费）。
 * 7. Physics 不知图片：visual 只出现在 snapshot（渲染层），Content Def 无 image。
 */
import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import type {
  BattleOrchestratorApi,
  BattleRenderSnapshot,
  RenderVisual,
} from '../src/battle/battleContract';
import type { BattleEvent } from '../src/battle/combatEvents';

/** 记录 ctx 调用（含 sprite transform 序列）的最小 stub */
class CtxStub {
  calls: string[] = [];
  transforms: Array<{ op: string; args: number[] }> = [];
  drawImages = 0;
  fillCount = 0;
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  textAlign = '';

  private record(name: string): void {
    this.calls.push(name);
  }
  setTransform(): void { this.record('setTransform'); }
  clearRect(): void { this.record('clearRect'); }
  fillRect(): void { this.record('fillRect'); }
  beginPath(): void { this.record('beginPath'); }
  moveTo(): void { this.record('moveTo'); }
  lineTo(): void { this.record('lineTo'); }
  closePath(): void { this.record('closePath'); }
  fill(): void { this.fillCount++; this.record('fill'); }
  stroke(): void { this.record('stroke'); }
  arc(): void { this.record('arc'); }
  fillText(): void { this.record('fillText'); }
  save(): void { this.transforms.push({ op: 'save', args: [] }); this.record('save'); }
  restore(): void { this.transforms.push({ op: 'restore', args: [] }); this.record('restore'); }
  translate(x: number, y: number): void { this.transforms.push({ op: 'translate', args: [x, y] }); this.record('translate'); }
  rotate(a: number): void { this.transforms.push({ op: 'rotate', args: [a] }); this.record('rotate'); }
  scale(x: number, y: number): void { this.transforms.push({ op: 'scale', args: [x, y] }); this.record('scale'); }
  drawImage(): void { this.drawImages++; this.record('drawImage'); }
}

function makeCanvas(ctx: CtxStub) {
  return {
    width: 0,
    height: 0,
    clientWidth: 1000,
    clientHeight: 500,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

function makeFakeOrch(snapshot: BattleRenderSnapshot): BattleOrchestratorApi {
  return {
    config: {},
    result: null,
    phase: 'Active',
    timeMs: 0,
    step: () => {},
    onCombatEvent: () => () => {},
    dispose: () => {},
    getRenderSnapshot: () => snapshot,
    getBattleStatusSnapshot: () => ({
      sideA: { team: 'A', hp: 1000, maxHp: 1000 },
      sideB: { team: 'B', hp: 1000, maxHp: 1000 },
      phase: 'Active',
    }),
  };
}

function vis(
  visualId: string,
  position: { x: number; y: number },
  rotation: number,
  size: { width: number; height: number },
  layer: number,
  mirror?: boolean,
): RenderVisual {
  return { visualId, position, rotation, size, layer, mirror };
}

function baseSnapshot(overrides?: Partial<BattleRenderSnapshot>): BattleRenderSnapshot {
  return {
    arena: { width: 1600, groundY: 700, normalWalls: [], closingWalls: [] },
    vehicleA: {
      team: 'A',
      body: {
        kind: 'polygons',
        polygons: [{ points: [{ x: 340, y: 570 }, { x: 460, y: 570 }, { x: 460, y: 630 }, { x: 340, y: 630 }] }],
      },
      bodyVisual: undefined,
      wheels: [],
      wheelVisuals: [],
      parts: [],
    },
    vehicleB: {
      team: 'B',
      body: {
        kind: 'polygons',
        polygons: [{ points: [{ x: 940, y: 570 }, { x: 1060, y: 570 }, { x: 1060, y: 630 }, { x: 940, y: 630 }] }],
      },
      wheels: [],
      parts: [],
    },
    ...overrides,
  };
}

describe('W2-VIS-1 · VisualRegistry', () => {
  it('register/has/getMeta/setImage/isReady；缺资源 isReady=false；未注册注入拒绝', () => {
    const reg = new VisualRegistry();
    expect(reg.has('missing')).toBe(false);
    expect(reg.isReady('missing')).toBe(false);
    reg.register('bodyA', '/public/bodyA.png');
    expect(reg.has('bodyA')).toBe(true);
    expect(reg.getMeta('bodyA')?.src).toBe('/public/bodyA.png');
    expect(reg.isReady('bodyA')).toBe(false); // 未加载
    reg.setImage('bodyA', { width: 32, height: 16 });
    expect(reg.isReady('bodyA')).toBe(true);
    expect(reg.getImage('bodyA')).toEqual({ width: 32, height: 16 });
    expect(() => reg.setImage('unknown', { width: 1, height: 1 })).toThrow(/未注册/);
  });
});

describe('W2-VIS-1 · Renderer Sprite 绘制', () => {
  function setup(registry: VisualRegistry, snapshot: BattleRenderSnapshot) {
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx), registry);
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    renderer.render(makeFakeOrch(snapshot));
    return ctx;
  }

  it('body sprite 跟随世界 transform（translate+rotate）；wheel/part sprite 各自绘制', () => {
    const reg = new VisualRegistry();
    reg.register('bodyA', '/a.png');
    reg.setImage('bodyA', { width: 32, height: 16 });
    reg.register('wheelA', '/w.png');
    reg.setImage('wheelA', { width: 16, height: 16 });
    reg.register('hammerA', '/h.png');
    reg.setImage('hammerA', { width: 24, height: 24 });
    const snap = baseSnapshot({
      vehicleA: {
        team: 'A',
        body: { kind: 'polygons', polygons: [] },
        bodyVisual: vis('bodyA', { x: 400, y: 600 }, 0.5, { width: 120, height: 60 }, 10),
        wheels: [{ center: { x: 350, y: 640 }, radius: 20, angle: 0.2 }],
        wheelVisuals: [vis('wheelA', { x: 350, y: 640 }, 0.2, { width: 40, height: 40 }, 20)],
        parts: [
          {
            shape: { kind: 'polygons', polygons: [] },
            category: 'weapon',
            visual: vis('hammerA', { x: 460, y: 590 }, 1.1, { width: 48, height: 48 }, 30),
          },
        ],
      },
    });
    const ctx = setup(reg, snap);
    // 3 个 sprite（body/wheel/part）都 drawImage；collider polygons 为空 → 无 fill
    expect(ctx.drawImages).toBe(3);
    const ops = ctx.transforms.filter((t) => t.op !== 'save' && t.op !== 'restore');
    const translates = ops.filter((t) => t.op === 'translate');
    const rotates = ops.filter((t) => t.op === 'rotate');
    // 3 个 translate（各 sprite 世界位置，镜头 scale=？默认 transform scale=1 offset=0）
    expect(translates.length).toBe(3);
    expect(translates[0]!.args).toEqual([400, 600]);
    expect(rotates[0]!.args[0]!).toBeCloseTo(0.5, 6);
    expect(translates[1]!.args).toEqual([350, 640]); // wheel 跟随
    expect(rotates[1]!.args[0]!).toBeCloseTo(0.2, 6);
    expect(translates[2]!.args).toEqual([460, 590]); // part（Hammer 跟随真实 part transform）
    expect(rotates[2]!.args[0]!).toBeCloseTo(1.1, 6);
    // 无 mirror → 不调用 scale
    expect(ops.some((t) => t.op === 'scale')).toBe(false);
  });

  it('facing=-1 镜像：mirror=true → ctx.scale(-1,1)（真正的水平翻转）', () => {
    const reg = new VisualRegistry();
    reg.register('bodyB', '/b.png');
    reg.setImage('bodyB', { width: 32, height: 16 });
    const snap = baseSnapshot({
      vehicleB: {
        team: 'B',
        body: { kind: 'polygons', polygons: [] },
        bodyVisual: vis('bodyB', { x: 1000, y: 600 }, -0.3, { width: 120, height: 60 }, 10, true),
        wheels: [],
        parts: [],
      },
    });
    const ctx = setup(reg, snap);
    expect(ctx.drawImages).toBe(1);
    const scales = ctx.transforms.filter((t) => t.op === 'scale');
    expect(scales.length).toBe(1);
    expect(scales[0]!.args).toEqual([-1, 1]);
  });

  it('缺资源：drawImage 不调用，Collider graybox 照常绘制（不白屏/不报错）', () => {
    const reg = new VisualRegistry(); // 空注册表 → bodyVisual 的 visualId 无资源
    const snap = baseSnapshot({
      vehicleA: {
        team: 'A',
        body: {
          kind: 'polygons',
          polygons: [{ points: [{ x: 340, y: 570 }, { x: 460, y: 570 }, { x: 460, y: 630 }, { x: 340, y: 630 }] }],
        },
        bodyVisual: vis('missingAsset', { x: 400, y: 600 }, 0, { width: 120, height: 60 }, 10),
        wheels: [],
        parts: [],
      },
    });
    const ctx = setup(reg, snap);
    expect(ctx.drawImages).toBe(0);
    expect(ctx.fillCount).toBeGreaterThan(0); // Collider fallback 照常 fill
    // 未抛错（不白屏）：render 完成且记录非空
    expect(ctx.calls.length).toBeGreaterThan(0);
  });

  it('layer 顺序：同组多 part visual 按 layer 升序绘制', () => {
    const reg = new VisualRegistry();
    reg.register('pA', '/pA.png');
    reg.setImage('pA', { width: 16, height: 16 });
    reg.register('pB', '/pB.png');
    reg.setImage('pB', { width: 16, height: 16 });
    const snap = baseSnapshot({
      vehicleA: {
        team: 'A',
        body: { kind: 'polygons', polygons: [] },
        wheels: [],
        parts: [
          { shape: { kind: 'polygons', polygons: [] }, category: 'weapon', visual: vis('pB', { x: 460, y: 590 }, 0, { width: 24, height: 24 }, 30) },
          { shape: { kind: 'polygons', polygons: [] }, category: 'gadget', visual: vis('pA', { x: 420, y: 590 }, 0, { width: 24, height: 24 }, 10) },
        ],
      },
    });
    const ctx = setup(reg, snap);
    expect(ctx.drawImages).toBe(2);
    // drawImage 顺序：先 layer 10（pA）后 layer 30（pB）
    const order = ctx.calls.filter((c) => c === 'drawImage');
    expect(order.length).toBe(2);
    const translates = ctx.transforms.filter((t) => t.op === 'translate');
    expect(translates[0]!.args).toEqual([420, 590]); // layer 10 先画
    expect(translates[1]!.args).toEqual([460, 590]); // layer 30 后画
  });

  it('Preview / Battle 共用：同一 renderer.render 消费同一 snapshot（含 bodyVisual），双车均可 sprite', () => {
    const reg = new VisualRegistry();
    reg.register('both', '/both.png');
    reg.setImage('both', { width: 16, height: 16 });
    const snap = baseSnapshot({
      vehicleA: {
        team: 'A',
        body: { kind: 'polygons', polygons: [] },
        bodyVisual: vis('both', { x: 400, y: 600 }, 0, { width: 100, height: 50 }, 10),
        wheels: [],
        parts: [],
      },
      vehicleB: {
        team: 'B',
        body: { kind: 'polygons', polygons: [] },
        bodyVisual: vis('both', { x: 1000, y: 600 }, 0, { width: 100, height: 50 }, 10, true),
        wheels: [],
        parts: [],
      },
    });
    const ctx = setup(reg, snap);
    // Preview（loadCustomPreview）与 Battle（loadCustom）都走同一 getRenderSnapshot →
    // 同一 renderer.render：A/B 双车 sprite 均绘制（B 带镜像）
    expect(ctx.drawImages).toBe(2);
    expect(ctx.transforms.filter((t) => t.op === 'scale').length).toBe(1); // B mirror
  });
});

// 让未使用类型引用保持（BattleEvent 为占位，避免 noUnusedLocals 误伤 import）
export type { BattleEvent };
