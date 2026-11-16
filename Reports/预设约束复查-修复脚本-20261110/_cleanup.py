# -*- coding: utf-8 -*-
import os, io, shutil, glob
base=r"D:\Tools\DeepSeek Harness"
tmp=os.path.join(base,"Dependency","tmp")
arc=os.path.join(base,"Reports","预设约束复查-修复脚本-20261110")
os.makedirs(arc,exist_ok=True)
keep={"dsh-ops-0.5.1-rollback-20261109","ph-wip-resolved-on-de052dd.patch","__pycache__"}
moved=0
for f in sorted(os.listdir(tmp)):
    p=os.path.join(tmp,f)
    if f in keep: continue
    if os.path.isfile(p) and (f.startswith("_")):
        shutil.copy2(p,os.path.join(arc,f)); moved+=1
# write a README for the archive
readme = """# 2026-11-10 预设约束复查 · 修复脚本与校验日志归档

本目录保存用户授权「全部修复/优化」后执行的静态修复脚本、精确替换日志与校验输出，**仅供复现与审计**，不进启动链路、不是运行时规则。

## 执行顺序

| 脚本 | 作用 | 替换数 |
|---|---|---|
| `_fix_common.py` | 公共 `rep()` 精确替换助手（带出现次数断言） | — |
| `_fix_A_vnskills.py` | P0 R1–R8 + D8：35 份 VN SKILL.md 的运行时真矛盾 | 79 |
| `_fix_B_config.py` | yml description / B6 / N1 / N2 / N5 + 29 份同源副本声明 | 41 |
| `_fix_C_docs.py` | D1–D7：两份历史文档全文失效围栏、删除 §4.3 内嵌 skill 草案、现行规范定位、首轮报告 75 条链接、bundle/root README | 21 |
| `_fix_D_counts.py` | 行数描述符改定性、复查报告 D4/D5 修状态标注 | 8 |
| `_fix_E_status.py` | 复查报告追加 §9「修复实施状态」+ 根 README 索引 | 3 |
| `_fix_F_links.py` | 修正 9 条跨层级相对链接（root / bundle / Reports 三层 base） | 9 |
| `_fix_G_comments.py` | 5 条「原预设完整保留」派生注释加范围澄清 | 5 |
| `_fix_links2.py` / `_fix_sentence.py` | 2 条同目录链接、1 句复验说明的定点修正 | 3 |
| `_final_verify.py` / `_verify_final2.py` / `_yaml2.py` / `_linkaudit.py` 等 | 结构、YAML 解析、frontmatter、链接、残留短语、同步声明的校验输出 | — |

合计约 **169 处精确替换**，全部带断言；校验结论见 `_final_verify_out.txt` / `_verify_final2_out.txt` / `_verify_final2_out.txt`：

- YAML 解析通过：20 个 preset 行、3 个 `disabled: true`、VN7 各挂 `vn-shared` + 本阶段 tree、7 份宪法段 md5 一致；
- P0 残留短语全部 0 命中（2 处「不自行修正 / 不承担全链」为否定语境）；
- 89 条 Markdown 链接 0 悬空；29 份同源副本声明 + `skills/_SYNC-POLICY.md` 就位；
- 所有被改文件保持 LF / UTF-8 / SKILL.md frontmatter 完好。

## 回退

修复前完整快照：`Archive/Plugins/dsh-user-presets-auditfix-20261110/`（174 个文件：yml + 全部 skills + 6 份文档/README）。治理前更早快照：`Archive/Plugins/dsh-user-presets-slim-20261110-slim/`。

## 未做

- 运行时验证（需开新会话 / 重启 DSH）；
- C3 Host 物理门禁（影响所有会话，需单独回归）；
- 物理抽取 `skills/_shared/`（风险大于收益，改用 `vn-gate` §0 真源声明 + `_SYNC-POLICY.md` G6 登记）。
"""
io.open(os.path.join(arc,"README.md"),"w",encoding="utf-8").write(readme)
# now delete temp files (keep only pre-existing 2 + __pycache__)
removed=0
for f in sorted(os.listdir(tmp)):
    p=os.path.join(tmp,f)
    if f in keep: continue
    if os.path.isfile(p):
        os.remove(p); removed+=1
    elif os.path.isdir(p) and f!="__pycache__":
        shutil.rmtree(p); removed+=1
print("archived %d files -> %s ; removed %d temp items"%(moved,arc,removed))
