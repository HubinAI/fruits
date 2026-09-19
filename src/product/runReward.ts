/**
 * PRODUCT-LOOP-R1-B｜产品奖励的**策略与地址唯一真源**（纯逻辑，零 DOM、零存档）。
 * PRODUCT-LOOP-R1-C｜追加：**局外 Equipped Loadout 的交接口径**（同一处，不分第二个真源）。
 * PRODUCT-LOOP-R2-A｜**改口径**：单件固定奖励 →「**3选1**」（`choices`，见 `REWARD_CHOICE_IDS`）。
 *
 * 这个模块回答五个问题，全部只在这里回答一次：
 *   ① 「本局能给玩家哪几件部件」→ `REWARD_CHOICE_IDS`（**固定三件已有正式 Weapon**：
 *      炮 / 刺 / 锤。Queue 必改 4 明令「第一版只使用已有 cannon / spear / hammer」、
 *      「禁止新增 Weapon」、「不做随机奖励」）；
 *   ② 「怎么开始一局带奖励的冒险」→ `buildAdventureHref()`（唯一产出产品 URL 的地方）；
 *   ③ 「玩家带着什么参数回到首页」→ `buildClaimHref()` / `parsePendingClaim()`
 *      （⚠️ R2-A **完全未改**：玩家选中哪一件，回首页的 URL 就是
 *      `home.html?run=<token>&reward=<选中的 defId>` ⇒ 原来那条幂等领奖链路一字没动）；
 *   ④ 「本局战斗用哪份装备」→ `encodeRunLoadout()`（把**当前 Player Profile Equipped 的
 *      同一份 `BuildDraft`** 原样编进 ② 的地址，不重算、不推导、不挑字段）；
 *   ⑤ 「局内**失败**了回哪儿」→ `HOME_PARAM`（`home` = **纯首页地址**，与 ③ 的领奖地址
 *      是两个不同的出口 ⇒ 失败链结构上拿不到领奖地址）。
 *
 * ── R2-A 为什么把「一个 back」换成「一份 choices」───────────────────────────
 * R1-B 时终点只有一件事可做（领走那一件），因此 Lab 侧只需要**一个**目标地址 `back`。
 * R2-A 之后终点是**一次选择**：三张卡各自对应一次不同的领奖（三件的 defId 不同 ⇒
 * 领奖地址必然不同）。而 Lab 侧**不许**自己拼产品 URL（它连 `home.html` 这个字面量都不许有），
 * 于是产品侧必须把**每条候选自己的领奖地址**一次性给全：
 *
 *     `choices` = `[{defId, star, countBefore, href}, …]`（`href` = `buildClaimHref(token, defId)`）
 *
 * ⚠️ 这样 Lab 仍然**只做选择、不做拼装**：它拿到的是三份**不透明**地址，
 *    玩家选谁就原样跳谁 —— 「产品 URL 长什么样」这份知识依旧只有本模块拥有。
 * ⚠️ `countBefore` 也必须由产品侧给：三张卡要显示「当前数量 → 领取后数量」（`4 → 5`），
 *    而 Lab **读不到正式存档**（源码白名单闭集）⇒ 库存读数是产品侧传进来的事实。
 *    刻意只传**本次相关的三个 stack 读数**，不是整份库存。
 *
 * ── 为什么 URL 只由这里产出 ────────────────────────────────────────────────
 * 局内 Run Page 属于实验台（Lab）目录，它的源码白名单**不允许** import 产品模块
 * ⇒ 产品侧必须把「本局 token / 候选列表 / 回程地址」**通过 URL 交给它**。
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
 * R2-A｜终点 3选1 的**候选池** = 三件**已有正式 Weapon**（炮 / 刺 / 锤）。
 *
 * ⚠️ 全部取自 `STARTER_PARTS`（玩家一开始就拥有），且三件都实测能在默认车的
 *    `WEAPON_SLOT`（`frontMass`）上过正式 `validateSnapshot`（能量 30/25/25 ≤ 110）
 *    ⇒ 三个选项**都能真的发出去**（`claimRunReward` 的 `not-equippable` 分支不会静默吃掉一个选项）。
 *    `tests/productLoopRunReward.test.ts` 的 `PR-08b` 用**真实校验器**逐件钉死这条，
 *    内容（能量 / 挂点）一变动测试立刻报警，不会静默退化成「三选一里有一个是废选项」。
 * ⚠️ 顺序 = 界面上的展示顺序（第一个也就是 Garage 里最顺手的那件），刻意不排序 ——
 *    顺序本身是产品决策，不是数据推导。
 * ⚠️ 不引入 `laser`（R1-B 的单件固定奖励）等「玩家初始不拥有」的部件：
 *    Queue 要求 first-version 只用 `cannon` / `spear` / `hammer`，且禁止新增 Weapon。
 */
