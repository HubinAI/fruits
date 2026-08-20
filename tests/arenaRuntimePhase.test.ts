/**
 * Queue F-02M-B11B｜Matter Arena 接入共享阶段时钟集成测试
 *
 * 验证 ArenaRuntime 改用 ArenaPhaseClock 后：
 * 1. 完整阶段顺序与边界（>= 判定、转换清零）；
 * 2. 进入 Closing 时墙体 static → dynamic；
 * 3. 进入 Closing 的当步速度仍为零，下一步才左右相向推进；
 * 4. Closing→End 与 End 后稳定；
 * 5. setPhase 只切阶段、清零计时，不擅自激活墙体。
 */
import { describe, it, expect } from 'vitest';
import { Body } from 'matter-js';
import { PhysWorld } from '../src/physics/adapter';
import { ArenaRuntime } from '../src/battle/arenaRuntime';
import { DEFAULT_ARENA_CONFIG } from '../src/battle/arenaConfig';

function makeArena(): { world: PhysWorld; arena: ArenaRuntime } {
  const world = new PhysWorld({ x: 0, y: 0, scale: 0 });
  const arena = new ArenaRuntime(world);
  return { world, arena };
}

describe('F-02M-B11B · ArenaRuntime 共享阶段时钟接入', () => {
  it('完整阶段顺序与边界（10s/3s/5s、>= 判定、转换清零）', () => {
    const { arena } = makeArena();
    expect(arena.phase).toBe('Active');
    arena.update(9_999);
    expect(arena.phase).toBe('Active'); // 差 1ms
    arena.update(1);
    expect(arena.phase).toBe('Warning'); // 恰好边界
    arena.update(2_999);
    expect(arena.phase).toBe('Warning');
    arena.update(1);
    expect(arena.phase).toBe('Closing');
    arena.update(4_999);
    expect(arena.phase).toBe('Closing');
    arena.update(1);
    expect(arena.phase).toBe('End');
  });

  it('进入 Closing 时墙体由 static 变为 dynamic；当步速度为零，下一步才相向推进', () => {
    const { arena } = makeArena();
    // 初始：Closing 墙 static
    for (const cw of arena.closingWalls) expect(cw.body.isStatic).toBe(true);

    // 推进到 Warning
    arena.update(10_000);
    expect(arena.phase).toBe('Warning');
    for (const cw of arena.closingWalls) expect(cw.body.isStatic).toBe(true);

    // Warning→Closing：墙激活为 dynamic（当步速度仍为零）
    arena.update(3_000);
    expect(arena.phase).toBe('Closing');
    for (const cw of arena.closingWalls) {
      expect(cw.body.isStatic).toBe(false); // static → dynamic
      const v = Body.getVelocity(cw.body);
      expect(v.x).toBe(0); // 当步不推进
    }

    // 下一步：左右相向推进（left +closingSpeed、right -closingSpeed）
    arena.update(1);
    const left = arena.closingWalls.find((w) => w.side === 'left')!;
    const right = arena.closingWalls.find((w) => w.side === 'right')!;
    expect(Body.getVelocity(left.body).x).toBeCloseTo(DEFAULT_ARENA_CONFIG.closingSpeed, 5);
    expect(Body.getVelocity(right.body).x).toBeCloseTo(-DEFAULT_ARENA_CONFIG.closingSpeed, 5);
  });

  it('Closing→End 该步仍执行最后一次推进；End 后不再更新', () => {
    const { arena } = makeArena();
    arena.update(10_000); // Warning
    arena.update(3_000); // Closing（激活，当步不推进）
    arena.update(4_999); // 推进中
    const left = arena.closingWalls.find((w) => w.side === 'left')!;
    // Closing→End 当步：仍设置速度 + 转 End
    arena.update(1);
    expect(arena.phase).toBe('End');
    expect(Body.getVelocity(left.body).x).toBeCloseTo(DEFAULT_ARENA_CONFIG.closingSpeed, 5); // 最后一次推进已执行

    // End 后：update 不再改变（墙速度保持，不再推进）
    arena.update(1_000);
    expect(arena.phase).toBe('End');
    expect(Body.getVelocity(left.body).x).toBeCloseTo(DEFAULT_ARENA_CONFIG.closingSpeed, 5);
  });

  it('setPhase 只切阶段、清零计时，不擅自激活墙体', () => {
    const { arena } = makeArena();
    arena.update(500); // Active 推进中
    arena.setPhase('Closing');
    expect(arena.phase).toBe('Closing');
    // 未激活墙体（static 保持）
    for (const cw of arena.closingWalls) expect(cw.body.isStatic).toBe(true);
    // 计时已清零：从 Closing 重新计时 5000ms 才 End
    arena.update(4_999);
    expect(arena.phase).toBe('Closing'); // 未到 5000
    arena.update(1);
    expect(arena.phase).toBe('End');
    // 可回到 Active（Lab 调试语义）
    arena.setPhase('Active');
    expect(arena.phase).toBe('Active');
  });
});
