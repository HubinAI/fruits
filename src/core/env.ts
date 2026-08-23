/**
 * Q31｜Release Config（DEV / TEST / PROD 统一判定）。
 *
 * 设计约束（来自 Release Hardening 验收）：
 * - 仅暴露三态：dev / test / prod；业务层只依赖本模块派生布尔，不直接读 import.meta.env；
 * - DEV：本地开发（vite dev server），全部工具 / 日志可用；
 * - TEST：内部 Release Candidate 构建（vite build --mode test），保留 Scenario /
 *   Runtime Debug Tools / 调试日志 / 对手编辑等 QA 工具，便于真人 RC 验收；
 * - PROD：正式发布构建（vite build），隐藏 Scenario / Runtime Debug Tools、关闭调试日志、
 *   保留必要错误日志（console.error）。
 *
 * 不引入任何第三方 dependency；不使用 import.meta.env.DEV 这类易碎布尔直接散落业务层。
 */

/** 运行时模式三态 */
export type RuntimeMode = 'dev' | 'test' | 'prod';

// 安全读取 Vite 注入的 env（vitest 下 MODE='test'、DEV=true；生产构建 MODE='production'）。
// 用 any 兜底，避免不同环境下 import.meta.env 类型差异导致 tsc 报错。
const envAny = import.meta as unknown as { env?: Record<string, unknown> };
const env = envAny.env ?? {};
const envMode = typeof env.MODE === 'string' ? (env.MODE as string) : undefined;
const envDev = env.DEV === true;

function detectMode(): RuntimeMode {
  if (envMode === 'production') return 'prod';
  if (envMode === 'test') return 'test';
  // 无 MODE 时：Vite 默认 development；显式 DEV 也视为 dev。
  if (envMode === 'development' || envDev) return 'dev';
  // 兜底：未知环境按 dev 处理（保留工具，不静默隐藏）。
  return 'dev';
}

/** 当前运行时模式（整个应用唯一决策点） */
export const RUNTIME_MODE: RuntimeMode = detectMode();

export const IS_DEV: boolean = RUNTIME_MODE === 'dev';
export const IS_TEST: boolean = RUNTIME_MODE === 'test';
export const IS_PROD: boolean = RUNTIME_MODE === 'prod';

/**
 * 开发工具可见性：Scenario / Runtime Debug Tools / 对手编辑 等仅在非 PROD 可见。
 * PROD 对正常玩家隐藏（玩家流程不依赖这些工具）。
 */
export const DEV_TOOLS_VISIBLE: boolean = !IS_PROD;

/**
 * 调试日志开关：dev / test 开启；PROD 关闭（不输出 console.debug 等调试噪声）。
 * 必要错误日志（console.error）不受此开关影响，始终保留。
 */
export const DEBUG_LOG_ENABLED: boolean = !IS_PROD;

/**
 * 埋点开发态：dev / test 输出 console + 内存 sink（可观察、可测）；
 * PROD 默认 no-op（除非后续注入平台 adapter）。
 */
export const ANALYTICS_DEV: boolean = !IS_PROD;

/** 当前 Release 版本号（RC 阶段固定；与三端 SHA 共同作为发布标识） */
export const APP_VERSION: string = '0.8.0-rc';

/** 人类可读的模式标签（供 Badge / 日志） */
export const RUNTIME_MODE_LABEL: string = IS_PROD ? 'PROD' : IS_TEST ? 'TEST' : 'DEV';
