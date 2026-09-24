---
name: queue-delivery-gate
description: 《最强水果》项目 Queue（F-XXX-*）的标准交付门禁流水线：定向测试 → tsc → 全量 vitest → 四路构建 → bundle-clean → commit/push → repo-health → RC clean-HEAD → 四路 SHA → memory → 交付报告。当收到 F- 前缀 Queue 指令、需要跑验收门禁、需要核对 local=remote=rc-build=bundle 四路 SHA、需要执行 RC 构建、或需要判断某条 vitest 失败是否属既有基线时使用。
agent_created: true
---

# Queue 交付门禁流水线（最强水果专属）

仓库：`D:\0818new\最强水果`｜主分支：`foundation-02-wechat`｜git 身份：`xiaoyue <xiaoyue@local>`（新会话需重设）

## 0. 纪律前置（违反即失败）

- **先调查后修改**：未以 `file:line` 证据锁定根因前禁止改码。
- **禁 `git stash`**（本环境曾因此丢 refs）。临时补丁备份到仓库外 temp dir。
- Queue 完成后 **stop-and-wait**：单 commit + push，禁顺手扩范围。
- 门禁期间发现的真实缺陷 → **拆独立 Bug Queue**，禁混并当前 scope。
- 三层验收分开表述：①技术正确 ②方案落地 ③**实际体验成立**（1x 速度 + Debug 关）。
  「技术已实现 / 方案已落地 / 真人体验通过」必须分开说，浏览器通过 ≠ 微信模拟器 ≠ iOS 真机。

## 1. 基线核验

```bash
cd "D:/0818new/最强水果"
git rev-parse HEAD                                             # 必须 == Queue 指定 base
git ls-remote --heads origin foundation-02-wechat | cut -f1    # 必须 == local
```

repo-health（**脚本无 CLI main，必须用 node -e 调导出函数**）：

```bash
node -e "
import('./scripts/repo-health.js').then((m)=>{
  const r=m.checkRepoHealth(null, process.cwd());
  console.log('repo-health: '+r.checks.filter(c=>c.ok).length+'/'+r.checks.length+' ok='+r.ok);
  for(const c of r.checks) if(!c.ok) console.log('  ❌ '+c.name+' | '+c.detail);
});
"
```
9 项：worktree / head-resolve / branch-exists / branch-ref-resolve / head-ref-consistency / origin-branch / head-object / tree-object / fsck-connectivity。**必须 9/9**。

## 2. 测试

**所有 vitest 必须带 `--pool`**（不带会 `Cannot read properties of undefined (reading 'config')` 全失败，与代码无关）。

```bash
npx vitest run tests/<targeted>.test.ts --pool=vmForks --maxWorkers=1   # 定向
npx vitest run --pool=vmForks --maxWorkers=1                            # 全量（约 40s，建议后台跑）
npx tsc --noEmit                                                        # 必须 exit 0
```

全量回归**一律 vmForks + maxWorkers=1**（vmThreads 有 fake timers 顺序耦合的偶发超时）。

### 判定「是否新增失败」的正确方法

拿 base commit 原文件跑同一断言对照，不要凭感觉：

```bash
node -e "
const {execSync}=require('child_process');const fs=require('fs');
function probe(l,src){const i=src.indexOf('<锚点字符串>');console.log(l+': '+src.slice(i,i+2600).includes('<期望>'));}
probe('BASE ', execSync('git show <baseSha>:<file>',{encoding:'utf8',maxBuffer:1<<28}));
probe('WORK ', fs.readFileSync('<file>','utf8'));
"
```

**已知基线失败（非回归，勿修）**：
- `garageBuildBoardP0.test.ts` T6 —— 用固定 2600 字符源码切片窗口断言，宿主文件一长必失效；base 原文件同样不成立。
- `platformCore.test.ts` WebLifecycle rAF timeout —— 偶发。

**全量负载超时抖动（先判再修，别当回归）**：vitest 未设 `testTimeout`（默认 5s），`vmForks + maxWorkers=1` 全量跑时个别 canvas/DOM 重型文件会偶发 `Test timed out in 5000ms`（实证：`garageFusionResultInteractionR22.test.ts` 9 处超时）。**判定三步**：① 单跑该文件 —— 绿则排除逻辑问题；② 查该文件 import 面是否与被改动模块有引用路径（无则无因果）；③ 全量重跑 —— 绿即抖动。三步齐了才写「非回归」，否则拆 Bug Queue。

