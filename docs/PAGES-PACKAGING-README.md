# 正式 Demo 网页打包与发布前说明（DEMO-FORMAL-PAGES-PACKAGING-R1）

> 本轮只做到**生产可构建 + 本地可静态预览**；对外发布是单独门槛——代码完成 ≠ 已上线 ≠ 真人体验通过。

## 两条入口

### 本地静态预览（现在就能用）

```bash
npm run build:pages        # 产出 dist-pages/：index.html（旧预览）+ home.html + run-page.html
npm run e2e:pages-smoke    # 真实浏览器生产 smoke（11 项断言；自带 /fruits/ 前缀静态服务）
```

手动本地预览（任意静态服务器，**必须挂到 /fruits/ 前缀**，因为构建 base=/fruits/）：

```bash
npx serve dist-pages -l 4173 --rewrite '/fruits/(.*) -> /\$1'   # 或任意等价静态服务器
# 打开 http://127.0.0.1:4173/fruits/home.html
```

### GitHub Pages 候选地址（**尚未部署，仅标注**）

- 旧 Canvas 预览：`https://hubinai.github.io/fruits/`（index.html）
- 正式 Demo 首页：`https://hubinai.github.io/fruits/home.html`（**候选，未上线**）
- 正式 Run 页：`https://hubinai.github.io/fruits/run-page.html`（**候选，未上线**）

## 发布尚欠的人工确认动作（缺一不发）

1. 仓库 Settings → Pages → Source 确认为 "GitHub Actions"（一次性管理员设置）；
2. 由负责人**手动**触发 workflow（Actions → "Pages Preview (Web Canvas Mobile)" → Run workflow）；
   workflow 仍为 `workflow_dispatch` 手动触发，本轮**未**触发、未改 Pages 设置、未部署；
3. 发布后在 `https://hubinai.github.io/fruits/home.html` 真人验收（手机横屏 + 全新存储走完整 Demo）。

## 打包形态

- `vite.pages.config.ts` 多入口：`index`（旧预览，不回归）/ `home` / `runPage`；
  产品循环只依赖这两个相对导航（`runReward.ts:129/131`），Lab 验证页（next-run /
  validation-hub / encounter-lab / content-batch）**刻意不打包**；
- 全部资源 `/fruits/assets/*` 正确前缀；production define 折叠调试句柄
  （`__WX_DEBUG__` / `__E2E_INTERNAL_HANDLE__` = false，smoke P-09 实证四个 window 句柄均 undefined）。
