# 已知问题登记（KNOWN ISSUES）

> 本文件登记已验证但暂不修复/临时降级的问题。登记即冻结：不得在本 Queue 内继续修改对应逻辑。
> 格式：`KNOWN-<AREA>-<SEQ>`，每个问题包含 RC、症状、证据、当前状态、重启条件。

---

## KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01

- **RC**：#3b477f8（F-WX-IOS-COLD-BOOT-PREVIEW-P0，hLimit 软化宽度优先）
- **症状**：iOS 真机彻底结束微信进程后重新进入，首页（Home）车辆可能缺失，Garage 车辆可能缩至极小（用户描述「缩成极小 / 杀进程后返回仍存在」）；切换 Home/Garage 后恢复。
- **证据**：
  - 自动化 previewSolo 单元测试通过（tests/wechatColdBootPreviewP0.test.ts 14/14，R-CB6 高车 21.8%→40.0%）；
  - 真实 Web E2E（dist-e2e + dist-pages）曾测得 Garage 19.79%（Web 端 0-insets 次要取景路径）；
  - iOS 真机仍未通过（2026-09-01 用户真机复证：杀进程后返回车辆仍极小，附视频 RWTemp 已被微信清理）。
- **当前状态**：真人体验未通过，**临时降级**，不阻塞内容铺量。
- **重启条件（后续处理时强制）**：必须以**真实冷启动路径**为门禁（微信进程彻底结束→冷进程重进→首帧→稳定帧），**不能**以 wechatColdBootPreviewP0 单元测试绿灯直接宣布修复。
- **冻结范围**：登记期间不修改 viewport / camera / hLimit / 冷启动逻辑。