## 3. 四路构建 + bundle-clean

> ⚠️ **先分清 Queue 类型，基线不一样**：
> - **F-WX-\* / 部署 / RC 类** ⇒ 下面这套完整四路构建 + bundle-clean + `build:wechat:rc`（§7）。
> - **PRODUCT-LOOP-\* / PBL-\* / PRP-\* 这类产品侧逻辑 Queue** ⇒ 门禁基线更轻：
>   `tsc --noEmit` + 全量 vitest + **三路** `build` / `build:pages` / `build:wechat`
>   （不跑 `build:e2e`，也不跑 RC —— 那会覆盖 `dist-wechat` 并牵出 §7 那一串补跑）+ 产品 8 条 E2E：
>   `e2e:product-home` / `-reward` / `-star-power` / `-loop` / `-fail` / `-legacy` / `-reseed` / `e2e:default-entry`。
>   实证：R2-A `c40977a` … SINGLE-CTA+AUDIO `c2c1e2c` 连续 6 轮都是这个形状。

```bash
npm run build && npm run build:pages && npm run build:e2e && npm run build:wechat
```

```bash
node scripts/check-wechat-bundle-clean.js dist-wechat/game.js wechat
node scripts/check-wechat-bundle-clean.js dist-wechat/game.js rc
node scripts/check-wechat-bundle-clean.js "dist-e2e/$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist-e2e/index.html | head -1)" e2e
node scripts/check-wechat-bundle-clean.js "dist/$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist/index.html | head -1)" wechat
# PBL Lab 分支额外加一路（入口名与正式不同，别套 index-*）
node scripts/check-wechat-bundle-clean.js "dist-portrait-lab/$(grep -oE 'assets/portrait-lab-[A-Za-z0-9_-]+\.js' dist-portrait-lab/portrait-lab.html | head -1)" wechat
```

> 参数是 **[bundle.js, 模式]**（不是目录 + 模式）。传目录会 `未知构建模式: dist-xxx` 并 exit 2。

模式：`rc|wechat|diag` 禁一切内部句柄；`e2e` allowlist 放行 `__h/__probe/__fx/__inv`。用**精确赋值模式**（`globalThis.__h = `），业务 `dirty` 字段不误报。

> ⚠️ `dist-*` 关闭了 emptyOutDir → 目录里堆着历史 bundle。**必须从 `index.html` 解析当前引用的那个文件名**，别 `grep dist-e2e/assets/*.js` 一把梭。
> ⚠️ 微信包里 `grep seedInventory` 命中的是既有业务函数 `seedInventoryFromStarterAndBuild`，不是 E2E 句柄——别虚警。

## 4. E2E 内部句柄铁律

- 现役分工：`__h`=host、`__probe`=每帧几何、`__fx`=表现层特效注入（`main.ts:452`）、`__inv`=背包库存种子。
- **`__fx` 已被独占**。两处 `globalThis.__fx = { … }` 是**整体赋值不是属性合并** → 后落笔者静默覆盖前者。新能力**必须用新命名空间**。
- 新增句柄必须**同时**：① 包在 `if (typeof __E2E_INTERNAL_HANDLE__ !== 'undefined' && __E2E_INTERNAL_HANDLE__)` 内；② 加进 `scripts/check-wechat-bundle-clean.js` 的 FORBIDDEN **和** E2E allowlist。漏②= 开一条不受门禁管的泄漏通道。
- **「bundle 里 grep 到字符串」≠「运行时句柄可用」**。唯一可靠取证：
  ```js
  page.evaluate(() => Object.keys(window.__X))
  ```

## 5. 浏览器 E2E 实跑

```bash
npm run build:e2e
# 服务器必须常驻：用 Bash 工具的 run_in_background=true
#   cd "D:/0818new/最强水果" && E2E_DIR=e2e node tests/_serve_pages.cjs      → 127.0.0.1:8138
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8138/            # 期望 200
node tests/_e2e_backpack_fusion.cjs
# 跑完显式停掉后台任务（TaskStop）
```

**坑**：`(node server &)` 写在单次 Bash 调用里会随调用结束被回收 → E2E 报 `ERR_CONNECTION_REFUSED`。

浏览器：`chromium.launch({ channel:'msedge' })`，失败回退 bundled chromium。取 canvas 用 `querySelectorAll('canvas')[1] || querySelector('canvas')`（单 canvas 构建下 `[1]` 是 undefined）。

