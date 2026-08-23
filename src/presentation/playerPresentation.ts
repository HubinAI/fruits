/**
 * F-WX-5｜玩家战斗表现接线（共享）。
 *
 * Web（main.ts）与微信（wechat/game.ts）复用同一份 BattleEvent → Presentation 映射
 * （炮口闪光 / 音效 / 蓄能 / 命中 / 伤害数字 / 死亡 FX），避免双入口漂移。
 * - 微信玩家版：无 Web Audio / 无 timeScale → SfxAudioService 惰性 no-op、
 *   onDeathFreeze 省略（Web-only 的 Death 表现层定格 80~120ms 冻结）；
 * - 全部 hook 走 Renderer「只画」方法 + 统一 SfxService；不决定伤害/规则。
 */
import { BattlePresentationController } from './battlePresentationController';
import { damageFeedbackColors } from './battlePhaseFx';
import type { Renderer } from '../render/renderer';
import type { SfxService } from './audioService';

/** Web-only 表现钩子：Death 定格调度（Web=timeScale 冻结；微信省略） */
export interface PlayerPresentationOpts {
  /** death 事件时额外表现（Web：DeathPauseScheduler 冻结 timeScale；微信缺省） */
  onDeathFreeze?: () => void;
}

/** 双入口共享的玩家战斗表现控制器（Preview 不消费；正式战斗才 bind） */
export function createPlayerPresentation(
  renderer: Renderer,
  sfx: SfxService,
  opts: PlayerPresentationOpts = {},
): BattlePresentationController {
  return new BattlePresentationController({
    // Q11-C-R3-FINAL：laser 发射沿真实 fire 方向巨炮光束 + 炮口白青强闪；
    // shotgun 扇形炮口爆闪；machineGun 枪口火舌；flamethrower 喷口小闪。
    onMuzzleFlash: (ev) => {
      if (ev.behavior === 'laser') {
        renderer.spawnLaserBeam(ev.worldPosition.x, ev.worldPosition.y, ev.worldDirection.x, ev.worldDirection.y);
        renderer.spawnMuzzleFlash(ev.worldPosition.x, ev.worldPosition.y, '#eafdff', 14);
      } else if (ev.behavior === 'shotgun') {
        renderer.spawnShotgunFan(ev.worldPosition.x, ev.worldPosition.y, ev.worldDirection.x, ev.worldDirection.y);
      } else if (ev.behavior === 'machineGun') {
        renderer.spawnMuzzleTongue(ev.worldPosition.x, ev.worldPosition.y, ev.worldDirection.x, ev.worldDirection.y);
      } else if (ev.behavior === 'flamethrower') {
        renderer.spawnMuzzleFlash(ev.worldPosition.x, ev.worldPosition.y, '#ffb24a', 3);
      } else {
        renderer.spawnMuzzleFlash(ev.worldPosition.x, ev.worldPosition.y);
      }
    },
    // Q11-C-R3-FINAL：laser 不播 Cannon 的 'fire' 音；flamethrower 每颗粒不逐发播音
    onFireSound: (ev) => {
      if (ev.behavior !== 'laser' && ev.behavior !== 'flamethrower') sfx.play('fire');
    },
    onWeaponCharge: (ev) => {
      renderer.spawnCharge(ev.partId, ev.worldPosition.x, ev.worldPosition.y, ev.progress);
      sfx.startLaserCharge(ev.progress);
    },
    onWeaponChargeEnd: (ev) => {
      renderer.clearCharge(ev.partId);
      sfx.stopLaserCharge();
    },
    onHitFlash: (ev) => renderer.spawnHitFlash(ev.target),
    onHitSpark: (ev) =>
      renderer.spawnSpark(ev.contactPoint.x, ev.contactPoint.y, damageFeedbackColors(ev.damageSource).spark),
    onDamageSound: () => sfx.play('hit'),
    onDamageNumber: (ev) => renderer.spawnDamageNumberFromEvent(ev),
    onDeathFx: (ev) => {
      renderer.spawnDeathFx(ev.team);
      opts.onDeathFreeze?.();
    },
    onDeathSound: () => sfx.play('death'),
  });
}
