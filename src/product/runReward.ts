/**
 * PRODUCT-LOOP-R1-B｜产品奖励的**策略与地址唯一真源**（纯逻辑，零 DOM、零存档）。
 * PRODUCT-LOOP-R1-C｜追加：**局外 Equipped Loadout 的交接口径**（同一处，不分第二个真源）。
 *
 * 这个模块回答四个问题，全部只在这里回答一次：
 *   ① 「本局奖励是哪件部件」→ `REWARD_WEAPON_ID`（**固定**奖励：本 Queue 验证的是
 *      「获得一个新东西后想不想马上装上它」，不是随机掉落 —— Queue 必改 2 明令「甚至优先固定」）；
 *   ② 「怎么开始一局带奖励的冒险」→ `buildAdventureHref()`（唯一产出产品 URL 的地方）；
 *   ③ 「玩家带着什么参数回到首页」→ `buildClaimHref()` / `parsePendingClaim()`；
 *   ④ 「本局战斗用哪份装备」→ `encodeRunLoadout()`（把**当前 Player Profile Equipped 的
 *      同一份 `BuildDraft`** 原样编进 ② 的地址，不重算、不推导、不挑字段）。
 *
 * ── 为什么 URL 只由这里产出 ────────────────────────────────────────────────
 * 局内 Run Page 属于实验台（Lab）目录，它的源码白名单**不允许** import 产品模块
 * ⇒ 产品侧必须把「本局 token / 奖励 id / 回程地址」**通过 URL 交给它**。
 * 因此本模块是**唯一**知道产品地址的地方：Lab 侧连一个产品 URL 字面量都不许有
 * （`tests/portraitRunPage.test.ts` 的 `RP-25b` 与 `tests/productLoopRunReward.test.ts`
 * 的 `PR-21` 双向钉死）。
 *
 * ── PRODUCT-LOOP-R1-C：为什么装备也走 URL（而不是让 Run 页自己读存档）────────
 * Queue 必改 2 要求「Run 第一场真实战斗用的武器 = Profile Equipped 武器」，
 * 并禁止「首页显示 A，战斗实际跑 B」。三条通道各自的代价：
 *   - **让 Lab 直接读正式存档**：需要把 `core/buildPersistence` 加进 Lab 的闭集白名单
 *     ⇒ Lab 从此**能写**正式存档，B 段「Lab 结构上写不了正式存档」这条隔离保证被削弱；
 *     而且 `run-page.html` 的**研发**入口（不带产品参数）也会开始跟着玩家存档变化，
 *     研发基线不再稳定（既有 Run 像素账本 / 启动链 smoke 都会变成「依赖存档状态」）。
 *   - **只传一个武器 id，Lab 侧用 starter 重建**：Lab 必须自己知道「哪个槽是武器槽」
 *     ⇒ 与产品侧出现第二份「槽位语义」，正是 Queue 警告的「按 role 推断」。
 *   - **传整份 `BuildDraft`**（本 Queue 选择）：唯一共享词汇就是 `BuildDraft` 本身
 *     （两侧本来就在用它：产品侧 `playerLoadout.ts` 已经在读写同一个类型）。
 *     产品侧只做 `JSON.stringify`，Lab 侧只做「严格校验 + 原样交给正式链路」
 *     ⇒ 没有任何一方需要「理解」这份装备的含义，也就不可能各自理解成不同的东西。
 *   代价（如实披露）：URL 变长（一份 starter Build ≈ 0.2 KB，编码后 ≈ 0.4 KB，
 *   加上嵌套的 `back` 后整条 href ≈ 1 KB）；`equipped` 参数**不是**存档，
 *   它只是「这一局用什么」的一次性传输 —— 持久化仍然只有 `playerBuild.v1` 一处。
 *
 * ── 幂等键 = runToken ─────────────────────────────────────────────────────
 * 每次**首页挂载**生成一个新 token（= 一次新的「准备出发」）。同一 token 只可能领一次奖：
 * 重复点击 / 重复结算 / 刷新领奖 URL 都会被 Profile Repository 挡住（Queue 必改 4）。
 */
