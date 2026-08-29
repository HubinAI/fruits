/**
 * Audio Service（W2-FX-1）：统一 SFX 服务。
 *
 * - 正式表现层唯一的音频入口：Weapon Behavior / Renderer 一律不得直接碰音频；
 * - 本轮使用临时占位音色（Web Audio oscillator beep），重点是生产管线：
 *   `play(id)` 统一入口，缺资源 / 无 AudioContext / muted → 安全 no-op（不抛错）；
 * - 后续正式队列可把占位 beep 换成预加载 AudioBuffer / 音频资源，接口不变。
 */

/**
 * F-BATTLE-READABILITY-R1：正式战斗关键音效 id。
 * fire（攻击）/ hit（命中）/ death（败北车辆死亡）由 BattleEvent 触发；
 * closing（收束预警）/ win / lose 由 Runtime 阶段/结算切换触发。
 */
export type SfxId = 'fire' | 'hit' | 'death' | 'closing' | 'win' | 'lose';

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
  /** F-AUDIO-RESULT-LIFECYCLE-P0：战斗音频会话开始（幂等；新会话先清理上一局泄漏的循环音源） */
  startBattleAudio(sessionId: string): void;
  /** F-AUDIO-RESULT-LIFECYCLE-P0：胜负确定后停止全部循环战斗音源（淡出 150~300ms + stop + disconnect） */
  stopBattleAudio(): void;
  /** F-AUDIO-RESULT-LIFECYCLE-P0：测试探针——当前音频状态 / 活跃循环音源数 / 当前会话 / 待执行计时器 */
  getAudioProbe(): AudioProbeState;
}

/**
 * F-AUDIO-RESULT-LIFECYCLE-P0：音频探针快照（仅测试用，不参与任何 Gameplay 规则）。
 * - state：'battle-audio' = 存在活跃循环战斗音源（Battle BGM）；'idle' = 无。
 * - activeBgmSources：活跃循环战斗音源数（Battle BGM 实例数；恒 ≤1）。
 * - battleSession：当前战斗会话 id（null = 无进行中的战斗音频会话）。
 * - pendingAudioTimers：待执行的音频计时器（淡出 / 停止 / 断开排程）数。
 */
export interface AudioProbeState {
  state: 'battle-audio' | 'idle';
  activeBgmSources: number;
  battleSession: string | null;
  pendingAudioTimers: number;
}

/** F-AUDIO-RESULT-LIFECYCLE-P0：单条循环战斗音源（Battle BGM 实例）的内部句柄 */
interface LoopingBattleSource {
  osc: ReturnType<MinimalAudioContext['createOscillator']> | null;
  gain: ReturnType<MinimalAudioContext['createGain']> | null;
  /** 当前增益（用于淡出起点；exponential 不能从 0 起跳） */
  currentGain: number;
  /** 是否已调度停止（防止重复 stop / 重复计入活跃集） */
  stopped: boolean;
  /** 淡出后断开节点的计时器（null = 已清理） */
  fadeTimer: ReturnType<typeof setTimeout> | null;
}

/** Web Audio 占位音色参数：id → 频率 / 时长 / 音量 */
const BEEP_PARAMS: Record<SfxId, { freq: number; endFreq: number; dur: number; gain: number }> = {
  // 开火：短促高频哒（高频 → 更高）
  fire: { freq: 880, endFreq: 1400, dur: 0.08, gain: 0.12 },
  // 命中：中频短促撞击
  hit: { freq: 320, endFreq: 160, dur: 0.09, gain: 0.14 },
  // 死亡：低频较长下沉
  death: { freq: 220, endFreq: 60, dur: 0.35, gain: 0.18 },
  // F-BATTLE-READABILITY-R1：收束预警（Warning/Closing 进入）——低沉双段警鸣（区别于普通 hit）
  closing: { freq: 420, endFreq: 210, dur: 0.3, gain: 0.15 },
  // 胜利：上扬三连感（高频 → 更高，单 beep 上扬）
  win: { freq: 660, endFreq: 1320, dur: 0.25, gain: 0.16 },
  // 失败：低频下沉（比 death 更缓）
  lose: { freq: 240, endFreq: 90, dur: 0.4, gain: 0.16 },
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
    disconnect(): void;
    start(t?: number): void;
    stop(t?: number): void;
  };
  createGain(): {
    gain: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void };
    connect(d: unknown): void;
    disconnect(): void;
  };
}