E2E 硬约束：禁 hitArea/`__h`/`__probe`/getImageData 捷径当验收结论；像素基线改动前先记录。

### 读 Canvas 文案 / UI 状态的正道

- 面板真实文案：`page.addInitScript` 劫持 `CanvasRenderingContext2D.prototype.fillText` 记到 `window.__txt`。纯测试侧 instrumentation，app 源码零改动。
- **`button()` disabled → 不注册 hitArea**（drawn 但不调 `this.hit()`）→ 「按钮不可点」可用 `getHitAreasForTest()` 里缺该 id 来硬验证。
- **`metaPage` 是 `CanvasPlayerUIHost` 私有字段，不在 `PlayerUIState`**：`render({ metaPage:'backpack' })` 是**静默 no-op**。进页唯一正确路径 = 真实点击链（如 `home-garage` → `nav:backpack` → `bfilter:*`）。
- `makeStarterDraft()` 默认把 `cannon` 装在 `frontMass` → 需要「N 件全未装备」场景必须用全 `EMPTY_SLOT` 的 bareDraft。
- 战斗内无随机，但匹配层消耗 `Math.random` → 驱动战斗到结束的测试必须 `vi.spyOn(Math,'random').mockReturnValue(0.5)`（带 `!vi.isMockFunction` 防重守卫）。

## 6. Commit / Push

只 stage 业务文件。`.workbuddy/`、`dist*`、`outputs/`、`HANDOFF_`、`交接文档`、`新窗口交接指令`、`_verify`、`最强水果*` 均在 RC IGNORED_PREFIXES，**不要混进业务 commit**。

> ⚠️ **仓库实际约定 = 功能 commit + **紧随其后的一个** memory commit（两次提交）**。
> `git log` 实证（2026-09-24 核对）：近 60 个 commit 里有 9 个 `memory: <QUEUE> 收口记录（…）`，
> 最近**连续 6 轮** Queue 全是这个形状 ——
> `c40977a`+`52f3f6d`（R2-A）· `16a221f`+`2209263`（R2-B）· `9e4e88c`+`c0429c1`（R2-C）·
> `9841274`+`f8effbc`（P0）· `1931a71`+`223a79d`（CTA-LATENCY）· `c2c1e2c`+`c55a285`（SINGLE-CTA+AUDIO）。
>
> - **memory 文件要提交**（这一点不变）—— 别把 memory 当 `dist*` / `outputs/` 一起排除掉；
> - 功能 commit 清单 = `src/** tests/** package.json …`；
>   memory commit 清单 = `.workbuddy/memory/**`（当天 `YYYY-MM-DD.md` + `MEMORY.md` + `REF_*` +
>   `archive/MEMORY_FULL_*.md`），主题用 `memory: <QUEUE> 收口记录（<一句话>）`。
> - `交接文档_*.md` 与 `新窗口交接指令_*.md` 两个都**只在工作区、不入库**（中文名在 `git status`
>   里是八进制转义 ⇒ **必须显式列路径 `git add`**，或用 `git add .` 后 `git reset` 掉它们）。
>
> ⚠️ **本文件旧版写的是「Memory merges into feature commit；禁 standalone memory commit」——
> 与仓库事实相反，已于 2026-09-24 更正。** 那个说法只对更早的 `6aa8238`(PBL-F1) / `2ab32bb`(PBL-F2)
> 成立；R1-A 之后约定就改成两次提交了。

受控前缀（dirty 即拒 RC）：`src/ tests/ scripts/ wechat/ package.json package-lock.json vite. tsconfig`。

```bash
git add <只列业务文件>
git diff --cached --stat
git commit -F - <<'EOF'
<Queue名>: <一句话>
... 分节说明 + 验收数字 + 未验证项 ...
EOF
```

**本环境 ref 落盘不可靠**——commit 后立刻验：

```bash
git rev-parse HEAD; git rev-parse refs/heads/foundation-02-wechat
# 不一致 → 手动写（唯一可靠办法）：
#   printf '%s\n' <full-sha> > .git/refs/heads/foundation-02-wechat
git push origin foundation-02-wechat
```

## 7. RC clean-HEAD + 四路 SHA

```bash
npm run build:wechat:rc      # 内含 repo-health → dirty gate → build → bundle-clean → 三方 SHA
```
必须看到 `dirty=false` + badge `#<sha7>`。**禁用 `--dirty` 作正式 RC。**