import { registry } from '../core/content';
import type { BuildDraft } from '../lab/buildEditorModel';

/**
 * 本局奖励：**固定**为「镭射」（`laser`）。
 *
 * 选择依据（全部是实测，不是偏好）：
 *   - **正式部件**：在 `PART_OPTIONS` 里（正式 Build 池内），`registry` 中 `category === 'weapon'`；
 *   - **初始不拥有**：`STARTER_PARTS = ['cannon','hammer','pushRod','spear']` ⇒ starter 拥有
 *     炮 / 锤 / 刺三件武器，镭射**不在**其中 ⇒ 第一局拿到的是真正的新东西；
 *   - **当前车辆能合法装备**：在 `watermelonBody` 的 `frontMass` 槽上过正式 `validateSnapshot`
 *     （实测 `valid = true`，总能量 90 ≤ 容量 110）——「拿到就想装上」在结构上成立；
 *   - **与既有主武器差异明显**：能量 45（炮是 30）⇒ 首页能量读数 75 → 90 可见地变化，
 *     玩家能立刻看出「装上去真的不一样」。
 *   ⚠️ 其它同样合法的候补：`machineGun` / `saw` / `shotgun` / `flamethrower` / `rammer`
 *      （能量 25~30）。换奖励只改这一个常量（但必须重跑 `tests/productLoopRunReward.test.ts`
 *      的合法性断言，那里是**用真实校验器**算的，不是写死的期望值）。
 */
export const REWARD_WEAPON_ID = 'laser';

/** 冒险入口（与 `home.html` 同一竖屏产物内的相对地址）。 */
export const ADVENTURE_HREF = './run-page.html';
/** 正式首页（与 A 段的 `home.html` 同一份文件）。 */
export const HOME_HREF = './home.html';

/** URL 参数名（产品侧与 Lab 侧的唯一约定）。 */
export const RUN_PARAM = 'run';
export const REWARD_PARAM = 'reward';
export const BACK_PARAM = 'back';
/**
 * PRODUCT-LOOP-R1-C｜本局**装备**参数（= 出发那一刻 Player Profile 里那份 `BuildDraft` 的 JSON）。
 *
 * ⚠️ 参数名刻意叫 `loadout`（装备）而不是 `weapon`：传的是**整份 Build**，
 *    不只是武器 —— 若将来某个槽变成可编辑（例如轮组 / 顶部挂点），
 *    这条通道**不需要任何改动**就自然带上新内容（不会退化成「只同步了武器」）。
 */
export const LOADOUT_PARAM = 'equipped';

/**
 * 把一份 `BuildDraft` 编成 URL 可携带的 JSON 串。
 *
 * ⚠️ **只搬运，不解释**：字段名就是 `BuildDraft` 自己的字段名，产品侧不做任何
 *    「这件是什么 / 该放哪个槽」的判断（那属于装备语义，产品侧只需保证「传的就是存档里那一份」）。
 * ⚠️ 只导出 `BuildDraft` 已知字段 ⇒ 存档里将来多出来的未知字段不会被偷偷带进战斗。
 * ⚠️ 空值字段（`undefined`）**整键省略**：与 `makeStarterDraft` 省略 `rearWheelDefId`
 *    的既有形态一致，避免把「缺省 = 标准轮」写成显式的 `undefined`。
 */
export function encodeRunLoadout(draft: BuildDraft): string {
  const out: Record<string, unknown> = {
    bodyDefId: draft.bodyDefId,
    rearRadius: draft.rearRadius,
    frontRadius: draft.frontRadius,
    functionalSelections: { ...draft.functionalSelections },
  };
  if (draft.rearWheelDefId !== undefined) out['rearWheelDefId'] = draft.rearWheelDefId;
  if (draft.frontWheelDefId !== undefined) out['frontWheelDefId'] = draft.frontWheelDefId;
  if (draft.drive !== undefined) out['drive'] = draft.drive;
  if (draft.functionalStars !== undefined) out['functionalStars'] = { ...draft.functionalStars };
  return JSON.stringify(out);
}

