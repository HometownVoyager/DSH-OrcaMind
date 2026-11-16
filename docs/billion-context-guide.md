# Billion-Context (ACP) 核心机制缺陷深度剖析与避坑指南

> **适用范围**：Billion-Context v0.1.200 ~ v0.1.203+  
> **调查基准**：内核源码 (`dist/index.js`)、宿主适配层 (`dist/agent/dsh-native.js`)、官方配置手册 (`CONFIGURATION.zh-CN.md`)、真实会话日志 (`bili.log`, 9.5MB / 60,184 行)。

---

## 目录
1. [执行摘要与技术矛盾](#一-执行摘要与技术矛盾)
2. [模型与上下文生态现实：为什么 ACP 设计脱节？](#二-模型与上下文生态现实为什么-acp-设计脱节)
   - 2.1 当前上下文梯队：Hy3 (256K) 与 1M 模型（有效 400K~500K）
   - 2.2 Agent“不可不开思考”与 50K 门槛的致命冲突
3. [深度排查一：为什么上下文总是被强行锁死在 10% 以下？](#三-深度排查一为什么上下文总是被强行锁死在-10-以下)
   - 3.1 源码伪自适应计算：`growthFloor=50000` 导致的数学坍塌
   - 3.2 退化折叠（Degenerate Fold）与 0.7%~5% 锯齿波压制
4. [深度排查二：为什么任务耗时显著变长？为什么关键信息频频蒸发？](#四-深度排查二为什么任务耗时显著变长为什么关键信息频频蒸发)
   - 4.1 服务端 KV Cache 毁灭打击：Prompt Cache 归零与 Prefill 延迟暴增
   - 4.2 工具黑名单：`neverPreserveRecentTools` 导致代码与报错秒丢
   - 4.3 Agent“失忆—重复调查”的恶性死循环（5 步变 25 步）
   - 4.4 伪造 User 消息横插打断 Agent 思考执行流
   - 4.5 解压回取（Decompress）的临时文件套娃陷阱
5. [深度排查三：DeepSeek 思考断裂与上游网关的客观真相](#五-深度排查三deepseek-思考断裂与上游网关的客观真相)
   - 5.1 客观归因：WorkBuddy Global / CodeBuddy 上游网关的原生行为
   - 5.2 Billion-Context 在思考断裂中的角色：侦测器还是加害者？
   - 5.3 `compress.reasoning.drop` 与出站重构对思考链的进一步破坏
6. [深度排查四：宿主生态排他性与机制劫持](#六-深度排查四宿主生态排他性与机制劫持)
   - 6.1 运行时篡改并禁用 DSH 原生压缩机制
   - 6.2 官方逃生门的单方面封死
7. [决策矩阵：该用还是该停？](#七-决策矩阵该用还是该停)
8. [停用方案与高级调优参考](#八-停用方案与高级调优参考)
   - 8.1 方案 A（强烈推荐）：无损原生停用（保留依赖，安全下线）
   - 8.2 方案 B（高级调优）：若极端场景必须开启时的抢救性参数

---

## 一、 执行摘要与技术矛盾

Billion-Context（底层基于 ACP - Active Context Pruning 主动上下文剪枝理论）的核心定位是：
> *“在 100K 级小窗口时代，通过激进、多代的文本折叠摘要，实现单会话跨越数月、容纳数十亿 Token 的持续运行。”*

然而，当该插件被引入到以 **深度思考（Thinking/Reasoning Mode）、超长原生上下文（256K ~ 1M）、以及服务端 KV Cache（Prompt Caching）极速加速** 为核心基石的现代 Agent 任务栈时，其设计假设与实际生产环境产生了全方位的激烈冲突：

1. **上下文严重“营养不良”**：内核硬编码了 50,000 Token 的固定步长。在实际有效容量 400K~500K 的主流长窗口下，仅仅消耗了 10% 左右的上下文，就被迫触发 80%~90% 的暴力压缩，使得窗口常年空载闲置在 1%~5%；
2. **任务耗时长、循环失忆**：折叠会重写历史前缀，导致服务端 KV Cache 命中率瞬间归零；加之插件将代码读取与命令执行列入豁免保护黑名单，Agent 陷入“遗忘代码细节 $ightarrow$ 重新读取 $ightarrow$ 再次触发压缩”的低效泥潭；
3. **思考链（Reasoning）兼容脆弱**：在现代 Agent“必开思考”的刚需下，结合第三方网关（如 WorkBuddy Global 等）自身的 tool-call 格式特性，Billion-Context 激进的上下文截断和消息重构加剧了思考链丢失和协议告警。

---

## 二、 模型与上下文生态现实：为什么 ACP 设计脱节？

### 2.1 当前上下文梯队：Hy3 (256K) 与 1M 模型（有效 400K~500K）

当前主流开发者和 Agent 所接入的模型上下文梯队具有高度共性：
* **腾讯混元 Hy3**：原生窗口为 **256K**；
* **DeepSeek-V3 / V4.1 系列、SenseNova 等主力模型**：名义窗口普遍为 **1,000,000（1M）Tokens**；
* **工程实际承载力（满血上下文）**：虽然模型标称 1M，但业界与实测公认，在不发生严重“大海捞针（Needle in a Haystack）”召回率衰减与注意力弥散的前提下，**实际满血有效上下文通常在 400,000 ~ 500,000 Tokens**。

**数学对比悖论**：
* 即使按 **400K~500K 的满血保守上限** 评估，Billion-Context 的固定门槛 **50,000 tokens** 也仅仅占了可用容量的 **10% ~ 12.5%**！
* 换言之，**可用且安全的健康工作区还有 88%~90% 完全处于空闲状态**，Billion-Context 就急不可耐地发起强制压缩，犹如在 16G 物理内存才用到 1.6G 时就疯狂将进程数据交换到虚拟内存磁盘一样荒谬。

---

### 2.2 Agent“不可不开思考”与 50K 门槛的致命冲突

在复杂的代码重构、全栈排错与多文件定位场景中：
* **开思考是 Agent 的立足之本**：现代复杂任务中，模型必须依赖深度推理（Thinking Process）完成逻辑推演、工具编排、边界预判和结果校验，“不开思考的 Agent 无法胜任严肃工程”；
* **思考链本身具有 Token 膨胀性**：一个包含 3~5 步复杂工具调用的复杂轮次，深度思考过程产出的 Reasoning Tokens 很容易达到 3,000 ~ 8,000 tokens；
* **50K 门槛被瞬间打穿**：在开启思考的情况下，会话甚至不需要太多轮对话，仅需正常执行 6~10 个工具调用轮次，未折叠体积便迅速逼近 50,000 tokens；
* **恶性后果**：Agent 刚整理好的推演逻辑框架，瞬间遭遇一次 Degenerate Fold，全部思考轨迹被丢弃或粗暴浓缩，破坏了复杂任务的认知连贯性。

---

## 三、 深度排查一：为什么上下文总是被强行锁死在 10% 以下？

### 3.1 源码伪自适应计算：`growthFloor=50000` 导致的数学坍塌

Billion-Context 宣传其具备“根据模型上下文动态计算增长”的能力。然而深入其核心实现（`dist/index.js`）第 1541488 字符附近的 `resolveAdaptiveGrowth`：

```javascript
function resolveAdaptiveGrowth(modelContextLimit, nudge) {
  if (!modelContextLimit || modelContextLimit <= 0) return nudge.growthFloor;
  return Math.min(nudge.growthCap, Math.max(nudge.growthFloor, Math.round(modelContextLimit * nudge.growthRatio)));
}
```

看似由 `modelContextLimit * growthRatio (5%)` 计算，然而查阅内核默认配置对象 `defaultConfig`：

```javascript
nudge: {
  maxContextLimitPct: 0.75,
  minContextLimitPct: 0.45,
  frequency: 5,
  growthRatio: 0.05,
  growthFloor: 50000,    // 5e4 (5万)
  growthCap: 50000,      // 5e4 (5万)
  minGrowthFloor: 20000,
  minGrowthRatio: 0.45,
  emergencyThresholdPct: 0.95
}
```

**数学坍塌真相**：
当 `growthFloor = 50,000` 且 `growthCap = 50,000` 时：
$$\min(50000, \max(50000, X)) \equiv 50,000$$
**该函数在任何模型、任何上下文窗口配置下，输出恒等于常数 50,000！**

在官方中文手册 `CONFIGURATION.zh-CN.md` 第 246 行中，官方也承认：
> `compress.nudgeGrowthTokens`: *“增长门槛：可折叠片段超出基线增长达到该 token 数才发提醒（**按设计恒定，与窗口大小无关**）。”*

---

### 3.2 退化折叠（Degenerate Fold）与 0.7%~5% 锯齿波压制

在决策函数 `decideNudge` 中，只要未折叠消息 `t1Eff >= 50,000`，立即强行标记 Tier 1 压缩。

从真实运行日志 `bili.log`（Session: `session-0e3983b2`）中的实测记录：
```text
[plugin] [acp-compress-obs] shrink 88% (~51605/58568 tok) foldPoint=m00003 blocks=1 anchor≈2107 tok ... postCtx≈6963
[plugin] [warn: degenerate-fold] covers 88% of the live context (~51605/58568 tok) leaving 1 active block(s), anchor≈2107 tok — the whole prefix rewrites and the prefix cache restarts from scratch on the next request
```

**微观过程复盘**：
1. 会话正常进行至 58,568 tokens（仅占满血 500K 窗口的 **11.7%**，占 1M 窗口的 **5.8%**）；
2. 触发了固定 50K 门槛，向模型强推压缩指令；
3. 模型一次性将第 3 条到第 94 条历史记录合并压缩，**单次削减 88% 的上下文**；
4. 压缩完成后的存活上下文仅剩 **6,963 tokens（仅占满血窗口的 1.4%，总窗口的 0.7%）**。

其结果就是：**上下文容量始终在 0.7% ~ 5% 之间像锯齿一样反复横跳，系统绝不允许它突破 10%**。

---

## 四、 深度排查二：为什么任务耗时显著变长？为什么关键信息频频蒸发？

### 4.1 服务端 KV Cache 毁灭打击：Prompt Cache 归零与 Prefill 延迟暴增

现代主流大模型提供商针对 Agent 的最核心优化是 **Prompt Prefix Caching（前缀 KV 缓存）**：
* 当历史上下文的前缀不变时，服务端直接复用此前计算好的注意力张量，首字响应时间（TTFT）仅需几十毫秒，调用单价大幅降低；
* 然而，Billion-Context 的折叠本质上是**将历史前缀整个物理重写并截短为一段摘要文本**；
* 官方日志的告警清楚点明了这一代价：
  `[warn: degenerate-fold] the whole prefix rewrites and the prefix cache restarts from scratch on the next request`
* 只要发生折叠，服务端的 Prompt Cache **立即 100% 击穿失效**。下一轮请求必须全量重新计算 Prefill，上游算力排队与网络延迟全面爆发。

---

### 4.2 工具黑名单：`neverPreserveRecentTools` 导致代码与报错秒丢

查阅 `dist/index.js`（第 1399835 字符）：
```javascript
var NEVER_PRESERVE_RECENT_TOOLS = ["decompress", "search_context", "read", "bash"];
```

在 Agent 执行任务时，最核心的两个动作就是 **`read`（读取代码/配置文件）** 与 **`bash`（执行命令/构建测试）**。  
Billion-Context 却在底层将这两个工具硬编码列为“**立即可压、绝不予以近期保护**”的黑名单：
* 刚读入的几百行核心源码、复杂数据结构声明；
* 编译器或单元测试刚吐出的带有精确文件路径和报错行号的 StackTrace；
* **只要触发折叠，这些关键信息立即被物理丢弃，蒸发成一句形如“User executed tests and got errors”的粗糙摘要。**

---

### 4.3 Agent“失忆—重复调查”的恶性死循环（5 步变 25 步）

当关键代码和报错被丢弃后，Agent 会发生严重的认知断层：
1. Agent 准备修复 Bug 时，发现上下文中已经没有目标函数的完整声明与入参类型；
2. Agent 被迫再次调用 `read` 重新读取文件；
3. 重新读取的代码再次推高上下文，短时间内再次触碰 50K 门槛；
4. 再次触发压缩，刚读进来的代码又因属于 `neverPreserveRecentTools` 再次被抹除！

原本可以在 3~5 步内完成的代码修补，在反复“失忆—重新摸索—再次失忆”的死循环中被无限拖延至 20~30 步，**不仅成倍增加了执行耗时，而且多轮往返消耗的实际 API Token 远超压缩省下的量**。

---

### 4.4 伪造 User 消息横插打断 Agent 思考执行流

源码 `dist/index.js` 揭示了 Nudge 提醒的下发方式：
```javascript
if (willInjectNudge && turn.nudge) {
  const rendered = renderNudgeText(turn.nudge, prompts, surface?.nudgeSections, "openai");
  rebuiltMessages = [...rebuiltMessages, { role: "user", content: rendered.text }];
}
```
Billion-Context 在请求体尾端伪造了一条 `role: "user"` 的新消息，向模型灌输强指令（*“This is an efficiency nudge... Compress now! Example: compress({...})”*）。  
Agent 正在专注编写代码时，注意力突然被尾部的伪造用户指令打断，被迫中断当前思路去调用 `compress` 工具，徒增不必要的思考轮次与往返耗时。

---

### 4.5 解压回取（Decompress）的临时文件套娃陷阱

Billion-Context 提供了 `decompress` 工具试图挽回信息丢失，但源码 `resolveDecompress` 中存在陷阱：
```javascript
const outPath = body.length > 10000 ? join(tmpdir(), `acp-decompress-${safeBlockId}-${Date.now()}.txt`) : null;
if (outPath) {
  writeFileSync(outPath, body, { encoding: "utf8" });
  return toolOk(`[Block ${blockId} content — ${count} item(s) saved to ${outPath}]`);
}
```
* 若解压出的原始历史大于 10,000 字符，插件**不会直接把文本返给模型**，而是写入本地临时文件（`%TEMP%\acp-decompress-*.txt`），只回传路径；
* 模型看到路径后，必须再调用 `read` 工具去读；
* 而由于 4.2 节所述，`read` 又在 `neverPreserveRecentTools` 黑名单中，下次压缩时再次被丢弃！形成极其低效的“套娃”循环。

---

## 五、 深度排查三：DeepSeek 思考断裂与上游网关的客观真相

在前期排查中，日志里高频出现了数百次如下警告：
```text
[warn] reasoning-pair-violated: N assistant tool-call message(s) lack reasoning_content while N carry it — strict-echo upstreams (DeepSeek thinking mode) will reject the request
```

在此，必须对 **“DeepSeek 思考断裂”** 的真实机理进行严谨、客观的归因划分：

### 5.1 客观归因：WorkBuddy Global / CodeBuddy 上游网关的原生行为

检索 `bili.log` 的网络路由记录发现：
* 会话所接入的上游端点正是 **`https://www.workbuddy.ai/v2/chat/completions`** 以及 **`codebuddy.cn`**；
* **网关层客观现象**：WorkBuddy Global 作为多租户分发和聚合网关，在处理 DeepSeek 思考模型时，**其网关在回传包含 `tool_calls` 的 assistant 帧时，原生就存在剥离或不回传 `reasoning_content` 的行为**；
* **结论**：**思考断裂的源头不是 Billion-Context 凭空制造出来的，而是 WorkBuddy Global 上游网关与客户端之间固有的协议格式现象。**

---

### 5.2 Billion-Context 在思考断裂中的角色：侦测器还是加害者？

既然源头在网关，那么 Billion-Context 扮演了什么角色？
1. **它是高频告警的触发器与侦测器**：
   Billion-Context 内置了针对 DeepSeek 思考协议严格回显规则的校验模块。当它发现网关送过来的工具调用消息缺少 `reasoning_content` 时，每轮请求都记录一条详细警告；
2. **它对思考断裂起到了“雪上加霜”的放大破坏作用**：
   * **默认主动丢弃思考内容**：在官方配置 `compress.reasoning` 中，默认开启 `drop: true`（阈值 2048 字符）。这意味着对于已经产生的长思维链，插件自身也会主动进行丢弃；
   * **折叠时抹去思维上下文**：在进行 88% 的退化折叠时，历史上的所有推理链与心智推演过程被全部抹平，加剧了思考型 Agent 在后续交互中的认知分裂；
   * **请求重构脆弱性**：在重组出站请求时，Billion-Context 的 `CoreMessage` 状态机无法有效缝合上游网关遗留的思考字段缺失，使得请求更容易撞上某些严格校验节点的 400 报错。

---

## 六、 深度排查四：宿主生态排他性与机制劫持

### 6.1 运行时篡改并禁用 DSH 原生压缩机制

在 `dist/agent/dsh-native.js` 以及 `dsh.bundle.patch.yml` 中，Billion-Context 实施了霸道的排他策略：

```javascript
function disableBasicCompaction(rows) {
  return rows.map(row => {
    if (row.name === "@deepseek-ai/dsh-compaction-basic" || row.name === "@deepseek-ai/dsh-command-compact") {
      return { ...row, disabled: true };
    }
    return row;
  });
}
```
Billion-Context 通过 DSH 的 `internal/config` 钩子，**在内存中直接篡改宿主配置，强行将 DSH 官方自带的 `compaction-basic` 与 `command-compact` 设为禁用（disabled: true）**。

---

### 6.2 官方逃生门的单方面封死

查阅官方手册 `CONFIGURATION.zh-CN.md` 第 137 行：
> *“allowDshCompaction 键与 BILI_ALLOW_DSH_COMPACTION 环境变量已不存在——dsh 原生压缩现在在所有线路上被无条件拒绝。”*

Billion-Context 彻底焊死了回退使用宿主原生机制的逃生门。一旦挂载，它就单方面接管所有上下文话语权，而其接管后所执行的，正是那套过时的 50K 暴力折叠逻辑。

---

## 七、 决策矩阵：该用还是该停？

综合上述客观事实，评估矩阵如下：

| 使用场景与软硬件配置 | 推荐策略 | 核心依据 |
| :--- | :---: | :--- |
| **现代大窗口模型（DeepSeek 1M、Gemini 1M/2M）** | 🛑 **坚决停用** | 50K 门槛过早扼杀健康上下文；彻底摧毁服务端 KV Cache，使响应延迟暴增数倍。 |
| **有效容量 400K~500K 的满血上下文场景** | 🛑 **坚决停用** | 仅用 10% 容量就发起 88% 的超大折叠，造成严重的算力与容量闲置。 |
| **开启深度思考（DeepSeek Thinking、Claude Thinking）** | 🛑 **坚决停用** | Agent 必开思考，而激进折叠抹杀思维链；与聚合网关工具调用叠加时协议脆弱。 |
| **复杂工程开发、代码重构、编译排错任务** | 🛑 **坚决停用** | `read` 与 `bash` 输出被立即清空，导致 Agent 陷入“失忆—重新调查”的死循环。 |
| **小窗口模型（32K ~ 64K 旧模型、极度受限的本地小模型）** | ⚠️ *谨慎按需使用* | 物理窗口确实无法承载 50K 以上内容时，折叠可避免报错，但需手工调高保护。 |
| **纯文本闲聊、简单问答、超长无工具对话** | ⚠️ *可考虑使用* | 无代码细节、无命令报错，不敏感于信息丢失，能发挥其多代摘要的理论优势。 |

---

## 八、 停用方案与高级调优参考

### 8.1 方案 A（强烈推荐）：无损原生停用（保留依赖，安全下线）

在 DSH 架构中，最推荐的做法是**“停用挂载，但保留本地依赖文件”**：
1. 打开 Web Profile 配置文件：`~/.dsh/profiles/web/package.json`；
2. 在 `dsh.profile.bundles` 数组中，**移除 `"billion-context"`**；
3. 在 `dependencies` 中，**完整保留 `"billion-context": "^0.1.203"`**。

**收益**：
* 本地依赖文件 100% 完整保留，未删除任何源码；
* DSH 重启后完全不再挂载 ACP 的 5 个工具与提示词；
* DSH 原生机制自动复原，1M/256K 上下文全面释放，服务端 KV Cache 稳定驻留，任务执行速度恢复满血状态。

---

### 8.2 方案 B（高级调优）：若极端场景必须开启时的抢救性参数

如果在某些无 KV Cache 且窗口极小的特殊场景必须开启，**切勿使用默认参数**。必须在 `~/.config/billion-context/billion-context.json` 中写入以下抢救性补丁：

```jsonc
{
  "compress": {
    // 1. 将有效上限设为真实满血窗口的高水位（如 80%）
    "maxContextLimit": "80%",
    
    // 2. 强行打破 50K 固定门槛：根据模型调整（Hy3 256K 设 150000；1M 模型设 350000）
    "nudgeGrowthTokens": 350000,
    
    // 3. 彻底清空工具排除黑名单！让 read 和 bash 享受保护，不再秒丢代码
    "neverPreserveRecentTools": [],
    
    // 4. 大幅提升近期保护轮次与 Token 数量
    "preserveRecentMessages": 20,
    "preserveRecentTokens": 50000,
    
    // 5. 严禁丢弃思考链内容
    "reasoning": {
      "drop": false
    }
  }
}
```