export const REWARD_CHOICE_IDS: readonly string[] = ['cannon', 'spear', 'hammer'];

/** 冒险入口（与 `home.html` 同一竖屏产物内的相对地址）。 */
export const ADVENTURE_HREF = './run-page.html';
/** 正式首页（与 A 段的 `home.html` 同一份文件）。 */
export const HOME_HREF = './home.html';

/** URL 参数名（产品侧与 Lab 侧的唯一约定）。 */
export const RUN_PARAM = 'run';
/**
 * 领奖参数（**只出现在回首页的那条地址上**，不出现在出发地址上）。
 *
 * ⚠️ R2-A 未改：玩家在终点选中哪一件，回首页的 URL 里 `reward` 就是哪一件的 defId
 *    ⇒ 首页那条「幂等领奖」链路（`parsePendingClaim` → `claimRunReward`）一字未动。
 */
export const REWARD_PARAM = 'reward';
/**
 * PRODUCT-LOOP-R2-A｜**3选1 候选列表**参数（出发地址 → Run Page）。
 *
 * 值 = `JSON.stringify(RewardChoiceLink[])`，每条含 `defId` / `star` / `countBefore` / `href`，
 * 其中 `href` 就是**这一件**的领奖地址（`buildClaimHref(token, defId)`）。
 *
 * ⚠️ 它**取代**了 R1-B 的 `back`（单件终点的唯一目标地址）：终点从「领走那一件」
 *    变成「三选一」之后，目标地址必然从一个变成三个，且**只能由产品侧逐个给全**
 *    （Lab 不许拼产品 URL）。R1-B 的 `back` 因此不再存在，不是被改名。
 * ⚠️ `countBefore` 是产品侧从正式库存里读的**事实**（Lab 读不到存档），
 *    只为让卡片显示 `4 → 5`；它不是权威状态，选中后的真正入库仍由首页那条链路执行。
 */
export const CHOICES_PARAM = 'choices';
/**
 * PRODUCT-LOOP-R1-C｜本局**装备**参数（= 出发那一刻 Player Profile 里那份 `BuildDraft` 的 JSON）。
 *
 * ⚠️ 参数名刻意叫 `loadout`（装备）而不是 `weapon`：传的是**整份 Build**，
 *    不只是武器 —— 若将来某个槽变成可编辑（例如轮组 / 顶部挂点），
 *    这条通道**不需要任何改动**就自然带上新内容（不会退化成「只同步了武器」）。
 */
export const LOADOUT_PARAM = 'equipped';
/**
 * PRODUCT-LOOP-R1-D｜**失败回程地址**参数（= 玩家在局内失败、点「返回主界面」后落到的页面）。
 *
 * ⚠️ 与领奖地址（`choices` 里每条的 `href`）是**两类不同的地址**，这是 Queue 必改 5
 *    在地址层上的保证：
 *   - `choices[i].href` = `buildClaimHref()` = 领奖地址（首页收到它会执行一次幂等入库）
 *     → **只**作为终点 3选1 的选项目标（且 `runProductChoicesNow()` 只在 COMPLETE 产出）；
 *   - `home` = `HOME_HREF`（**纯首页，不带任何领奖参数**）→ 只给 FAILED。
 *   因此局内的失败链**结构上拿不到**领奖地址 ⇒ 「失败也发奖」不可能发生。
 *
 * ⚠️ 刻意与领奖地址分开，而不是让 Lab 侧「把 reward 参数删掉」：
 *    Lab 一旦开始解析 / 裁剪产品地址，就出现了第二份「产品 URL 长什么样」的知识
 *    （正是本模块存在的理由所反对的）。这里给的是**不透明**地址，Lab 只需原样使用。
 */
export const HOME_PARAM = 'home';

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

/**
 * 一次候选选择的**输入**（产品侧库存读数 + 候选件）。
 * ⚠️ `star` / `countBefore` 都是「出发那一刻」的快照：它们是给玩家看的预览，
 *    不是权威状态（真正的入库在首页那条幂等链路上重新读盘再算）。
 */
export interface RewardChoiceSpec {
  readonly defId: string;
  readonly star: number;
  readonly countBefore: number;
}

/** 一条候选的**完整交接**：输入 + 这一件自己的领奖地址（产品侧给全）。 */
export interface RewardChoiceLink extends RewardChoiceSpec {
  readonly href: string;
}