/**
 * 新一局的 token（幂等键）。
 *
 * 形如 `run-<base36 时间>-<base36 盐>`。两个入参都可显式传入 ⇒ node 侧可断言确定性；
 * 不引入 uuid / 新 dependency。
 */
export function newRunToken(now: number = Date.now(), salt: number = Math.random()): string {
  const t = Math.max(0, Math.floor(Number.isFinite(now) ? now : 0)).toString(36);
  const clamped = Math.max(0, Math.min(0.999999, Number.isFinite(salt) ? salt : 0));
  const s = Math.floor(clamped * 0xffffff)
    .toString(36)
    .padStart(5, '0');
  return `run-${t}-${s}`;
}

/** 领奖地址：玩家点「领取并返回」后落到的页面（`home.html` + 两个参数）。 */
export function buildClaimHref(runToken: string, defId: string = REWARD_WEAPON_ID): string {
  const p = new URLSearchParams();
  p.set(RUN_PARAM, runToken);
  p.set(REWARD_PARAM, defId);
  return `${HOME_HREF}?${p.toString()}`;
}

/**
 * 「开始冒险」的地址：把本局 token / 奖励 / **本局装备** / 回程地址一并交给 Run Page。
 *
 * ⚠️ `back` 就是 `buildClaimHref()` 的结果，**由产品侧给全** ⇒ Lab 侧不需要知道
 *    「首页叫什么」。嵌套的 `?` / `&` 由 `URLSearchParams` 负责转义。
 *
 * ⚠️ `equippedDraft` 省略 / `null` ⇒ **不加该参数**（旧链接形态逐字节不变）。
 *    这既是向后兼容，也让「不带装备的链接」在 Lab 侧退化成「固定演示装载」——
 *    研发入口（`dev:run-page`）因此完全不受本 Queue 影响。
 */
export function buildAdventureHref(
  runToken: string,
  defId: string = REWARD_WEAPON_ID,
  equippedDraft?: BuildDraft | null,
): string {
  const p = new URLSearchParams();
  p.set(RUN_PARAM, runToken);
  p.set(REWARD_PARAM, defId);
  if (equippedDraft) p.set(LOADOUT_PARAM, encodeRunLoadout(equippedDraft));
  p.set(BACK_PARAM, buildClaimHref(runToken, defId));
  return `${ADVENTURE_HREF}?${p.toString()}`;
}

/** 领奖输入（首页从 URL 拿到的两个字段）。 */
export interface PendingClaim {
  readonly runToken: string;
  readonly rewardDefId: string;
}

/**
 * 从 `location.search` 形态的字符串解析领奖输入：两个参数缺一不可。
 * ⚠️ 这里**不校验** defId 是否真是一件合法部件 —— 那是 Profile Repository 的职责
 *    （`claimRunReward` 会过正式内容库 + 正式 `validateSnapshot`）；
 *    本函数只回答「玩家是不是带着一次领奖请求回来了」。
 */
export function parsePendingClaim(search: string): PendingClaim | null {
  if (typeof search !== 'string' || search === '') return null;
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search);
  } catch {
    return null;
  }
  const runToken = p.get(RUN_PARAM) ?? '';
  const rewardDefId = p.get(REWARD_PARAM) ?? '';
  if (runToken === '' || rewardDefId === '') return null;
  return { runToken, rewardDefId };
}

/**
 * 奖励部件的**展示名**（来自正式内容库 ⇒ 与页面 / 卡片同源，不是第二份字面量）。
 * 未知 id → `null`（绝不静默回退到别的部件名）。
 */
export function rewardDisplayName(defId: string = REWARD_WEAPON_ID): string | null {
  return registry.functionals.get(defId)?.name ?? null;
}
