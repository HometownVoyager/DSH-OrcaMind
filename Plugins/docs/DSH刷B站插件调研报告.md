# DSH「刷B站」插件调研报告

> 调研日期：2026-10-27
> 调研人：DSH 团队 lead
> 目标：在众多 DSH B站 插件中，只选 **一个**——GitHub Star 与下载数最多、更新最频繁、最不容易与现有 DSH 版本打架。

---

## 0. 一句话结论

- **综合第一选择：`c1overzz/dsh-bili-scroll`（刷B站）**。它在 **Star、下载量、更新频率** 三项上都是同类第一，也是唯一被官方 DSH 插件市场收录并提供「桌面版安装」入口的同类插件。
- **若把「绝不与 DSH 版本打架」放在第一位**：选 **`InariNGT-Ofiicial/dsh-bili-humanism`**——它是唯一显式声明 engines.dsh >=0.2.1-rc.2 <0.3.0 并在 rc.2/rc.3 上做过 CI 验证的插件；但它的产品定位是「B站内容学习/人格训练」，不是「每天自动刷B站」。
- **若你特别在意桌面版原生行为 + 风控保护**：`Alterssss/dsh-bili-whale` 是强力备选（624★），但不在官方市场、无 npm 下载量、未声明 DSH 版本范围。

> ⚠️ 说明：`kukemc/bili-cli`（265★）**不是 DSH 插件**，而是通用 CLI + MCP + Agent Skills 工具包，可装进 Claude Code/Codex/Cursor/DeepSeek Harness 等 18 个 Agent，因此不参与「DSH 插件」口径的最终评选，仅作对照。

---

## 1. 本机 DSH 环境（实测）

| 项 | 值 |
|---|---|
| DSH 根包 | `@deepseek-ai/dsh-root` **0.2.1-rc.3** |
| `dsh --version` | 0.2.1-rc.3 |
| 形态 | **桌面版 DSH（NEXT / 0.2.x）**，profiles：desktop / web / headless |
| Node | v24.16.0（满足 DSH >=24.9.0 与多数插件 >=18/20/22） |
| Python | 3.12.10 |
| uv | 0.13.4 ✅ |
| **ffmpeg** | **未安装 ❌**（whale / humanism / scroll 的抽帧与 ASR 需要） |

---

## 2. 候选插件总览（GitHub API / npm / PyPI / 官方商店实测）

| 插件 | Star | Fork | 下载量 | 最新版本 | 更新频率 | DSH 版本声明 |
|---|---|---|---|---|---|---|
| **c1overzz/dsh-bili-scroll** | **908** | 97 | npm **26,863**/30天 + Release tgz 2,450 | v2.2.2（10-26） | 13 天约 **17 个版本** | `>=0.1.7-rc.1`（宽松，rc.3 通过） |
| **Alterssss/dsh-bili-whale** | 624 | 61 | 0（不在 npm） | v0.4.6（10-25） | 活跃 | 未声明 |
| kukemc/bili-cli | 265 | 17 | PyPI 约 **4,220/周**（≈1.7万/月） | v1.2.1（10-26） | 活跃 | 非 DSH 插件 |
| InariNGT-Ofiicial/dsh-bili-humanism | 184 | 12 | 0（不在 npm） | v1.11.1（10-26） | 活跃 | **`>=0.2.1-rc.2 <0.3.0`**（唯一显式匹配 rc.3） |
| ssamurias/dsh-fish | 26 | 2 | 54/30天 | v0.6.0（10-27） | 活跃 | 无 |

> 另有多个基于 scroll 的社区分支（如 `ShingStars/dsh-bili-models-legacy`、`holoiallo/dsh-bili-scroll`、`YOYOLnFu/dsh-bili-pond`、`1a125/dsh-bili-chat-whale`、`bronyacccxz/dsh-bilibili-reply` 等），star 均远低于上游，且多与上游共用家目录，**不要与原版同装**。

---

## 3. 逐项标准打分