```bash
L=$(git rev-parse HEAD)
R=$(git ls-remote --heads origin foundation-02-wechat | cut -f1)
J=$(node -e "console.log(require('./dist-wechat/rc-build.json').fullSha)")
B=$(node -e "const s=require('fs').readFileSync('dist-wechat/game.js','utf8');const m=s.match(/[0-9a-f]{40}/g)||[];console.log(m.find(x=>x===process.argv[1])||'none')" "$L")
printf "LOCAL   %s\nREMOTE  %s\nRC_JSON %s\nBUNDLE  %s\n" "$L" "$R" "$J" "$B"
```

RC 会覆盖 `dist-wechat` → **之后补跑一次 bundle-clean + 依赖该产物的单测**（如读 `dist-wechat/game.js` 的 T39）。

## 8. 收尾（缺一不可）

1. 追加 `.workbuddy/memory/YYYY-MM-DD.md`（**append-only**）：根因 + 门禁数字 + 诚实边界。
2. 长期约定进 `.workbuddy/memory/MEMORY.md`。
3. 交付报告 = 仓库根的 `交接文档_<日期>_<Queue名>.md`（**本地件，不入库**；`新窗口交接指令_*.md` 同）。
   含：RCA 表 / commit SHA / diff stats (+X/-Y) / 四路 SHA / 验收矩阵 / **未达成项诚实披露**。
   ⚠️ 本文件旧版写的是 `outputs/<Queue名>-交付报告.md` —— 与当前实际约定不符（仓库根没有 `outputs/`；
   `.workbuddy/memory/MEMORY.md` 的索引里明确写「各轮交付细节**只在同名交接文档**」）。已于 2026-09-24 更正。
4. `present_files` 呈现报告 + 关键日志。
5. 报告结论必须**分层**：①页面可达 ②数据逻辑 ③浏览器真实闭环 ④**iOS 真机真人体验待验**。
6. 停下等真机回执，不开下一条。

## 9. 微信 iOS 相关必读

Queue 含「微信/iOS/真机/Canvas/DPR/Surface/viewport/点击错位/闪退/前后台/resize」时，**开始前完整读** `.workbuddy/memory/F-WX-IOS-REALDEVICE-DEBUG-PLAYBOOK.md`。
硬规则：DPR 只在 logical→backing 最终绘制时应用**一次**；微信视口同步唯一入口 = `src/platform/wechat/viewportSync.ts` 的 `syncWechatViewport(reason)`，禁任何路径独立改 canvas backing 或调 `runtime.doResize`。

## 10. ★ 新增一个**持久化 key** 时的必查清单（踩过两次）

项目里有一批「**闭集**」守卫钉着「官方 storage 恰好是这几个 key」（语义 = 多一个 / 少一个 / 换个名字都红）。
新增任何一个产品侧 key，**定向用例全绿也一定漏**（那些用例不走这条路径）——必须靠**全量门禁**抓。

实证两次：
- R2-RECOVERY 加 `strongfruit.r2Onboarding.v1` ⇒ 命中 `PG-10` / `PC-10` / `e2e:product-home` 的 `E5`；
- R2-RESEED 加 `strongfruit.r2Reseed.v1` ⇒ **同样命中这三处**（`playerGrowthR2A.test.ts`、
  `productLoopRunReward.test.ts`、`_e2e_product_home.cjs` 的 `EXPECTED_KEYS`）。

改之前先全部 grep 一遍，别只改报错的那一处：
```bash
grep -rn "R2_ONBOARDING_KEY\|allKeys()\|EXPECTED_KEYS" tests/ | grep -v node_modules
```

⚠️ **处置纪律：把白名单 +1，绝不放宽成「至少包含」**。断言必须是
「`length` 相等 **且** 逐位相等」（或 `toEqual([...].sort())`），并在注释里写清
「这是第 N 个 key、闭集语义一字未改、将来再来一个 key 这一条照样红」。
**改成 `toContain` / 删掉 `length` 判断 = 把守卫变成摆设** —— 那是本仓明令禁止的「放宽守卫」。

⚠️ 同理：新增 key 后**「它是不是每次挂载都写」**也要一起想清楚。若某个 key 会被**每次**挂载写入，
「首次打开恰好 N 个 key」这类断言的时间点就会漂移 ⇒ 用 `decided` 式的「只判一次」语义把它钉成一次性
（见 `REF_GUARDS_TRAPS_CONTRACTS.md` §14g 那个真实丢档 bug）。
