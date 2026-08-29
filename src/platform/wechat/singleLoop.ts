/**
 * F-WX-RUNTIME-LIFECYCLE-P0（Must#3「单一循环 / 不重复 rAF」）：
 * 单循环调度守卫——保证任意时刻至多存在一个「待执行帧」。
 *
 * 旧实现在 onShow 里无条件 `requestAnimationFrame(frame)`，微信某些场景（快速切后台再回前台、
 * 连续 onShow）会并发起**第二个** frame 循环 → 双倍 tick / 双击渲染 / 双倍音频调度。
 * 本类把「至多一个待执行帧」的记账抽象出来，既能被 game.ts 直接复用，也能被单元测试精确验证。
 */
export type FrameCallback = (now: number) => void;
export type RafFn = (cb: FrameCallback) => number;
export type CafFn = (handle: number) => void;

export class SingleLoop {
  private handle: number | null = null;
  private scheduled = false;
  private running = true;
  /** 每帧回调（需在构造后、启动前设置；避免循环引用） */
  onFrame: FrameCallback = () => {};

  constructor(
    private readonly raf: RafFn,
    private readonly caf: CafFn,
  ) {}

  /** 当前是否在跑（后台暂停 / 前台恢复） */
  get isRunning(): boolean {
    return this.running;
  }

  /** 启动循环（前台恢复）：重新允许调度，若尚未有待执行帧则补一帧 */
  start(): void {
    this.running = true;
  }

  /** 停止循环（后台暂停）：取消待执行帧 + 清记账；不抛错、不可逆调用安全 */
  stop(): void {
    this.running = false;
    if (this.handle !== null) {
      this.caf(this.handle);
      this.handle = null;
    }
    this.scheduled = false;
  }

  /** 幂等调度：若已有待执行帧（running 且 scheduled）则不重复注册 */
  request(): void {
    if (!this.running || this.scheduled) return;
    this.scheduled = true;
    this.handle = this.raf((t) => this.step(t));
  }

  /** 待执行帧数（测试探针：恒 ≤1） */
  get pendingFrames(): number {
    return this.scheduled ? 1 : 0;
  }

  private step(t: number): void {
    this.scheduled = false; // 本帧已消费该次调度
    if (!this.running) return;
    this.onFrame(t);
    if (this.running) this.request(); // 续帧（仍受幂等保护）
  }
}