| 标准 | 胜出者 | 说明 |
|---|---|---|
| ① GitHub Star 最多 | **dsh-bili-scroll（908）** | 第二名 whale 624，其余 <300 |
| ② 下载数最多 | **dsh-bili-scroll（npm 26,863/30天）** | bili-cli PyPI 约 1.7万/月，居第二；scroll 另有 Release tgz 2,450 |
| ③ 更新最频繁 | **dsh-bili-scroll（13 天 17 版）** | whale / bili-cli / humanism 均活跃，但 release 密度不及 |
| ④ 最不易与现有 DSH 打架 | **dsh-bili-humanism（唯一显式兼容 rc.3 + CI）** | scroll 宽松区间可通过但桌面版有已知坑；whale 未声明区间 |

**scroll 四项里赢三项，humanism 只赢一项。** 若按你给的「Star + 下载 + 更新」三个硬指标，scroll 是唯一三项全满的。

---

## 4. 各插件详评

### 4.1 c1overzz/dsh-bili-scroll ｜ 刷B站（推荐 · 综合第一）

- **定位**：每天替你刷一轮 B站——自己搜、**读字幕原文**判断、写 Markdown 日报、值得的留一条评论 **@ 你**。
- **Star/下载/更新**：908★ / 97 fork；npm 30 天 26,863 次；10-14 至 10-26 共约 17 个版本，v2.2.2（10-26）。
- **官方市场**：✅ 被 DSH Plugin Store 收录，并提供 **Desktop Install** 入口。
- **版本兼容**：engines.dsh >=0.1.7-rc.1，本机 rc.3 满足；版本不满足时**内核会静默跳过**（装了像没装）。
- **桌面版已知坑（重要）**：
  1. 0.1.3 及以前在桌面版**装不起来**（optional peer 未安装 → `failed to import`），**0.1.4 起已修**。
  2. 桌面版「自动跑那一轮会卡住」——先用设置页 **「现在跑一轮」手动跑**（稳定）。
  3. 作者自述只在 **npm 0.1.7-rc.x + web profile** 实测过，桌面版靠用户反馈修复。
- **安装前提**：Python 3.10+ 或 uv（本机都有）；可选本地转写（Whisper 538MB，不装约 84MB）。
- **npm 陷阱**：npm 上仍是旧版 0.1.7（发布账号申诉中），**新版本必须走 GitHub Release tgz 或 git**。

### 4.2 Alterssss/dsh-bili-whale（强力备选）

- **定位**：一条「有日子的鱼」，按作息自己醒、真看懂视频、写两本日记、每天最多 @ 你 3 次。
- **Star/下载**：624★ / 61 fork；**不在 npm**，下载量无法统计。
- **版本兼容**：**未声明 engines.dsh**，走 bundle patch；README 明确要求**挂在带网页界面的组件层**（headless 不启动）。
- **桌面适配**：✅ 原生面向桌面，安装命令就是 `--profile desktop`；自带请求保护层（读 3000/天、写 30/天、撞 412 全局暂停）与「疑似 AI 评论」闸。
- **前提**：Node 18+、ffmpeg（**本机缺 ffmpeg**）、需自己填 cookie（或扫码）。
- **未进官方市场**。

### 4.3 InariNGT-Ofiicial/dsh-bili-humanism（最不打架，但定位不同）

- **定位**：用 B站内容训练 DSH 人格，信笺/手账/人格积累；**历史、收藏、点赞、投币默认关闭，不提供评论接口**。
- **版本兼容**：✅ **唯一显式 engines.dsh >=0.2.1-rc.2 <0.3.0**，并在 rc.2/rc.3 上做 Windows/Linux CI 验证；修复了卸载时账本/调度器未释放的问题。
- **安装**：GitHub Releases 下载 .tgz + SHA256SUMS.txt 校验，用桌面版自带 CLI 装；**尚未进推荐市场精选目录**（市场搜索可能装不上）。
- **注意**：它不是「自动刷B站」，更像「B站内容学习 + 人格训练」，每日取稿默认关闭。

### 4.4 kukemc/bili-cli（对照，非 DSH 插件）

- 265★；PyPI 包 `bili-agent`，约 4,220/周下载；80+ 命令、17 个 MCP 工具、18 个 Agent 自动装。
- 面向「AI 当 UP 主」（看、互动、创作、运营），非「DSH 插件」形态。

