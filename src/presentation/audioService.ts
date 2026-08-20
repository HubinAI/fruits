/**
 * Audio Service（W2-FX-1）：统一 SFX 服务。
 *
 * - 正式表现层唯一的音频入口：Weapon Behavior / Renderer 一律不得直接碰音频；
 * - 本轮使用临时占位音色（Web Audio oscillator beep），重点是生产管线：
 *   `play(id)` 统一入口，缺资源 / 无 AudioContext / muted → 安全 no-op（不抛错）；
 * - 后续正式队列可把占位 beep 换成预加载 AudioBuffer / 音频资源，接口不变。
 */

/** 本轮正式表现需要的音效 id（占位集合，后续可扩展） */
export type SfxId = 'fire' | 'hit' | 'death';

/** 统一音频服务接口（控制器 / 测试可注入） */
export interface SfxService {
  play(id: SfxId): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Q11-C-R2：用户 Start 交互后恢复 AudioContext（浏览器自动播放策略） */
  resume(): void;
  /** Q11-C-R2：镭射蓄能期间升调/增强（progress 0→1，多次调用持续更新） */
  startLaserCharge(progress: number): void;
  /** Q11-C-R2：fire 立即结束 charge 声 + 高频爆鸣 + 低频冲击 */
  stopLaserCharge(): void;
}

/** Web Audio 占位音色参数：id → 频率 / 时长 / 音量 */
const BEEP_PARAMS: Record<SfxId, { freq: number; endFreq: number; dur: number; gain: number }> = {
  // 开火：短促高频哒（高频 → 更高）
  fire: { freq: 880, endFreq: 1400, dur: 0.08, gain: 0.12 },
  // 命中：中频短促撞击
  hit: { freq: 320, endFreq: 160, dur: 0.09, gain: 0.14 },
  // 死亡：低频较长下沉
  death: { freq: 220, endFreq: 60, dur: 0.35, gain: 0.18 },
};

/**
 * 最小 AudioContext 结构接口（node / 无音频环境不存在时安全降级为 no-op）。
 * 首版不加载真实资源；后续队列替换为 buffer 播放，接口不变。
 */
interface MinimalAudioContext {
  currentTime: number;
  destination: unknown;
  resume?(): Promise<unknown>;
  createOscillator(): {
    type: string;
    frequency: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void };
    connect(d: unknown): void;
    start(t?: number): void;
    stop(t?: number): void;
  };
  createGain(): {
    gain: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void };
    connect(d: unknown): void;
  };
}

type AudioContextCtor = new () => MinimalAudioContext;

export class SfxAudioService implements SfxService {
  private ctx: MinimalAudioContext | null = null;
  private muted = false;

  /** 惰性创建 AudioContext（无音频环境 / 创建失败 → null，play 安全 no-op） */
  private ensureContext(): MinimalAudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = (globalThis as { AudioContext?: AudioContextCtor }).AudioContext;
    if (typeof Ctor !== 'function') return null;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  play(id: SfxId): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return; // 缺资源 / 无音频环境：安全 skip，不抛错
    const p = BEEP_PARAMS[id];
    try {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(p.freq, t0);
      osc.frequency.exponentialRampToValueAtTime(p.endFreq, t0 + p.dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(p.gain, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + p.dur + 0.02);
    } catch {
      // 任何音频异常都不影响战斗表现
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Q11-C-R2：用户 Start 交互后恢复（浏览器自动播放策略）；无音频环境 no-op */
  resume(): void {
    const ctx = this.ensureContext();
    if (!ctx || typeof ctx.resume !== 'function') return;
    try {
      void ctx.resume();
    } catch {
      // 忽略：不影响战斗表现
    }
  }

  private chargeOsc: ReturnType<MinimalAudioContext['createOscillator']> | null = null;
  private chargeGain: ReturnType<MinimalAudioContext['createGain']> | null = null;

  /** Q11-C-R2：蓄能期间升调/增强（progress 0→1；重复调用持续更新频率与增益） */
  startLaserCharge(progress: number): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return; // 缺资源 / 无音频环境：安全 skip
    try {
      let osc = this.chargeOsc;
      let gain = this.chargeGain;
      if (!osc) {
        osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(ctx.currentTime);
        this.chargeOsc = osc;
        this.chargeGain = g;
        gain = g;
      }
      const t = ctx.currentTime;
      const p = Math.max(0, Math.min(1, progress));
      osc.frequency.setValueAtTime(180 + p * 420, t); // 180→600 升调
      if (gain) gain.gain.setValueAtTime(0.03 + p * 0.07, t); // 增强
    } catch {
      // 任何音频异常都不影响战斗表现
    }
  }

  /** Q11-C-R2：fire 立即结束 charge 声 + 高频爆鸣 + 低频冲击 */
  stopLaserCharge(): void {
    const ctx = this.ctx;
    try {
      if (this.chargeOsc && ctx) {
        this.chargeOsc.stop(ctx.currentTime + 0.05);
      }
    } catch {
      // 忽略
    }
    this.chargeOsc = null;
    this.chargeGain = null;
    if (!ctx || this.muted) return;
    try {
      const t0 = ctx.currentTime;
      // 高频爆鸣（sawtooth 1200→2400）
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.setValueAtTime(1200, t0);
      o1.frequency.exponentialRampToValueAtTime(2400, t0 + 0.12);
      const g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.16, t0);
      g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      o1.connect(g1);
      g1.connect(ctx.destination);
      o1.start(t0);
      o1.stop(t0 + 0.15);
      // 低频冲击（sine 120→40）
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(120, t0);
      o2.frequency.exponentialRampToValueAtTime(40, t0 + 0.25);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.22, t0);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o2.connect(g2);
      g2.connect(ctx.destination);
      o2.start(t0);
      o2.stop(t0 + 0.3);
    } catch {
      // 忽略
    }
  }
}