type AudioContextCtor = new () => MinimalAudioContext;

export class SfxAudioService implements SfxService {
  private ctx: MinimalAudioContext | null = null;
  private muted = false;

  /**
   * 惰性创建 AudioContext（无音频环境 / 创建失败 → null，play 安全 no-op）。
   *
   * F-WX-RUNTIME-LIFECYCLE-P0（Must#5）：**微信小游戏没有 `globalThis.AudioContext`**——
   * 旧实现只查标准构造器，导致微信端 ensureContext 恒返回 null，全部音效静默失效
   * （「Web 有实现」≠「微信端成立」）。此处按序尝试：
   *   1) 标准 AudioContext（Web / 部分微信基础库）；
   *   2) `wx.createWebAudioContext()`（微信小游戏官方音频接口，基础库 2.19.0+）；
   * 两者都缺失/失败 → null（既有安全 no-op 行为不变）。
   * 只创建一次并缓存（Must#3：不重复创建 AudioContext）。
   */
  private ensureContext(): MinimalAudioContext | null {
    if (this.ctx) return this.ctx;
    const g = globalThis as {
      AudioContext?: AudioContextCtor;
      webkitAudioContext?: AudioContextCtor;
      wx?: { createWebAudioContext?: () => MinimalAudioContext };
    };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (typeof Ctor === 'function') {
      try {
        this.ctx = new Ctor();
        return this.ctx;
      } catch {
        this.ctx = null; // 创建失败 → 继续尝试微信接口
      }
    }
    const wx = g.wx;
    if (wx && typeof wx.createWebAudioContext === 'function') {
      try {
        this.ctx = wx.createWebAudioContext();
        return this.ctx;
      } catch {
        this.ctx = null;
      }
    }
    return null;
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

  // F-AUDIO-RESULT-LIFECYCLE-P0：循环战斗音源（唯一持续性战斗音频 = Battle BGM）生命周期管理
  /** 活跃循环音源集（Battle BGM 实例；恒 ≤1，charge 单例 + 全路径走淡出停止） */
  private battleLoops = new Set<LoopingBattleSource>();
  /** charge 当前绑定的循环源（与 battleLoops 中同一实例；便于开火时精准停药） */
  private chargeSource: LoopingBattleSource | null = null;
  /** 当前战斗音频会话 id（startBattleAudio 登记；stop 清 null） */
  private battleSessionId: string | null = null;
  /** 待执行的音频计时器（淡出/停止/断开排程）计数——探针用 */
  private pendingAudioTimers = 0;

  /** Q11-C-R2：蓄能期间升调/增强（progress 0→1；重复调用持续更新频率与增益）。
   *  F-AUDIO-RESULT-LIFECYCLE-P0：charge 为单例循环源，重复调用幂等（复用同一 osc，不新增）。 */
  startLaserCharge(progress: number): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return; // 缺资源 / 无音频环境：安全 skip
    try {
      let src = this.chargeSource;
      if (!src || src.stopped) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(ctx.currentTime);
        src = { osc, gain: g, currentGain: 0.03, stopped: false, fadeTimer: null };
        this.chargeSource = src;
        this.battleLoops.add(src); // 活跃循环音源 +1（恒 ≤1：charge 单例）
      }
      const t = ctx.currentTime;
      const p = Math.max(0, Math.min(1, progress));
      // 此时 src 必为非空（true 分支已重建 / false 分支本就非空）
      const live = src!;
      live.osc!.frequency.setValueAtTime(180 + p * 420, t); // 180→600 升调
      live.currentGain = 0.03 + p * 0.07;
      live.gain!.gain.setValueAtTime(live.currentGain, t); // 增强
    } catch {
      // 任何音频异常都不影响战斗表现
    }
  }

  /** Q11-C-R2：fire 立即结束 charge 声 + 高频爆鸣 + 低频冲击 */
  stopLaserCharge(): void {
    const src = this.chargeSource;
    this.chargeSource = null;
    this.fadeOutAndStop(src, 50); // 开火即结束 charge 声（快速淡出，不循环）
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    try {
      const t0 = ctx.currentTime;
      // 高频爆鸣（sawtooth 1200→2400）——明显区别于 Cannon 的 square 短 beep
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.setValueAtTime(1200, t0);
      o1.frequency.exponentialRampToValueAtTime(2400, t0 + 0.12);
      const g1 = ctx.createGain();
      // Q11-C-R3-FINAL：降增益避免与低频冲击叠加削波（峰值 ~0.29 < 1.0）
      g1.gain.setValueAtTime(0.13, t0);
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
      g2.gain.setValueAtTime(0.16, t0);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o2.connect(g2);
      g2.connect(ctx.destination);
      o2.start(t0);
      o2.stop(t0 + 0.3);
    } catch {
      // 忽略
    }
  }

  /** F-AUDIO-RESULT-LIFECYCLE-P0：内部——淡出 + 停止调度 + 延时断开（不得只把 volume 设为 0）。
   *  立即从活跃集移除（probe activeBgmSources 同步归零），fadeMs 后真正 stop 并 disconnect 回收节点。 */
  private fadeOutAndStop(src: LoopingBattleSource | null, fadeMs: number): void {
    if (!src || src.stopped) return;
    src.stopped = true;
    this.battleLoops.delete(src); // 立即移出活跃集（同步归零，满足「Result 后 500ms 内 source=0」）
    const ctx = this.ctx;
    if (ctx && src.osc && src.currentGain > 0.0001) {
      try {
        const t = ctx.currentTime;
        if (src.gain) {
          src.gain.gain.setValueAtTime(src.currentGain, t); // 从当前增益起跳（exponential 不能从 0）
          src.gain.gain.exponentialRampToValueAtTime(0.0001, t + fadeMs / 1000);
        }
        src.osc.stop(t + fadeMs / 1000 + 0.02);
      } catch {
        // 忽略：节点异常不影响战斗
      }
    }
    // 淡出后断开节点，回收资源（不能只把 volume 设为 0）
    this.pendingAudioTimers += 1;
    src.fadeTimer = globalThis.setTimeout(() => {
      try {
        src.osc?.disconnect();
        src.gain?.disconnect();
      } catch {
        // 忽略
      }
      src.fadeTimer = null;
      this.pendingAudioTimers = Math.max(0, this.pendingAudioTimers - 1);
    }, fadeMs + 60);
  }

  /** F-AUDIO-RESULT-LIFECYCLE-P0：战斗音频会话开始。
   *  幂等：同一 session 重复调用不新增音源；新 session 先淡出清理上一局可能泄漏的循环音源
   *  （满足「下一场只创建一个新 BGM，不得复用已结束/泄漏的上一局音源」）。 */
  startBattleAudio(sessionId: string): void {
    // 幂等：同一会话重复调用 = 纯 no-op（不得停掉当前战斗正在播放的音频，也不新增音源）
    if (this.battleSessionId === sessionId) return;
    // 新会话：先停掉上一局残留/泄漏的循环音源（满足「下一场只创建一个新 BGM，不得复用已结束/泄漏的上一局音源」）
    if (this.battleLoops.size > 0) {
      for (const s of [...this.battleLoops]) this.fadeOutAndStop(s, 200);
    }
    this.chargeSource = null;
    this.battleSessionId = sessionId;
  }

  /** F-AUDIO-RESULT-LIFECYCLE-P0：胜负确定后停止全部循环战斗音源（150~300ms 内淡出+stop+disconnect）。 */
  stopBattleAudio(): void {
    for (const s of [...this.battleLoops]) this.fadeOutAndStop(s, 220);
    this.chargeSource = null;
    this.battleSessionId = null;
  }

  /** F-AUDIO-RESULT-LIFECYCLE-P0：测试探针（仅测试用） */
  getAudioProbe(): AudioProbeState {
    return {
      state: this.battleLoops.size > 0 ? 'battle-audio' : 'idle',
      activeBgmSources: this.battleLoops.size,
      battleSession: this.battleSessionId,
      pendingAudioTimers: this.pendingAudioTimers,
    };
  }
}