/**
 * 领奖地址：玩家选中某一件后落到的页面（`home.html` + `run` + `reward`）。
 *
 * ⚠️ `defId` **必传**（R2-A 去掉了默认值）：R1-B 时终点只有一件，默认值等于那一件；
 *    现在终点是三选一，再给一个默认值就等于「悄悄替玩家选了一件」
 *    —— 缺参数应当编译不过，而不是静默发错东西。
 */
export function buildClaimHref(runToken: string, defId: string): string {
  const p = new URLSearchParams();
  p.set(RUN_PARAM, runToken);
  p.set(REWARD_PARAM, defId);
  return `${HOME_HREF}?${p.toString()}`;
}

/**
 * 把「候选读数」配上各自的领奖地址（Queue 必改 4 的数据面）。
 *
 * ⚠️ 每条 `href` 都是**独立的**领奖地址，且都指向同一个 `run` token
 *    ⇒ 「本局只能领一次」由首页的幂等账本保证（谁先到谁入账，第二个落 `already-claimed`）。
 * ⚠️ 不在这里过滤候选：候选池的合法性（正式 Weapon / 能装备）由
 *    `tests/productLoopRunReward.test.ts` 用**真实校验器**逐件钉死，
 *    而不是在这里静默丢掉一个选项（丢选项会让玩家少一个选择却不报错）。
 */
export function buildRewardChoiceLinks(
  runToken: string,
  specs: readonly RewardChoiceSpec[],
): readonly RewardChoiceLink[] {
  return specs.map((s) => ({ ...s, href: buildClaimHref(runToken, s.defId) }));
}

/**
 * 交给 Run Page 的**候选载荷**：候选列表 + 「满 stack 阈值」。
 *
 * ⚠️ 阈值必须**一起传**（而不是让 Lab 侧自己写一个 `5`）：Lab 源码白名单读不到
 *    产品成长模块，若在页面里另写一个 5，就出现了第二份「几件算满」的真源 ——
 *    而 Queue B 做合成时这个数字一定会在两处漂移。真源 = `playerGrowth.FUSE_STACK`。
 */
export interface RewardChoicePayload {
  /** 满 stack 阈值（读数的分母：`4/5` 的 5）。 */
  readonly stack: number;
  readonly choices: readonly RewardChoiceLink[];
}

/** 组装载荷（阈值来自产品成长模型，不是本模块自造）。 */
export function buildRewardChoicePayload(
  runToken: string,
  specs: readonly RewardChoiceSpec[],
  stack: number,
): RewardChoicePayload {
  return { stack, choices: buildRewardChoiceLinks(runToken, specs) };
}

/**
 * 「开始冒险」的地址：把本局 token / **3选1 候选载荷** / **本局装备** / 失败回程一并交给 Run Page。
 *
 * ⚠️ `payload` 里每条的 `href` 都由 `buildClaimHref()` 产出，**由产品侧给全**
 *    ⇒ Lab 侧不需要知道「首页叫什么」。嵌套的 `?` / `&` / JSON 里的引号
 *    全部由 `URLSearchParams` 负责转义。
 *
 * ⚠️ PRODUCT-LOOP-R1-D：`home` 也必须给全（= 纯首页地址，不带领奖参数），
 *    它才是玩家局内**失败**后「返回主界面」的落点。候选与失败回程都**无条件**带上 ——
 *    「这一局会不会失败」在出发时是不可知的，因此不能按处境挑一个：
 *    页面拿到的是「成功有哪几个去处 / 失败回哪儿」这些事实。
 *
 * ⚠️ `equippedDraft` 省略 / `null` ⇒ **不加该参数**。
 *    这让「不带装备的链接」在 Lab 侧退化成「固定演示装载」——
 *    研发入口（`dev:run-page`）因此完全不受本 Queue 影响。
 */
export function buildAdventureHref(
  runToken: string,
  payload: RewardChoicePayload,
  equippedDraft?: BuildDraft | null,
): string {
  const p = new URLSearchParams();
  p.set(RUN_PARAM, runToken);
  p.set(CHOICES_PARAM, JSON.stringify(payload));
  if (equippedDraft) p.set(LOADOUT_PARAM, encodeRunLoadout(equippedDraft));
  // 失败回程地址：纯首页（`parsePendingClaim` 会因缺 `reward` 而返回 null ⇒ 绝不入库）
  p.set(HOME_PARAM, HOME_HREF);
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
export function rewardDisplayName(defId: string): string | null {
  return registry.functionals.get(defId)?.name ?? null;
}
