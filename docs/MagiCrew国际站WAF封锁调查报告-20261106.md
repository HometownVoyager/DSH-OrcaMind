# MagiCrew 国际站 WAF 封锁调查报告

> 调查日期：2026-11-05 ~ 11-06 ｜ 触发症状：MagiCrew（国际版）两账号「领取每日登录积分失败：HTTP 405（响应不是 JSON）」+「余额查询失败」双灭
> 结论一句话：**插件 referer 缺失已修（必要非充分）；当前拦截是阿里云 ESA WAF 在服务端持续收紧规则所致，真实 Chrome 浏览器也被拦，客户端已无解**，剩下唯一的共享变量是网络出口 IP（代理节点被拉黑）或站点侧全员误伤。

---

## 1. 症状与背景

- DSH Jet Hub「MagiCrew (国际版) 账号管理」面板：两个账号签到报 `HTTP 405（响应不是 JSON：<!doctypehtml><html lang="zh-cn">…）`，卡片积分列「余额查询失败」。
- 涉及插件：`dsh-providers-hub`（本地 master，修复前 `39316c6` / 0.2.1-rc.2，上游 Gitee `iJetLi/deepseek-harness-codearts`）。
- 端点：`POST /api/v1/login-gift`（每日签到）与 `GET /api/v1/quota/points/total`（余额），API host `magic-service.magicrew.ai`，网页源 `www.magicrew.ai`。
- 对照组：国内站 `i-magic-service.letsmagic.cn` **全程正常**（curl UA 裸 POST 也 200），两站 WAF 行为不同，勿混谈。

## 2. 时间线（WAF 规则三连跳）

| 时间 | 状态 | 依据 |
|---|---|---|
| 11-04 | 上游 PR #176（`e33b119`）补 referer：症状是部分端点 **403 空 body**（`contact/accounts/me/users`、`model-gateway/tokens`），积分/签到端点当时不校验 | 上游提交注释 |
| 11-05 白天 | 本地 cherry-pick PR #176 三提交并重建 lib（commit `031a728`/`f5ac448`/`b94bf51` + 注释提交 `de052dd`）；curl 验证「浏览器 UA + referer」→ 200，判定修复完成 | 当日实测 |
| 11-05 深夜→11-06 | 同一条 curl 命令原样重跑 **405（连发 5 次全拦）**；升级为**显式阻断页**（"your request has been blocked... potential threats" + traceid，阿里云 WAF 规则拦截，非 CDN 方法错）。**真实 Chrome 浏览器带 cookie 也 405** | 11-06 实测 |

## 3. 实测矩阵（11-06，全部经同一代理出口）

| # | 请求方式 | 关键头/条件 | 结果 |
|---|---|---|---|
| 1 | curl POST login-gift | Chrome131 UA + origin + referer（昨日 200 的原命令） | **405** |
| 2 | Node fetch（插件 `magicrewApiHeaders` 生成的头） | Chrome141 UA + referer | 405 |
| 3 | Node `node:https`（HTTP/1.1）GET onboarding | 同上全套 | 405 |
| 4 | Node `node:http2` POST | 插件头 | 405 |
| 5 | Node `node:http2` + Chrome SETTINGS/伪头顺序全模拟 | Chrome131 全套 sec-* 头 | 405 |
| 6 | curl 强制 `--http1.1` + 昨日成功头 | — | 405 |
| 7 | curl acw_tc 两步舞（先拿 Set-Cookie 再带 cookie 重放） | GET/POST 都是 | 405 |
| 8 | curl 全套 Chrome 指纹头（sec-ch-ua 三件 + sec-fetch 三件 + accept-language） | — | 405 |
| 9 | **真实 Chrome（页面源内 fetch，免预检简单请求）** GET/POST + `credentials:'include'` | 浏览器原生 TLS/h2/头/cookie | **405** |
| 10 | 经 Clash 7890 HTTP 入站（区别于 TUN 路径） | — | 405 |
| 11 | `--resolve` 直指真实 IP `47.246.38.187`（绕过 fake-ip 域名规则） | — | 405 |
| 12 | GET `www.magicrew.ai` 与 `/workspace`（主站） | — | **200 存活** |
| 13 | 国内站 `i-magic-service.letsmagic.cn` POST login-gift | curl UA、无 referer | **200** |

补充事实：
- 405 响应头：`Server: ESA`、`via: ens-cache25.l2sg7 / ens-cache21.l2hk12 / ens-cache11.tw8`、`Set-Cookie: acw_tc=...`；真实 IP `47.246.38.187` 属阿里云 ESA 边缘段。
- 405 页面全文特征：`data-spm="a3c0e"`、`<title>405</title>`、尾部 JS 渲染的英文/中文**阻断提示**（"your request has been blocked as it may cause potential threats to the server's security"）+ `traceid`——是阿里云 WAF **规则阻断页**，不是「CDN 不支持 POST」的方法错误页。
- 本机 DNS 为 fake-ip（198.19.x，Clash TUN），所有测试同出口。

## 4. 推理与结论

1. **referer 缺失是真 bug、修复正确且必要**（与上游 PR #176 同源），cherry-pick 保留不回滚。但 11-05 深夜起 WAF 规则继续收紧，「浏览器 UA + referer」不再是充分条件。
2. 排除法：客户端一切可变项（头、UA 版本、协议版本、h2 指纹、cookie、TLS 栈、路由路径）穷尽后仍全灭，而**真实浏览器也中招** ⇒ 判据不在客户端指纹层。
3. 所有测试仅剩两个共享变量：**出口 IP**（所有流量同一代理节点）与**时间**。结合阻断页文案（威胁拦截而非限流）与「主站放行、API 主机全拦」的不对称，最可能：**该代理出口 IP/网段被 magic-service 的 WAF 规则拉黑**（签到接口是刷分重灾区，同节点共享用户触发）；次可能：站点全员误伤的配置事故。
4. **判别实验（未做，留给用户）**：换出口 IP（手机流量/切换 Clash 节点）访问 `https://magic-service.magicrew.ai/api/v1/onboarding/tasks`——回 JSON（`{"code":...}`）＝出口被拉黑，切节点即愈；回同一阻断页＝站点侧事故，只能等。

## 5. 修复状态与遗留

- 本地 master（`de052dd`）＝ 上游 PR #176 三提交 + 11-05 证据注释；lib 已重建，magicrew 单测 283 全绿；web profile junction 指向本目录，重启 DSH 即加载。
- **WAF 放行后的恢复清单**：① DSH 点 Jet Hub 刷新/一键领取积分；② 余额应恢复显示；③ 观察续期（`POST /api/v1/sessions` 同被拦，若封锁跨 12-05 需重新浏览器登录两账号）。
- 遗留关注：上游（Gitee）当日无 magicrew 新提交；若站方规则长期不放宽，可考虑给上游提 issue（附本报告时间线）或推动 CDP 浏览器代发签到的功能路线。
- 自查一行命令（换网络后跑）：
  `curl -sS -o /dev/null -w "%{http_code}\n" "https://magic-service.magicrew.ai/api/v1/onboarding/tasks" -A "Mozilla/5.0" -H "referer: https://www.magicrew.ai/"` → **200/401 类 JSON = 通；405 text/html = 仍被拦**。
