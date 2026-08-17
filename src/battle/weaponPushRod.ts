/**
 * Push Rod（线性推杆 Gadget）驱动。
 *
 * - rod 是单 box 刚体，无 Joint，由本模块运动学控制（setPosition 沿 Hardpoint 世界方向）；
 * - 状态机：idle（冷却）→ extending（伸出）→ holding（保持）→ retracting（收回）→ idle；
 * - 推动敌人：rod 真实碰撞体（category=vehicle、mask 含敌车），Matter 碰撞求解器
 *   位置修正推开敌人 = 真实 Contact 反作用；同时在 extending 阶段施加有限推力（pushForce），
 *   让轻 / 重车在同一推力下产生明显位移差异（F = m·a，质量不同加速度不同）；
 * - Direct Damage = 0（Push Rod 是 Gadget，contactRouter 对 category !== 'weapon' 不结算伤害）；
 * - 推力只来自「伸出机械过程」：extending 阶段施加、holding / retracting 不施加，
 *   持续贴合不会每帧反复爆发额外 Push。
 *
 * 说明（Matter 固有限制）：Matter 无 prismatic joint，纯约束方案（单/双 constraint + 动态 length）
 * 会下垂或数值震荡，无法干净地保持「固定方向线性伸出」。因此 rod 采用运动学（setPosition）控制，
 * 方向由 Body 姿态 + Hardpoint 方向精确决定；推动敌人仍走真实 Collider Contact。
 */
import type { PushRodParams } from '../core/types';
import { setPosition, setAngle, setVelocity, applyForceAt, getBounds } from '../physics/adapter';
import type { Vehicle, PartRuntime } from './vehicleAssembly';

function rotateLocal(v: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/** hardpoint 世界位置（Body 姿态 + 镜像后的硬点） */
function hardpointWorld(v: Vehicle, part: PartRuntime): { x: number; y: number } {
  const hpLocal = {
    x: v.facing * part.hardpoint.localPosition.x,
    y: part.hardpoint.localPosition.y,
  };
  const r = rotateLocal(hpLocal, v.body.angle);
  return { x: v.body.position.x + r.x, y: v.body.position.y + r.y };
}

/** rod 伸出方向（facing 方向，随 Body 姿态旋转） */
function rodDir(v: Vehicle): { x: number; y: number } {
  return rotateLocal({ x: v.facing, y: 0 }, v.body.angle);
}

/** rod 尖端世界位置（前端，用于接触检测 + 冲量作用点） */
function rodTipWorld(v: Vehicle, part: PartRuntime): { x: number; y: number } {
  const hp = hardpointWorld(v, part);
  const params = part.def.behaviorParams as unknown as PushRodParams;
  const dir = rodDir(v);
  const reach = params.rodLength + (part.pushExtension ?? 0);
  return { x: hp.x + dir.x * reach, y: hp.y + dir.y * reach };
}

/** 更新 rod 位置与角度（运动学跟随 Body 姿态 + Hardpoint 方向） */
function updateRodPose(v: Vehicle, part: PartRuntime): void {
  const params = part.def.behaviorParams as unknown as PushRodParams;
  const hp = hardpointWorld(v, part);
  const dir = rodDir(v);
  const center = {
    x: hp.x + dir.x * (params.rodLength / 2 + (part.pushExtension ?? 0)),
    y: hp.y + dir.y * (params.rodLength / 2 + (part.pushExtension ?? 0)),
  };
  setPosition(part.body, center);
  setAngle(part.body, v.body.angle);
  // 关键：rod 是运动学刚体，每步 setPosition 到目标位。Matter setPosition(updateVelocity=false)
  // 会平移 positionPrev 保持速度，重力会让 rod 每步下坠 → 拉回量累积 → positionPrev 漂移 → velocity 正反馈爆炸。
  // 因此清零速度（positionPrev 同步到 position），让 rod 完全由 setPosition 决定位置。
  setVelocity(part.body, 0, 0);
}

/** rod 与 opponent 是否接触（rod 尖端进入 opponent 主 body 的 bounds） */
function touchingOpponent(v: Vehicle, part: PartRuntime, opponent: Vehicle): boolean {
  const tip = rodTipWorld(v, part);
  const b = getBounds(opponent.body);
  return tip.x >= b.min.x && tip.x <= b.max.x && tip.y >= b.min.y && tip.y <= b.max.y;
}

/** extending 阶段：对接触点施加有限推力（推动敌人），体现轻重 / 高低位差异 */
function pushOpponent(v: Vehicle, part: PartRuntime, opponent: Vehicle, params: PushRodParams): void {
  if (!touchingOpponent(v, part, opponent)) return;
  const tip = rodTipWorld(v, part);
  const dir = rodDir(v);
  // 推力沿伸出方向，作用在接触点（rod 尖端）：安装高度不同 → 作用点不同 → 平移/旋转差异
  applyForceAt(opponent.body, tip, dir.x * params.pushForce, dir.y * params.pushForce);
  // 说明：反冲（牛顿第三定律，作用在推方）会导致推方 body 的 velocity 持续累积并数值爆炸
  // （Matter 软约束下推方 body 的 vy 已累积到 ~260，任何额外力都会打破 wheel constraint 平衡）。
  // 因此本轮不施加反冲，推方仅通过「伸出机械过程 + 目标接触反作用」参与，反冲留作后续精调。
}

/**
 * 更新 Push Rod 状态机 + 位置 + 推动。
 * 由 BattleOrchestrator 每步调用（对每辆车，传对方车）。
 */
export function updatePushRod(pusher: Vehicle, opponent: Vehicle, dtMs: number): void {
  for (const part of pusher.parts) {
    if (part.def.behavior !== 'pushRod') continue;
    const params = part.def.behaviorParams as unknown as PushRodParams;
    const phase = part.pushPhase ?? 'idle';
    const ext = part.pushExtension ?? 0;

    switch (phase) {
      case 'idle': {
        const remain = (part.pushTimer ?? 0) - dtMs;
        if (remain <= 0) {
          part.pushPhase = 'extending';
          part.pushTimer = 0;
        } else {
          part.pushTimer = remain;
        }
        break;
      }
      case 'extending': {
        const next = ext + params.extensionSpeed;
        if (next >= params.extensionDistance) {
          part.pushExtension = params.extensionDistance;
          part.pushPhase = 'holding';
          part.pushTimer = params.holdMs;
        } else {
          part.pushExtension = next;
        }
        // 伸出机械过程产生推力（轻 / 重车差异）
        pushOpponent(pusher, part, opponent, params);
        break;
      }
      case 'holding': {
        const remain = (part.pushTimer ?? 0) - dtMs;
        if (remain <= 0) {
          part.pushPhase = 'retracting';
          part.pushTimer = 0;
        } else {
          part.pushTimer = remain;
        }
        break;
      }
      case 'retracting': {
        const next = ext - params.retractSpeed;
        if (next <= 0) {
          part.pushExtension = 0;
          part.pushPhase = 'idle';
          part.pushTimer = params.cooldown;
        } else {
          part.pushExtension = next;
        }
        break;
      }
    }

    updateRodPose(pusher, part);
  }
}
