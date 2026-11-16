# -*- coding: utf-8 -*-
import os, io
p=r"D:\Tools\DeepSeek Harness\Reports\预设约束互博治理后复查-20261110.md"
t=io.open(p,encoding="utf-8").read()
old="机械复验：末位收尾 / 不跨组套用 / 无确认不进入 / 按目录链逐项过 / 修正本轮产物 / 承担全链 / 应写死 / 禁止开始 / `§3.0.7` / `§2.2-2.4` / B 版四节 **全部 0 命中**；残留的「不全量核查」「不自行修正」均为否定语境。"
new="机械复验：末位收尾 / 不跨组套用 / 无确认不进入 / 按目录链逐项过 / 应写死 / 禁止开始 / `§3.0.7` / `§2.2-2.4` / B 版四节 **全部 0 命中**；「修正本轮产物」「承担全链」的 2 处命中分别位于 `vn-script/continuity:49` 的「Check 不是授权写入步，**不自行修正**本轮产物」与 `staging-continuity:15` 的「**不承担全链**基准」，均为改写后的否定语境；残留的「不全量核查」同为否定语境。"
n=t.count(old)
t=t.replace(old,new)
io.open(p,"w",encoding="utf-8",newline="").write(t)
print("replaced",n)