### 4.5 ssamurias/dsh-fish（社区新人）

- 26★；养一个会自己刷 B站、会成长的 agent，人格非角色扮演；Star/下载/市场收录均弱，暂不具备评选优势。

---

## 5. 风险与坑位汇总

| 风险 | 涉及插件 | 应对 |
|---|---|---|
| 桌面版自动跑卡住 | scroll | 先用「现在跑一轮」手动跑，再观察自动路径 |
| npm 版本滞后 | scroll | 用 GitHub Release tgz 直链或 git，勿用 npm 旧版 |
| 版本不满足被静默跳过 | scroll | 确认 `dsh --version` ≥ 0.1.7-rc.1 |
| 未声明版本区间 | whale | 装前确认本机 DSH 能过 bundle patch |
| 市场精选目录未收录 | humanism | 走 Releases tgz + 桌面自带 CLI |
| 缺 ffmpeg | whale / humanism / scroll(ASR) | 安装 ffmpeg 或仅用字幕路径 |
| 与 scroll 同装冲突 | 各 scroll 分支 | 只装一个，家目录共用 |
| 账号风控 | 全部 | 用小号、保守默认值、勿高频轮询 |

---

## 6. 安装命令对照（供确认后使用）

**dsh-bili-scroll（推荐，桌面 profile）**
```bash
# 首选：Release tgz 直链（最新 v2.2.2）
dsh plugin --profile desktop add https://github.com/c1overzz/dsh-bili-scroll/releases/download/v2.2.2/dsh-bili-scroll-2.2.2.tgz
# 备选：git
dsh plugin --profile desktop add github:c1overzz/dsh-bili-scroll
# 或直接对 DSH 说：「帮我装这个插件 <仓库链接>」
```
装完**必须重启 DSH**，进「设置 → 刷B站」。

**dsh-bili-whale**
```bash
dsh plugin --profile desktop add "link:C:/path/to/dsh-bili-whale"
```
Node 18+、ffmpeg；进「设置 → 养鱼」填 cookie。

**dsh-bili-humanism**
```text
1) Releases 下载 .tgz + SHA256SUMS.txt 并校验 SHA-256
2) 退出 DSH，用桌面版自带 CLI（无需全局 dsh）：
   dsh plugin --profile desktop add <路径/dsh-bili-humanism-x.x.x.tgz>
3) 重开同一 profile，调用 bili_humanism_guide / bili_humanism_status 确认加载
```

**bili-cli（对照，非插件）**
```bash
pip install bili-agent && bili skills install --yes && bili auth login
```

---

## 7. 最终建议

| 你的首要诉求 | 推荐 |
|---|---|
| Star 多 + 下载多 + 更新快 + 官方市场收录 | **dsh-bili-scroll** |
| 绝对不与 DSH 0.2.1-rc.3 打架 | **dsh-bili-humanism** |
| 桌面原生 + 风控保护最细 + 愿意手动装 | **dsh-bili-whale** |

**默认推荐：`dsh-bili-scroll`。** 若安装后在桌面版遇到「自动跑卡住」，按上表用「现在跑一轮」规避即可；若你宁可牺牲功能丰富度也要零冲突，则改选 humanism。

---

## 8. 证据来源

- GitHub 仓库 API：c1overzz/dsh-bili-scroll、Alterssss/dsh-bili-whale、InariNGT-Ofiicial/dsh-bili-humanism、kukemc/bili-cli、ssamurias/dsh-fish
- GitHub Releases：scroll v2.2.2（tgz 下载 2,450）、whale v0.4.6、humanism v1.11.1
- npm registry / npmjs downloads：dsh-bili-scroll 26,863/30天；dsh-fish 54/30天
- PyPI pypistats：bili-agent 4,220/周
- shields.io 徽章：各仓库 Star/Fork
- DSH Plugin Store：dshplugin.store（scroll「Desktop Install」、humanism「Memory Install」；whale/bili-cli 未收录）
- 本机实测：`dsh --version` = 0.2.1-rc.3；node v24.16.0；python 3.12.10；uv 0.13.4；ffmpeg 缺失