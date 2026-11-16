# -*- coding: utf-8 -*-
import os, io, re, glob
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
# 1. historical docs: present-tense hard commands still present but must be inside fence
w("=== historical docs: hard-command counts (should be fenced, not removed) ===")
for rel in ["VN-工作流改造施工文档.md","VN-工作流改造说明.md"]:
    t=io.open(os.path.join(base,rel),encoding="utf-8").read()
    w("  %s:"%rel)
    w("    全文失效围栏=%d  最后一个工具调用必须是=%d  一律=%d  禁止=%d"%(
        t.count("全文失效围栏"),t.count("最后一个工具调用必须是"),t.count("一律"),t.count("禁止")))
    # check the fence is at top and covers the doc
    ls=t.split("\n")
    w("    fence at line: %s"%[i+1 for i,l in enumerate(ls[:15]) if "全文失效围栏" in l])
# 2. all P0 residuals (final, with negation classification)
w("\n=== P0 residuals final ===")
S=os.path.join(base,"Plugins/dsh-user-presets/skills")
vn=[]
for d in ["vn-shared","vn-bible","vn-script","vn-screenplay","vn-outline","vn-asset-make","vn-asset-list","vn-game"]:
    for dp,dn,fn in os.walk(os.path.join(S,d)):
        for f in fn:
            if f=="SKILL.md": vn.append(os.path.join(dp,f))
for pat in ["以 `ask_user_question` 收尾","不跨组套用","无用户明确确认不进入下一轮","按目录链逐项过","应写死","禁止开始","§3.0.7","§2.2","§2.3","§2.4","① 基准事实与创意核心"]:
    hits=[]
    for p in vn:
        t=io.open(p,encoding="utf-8").read()
        if pat in t: hits.append(os.path.relpath(p,S))
    w("  %-34s %d %s"%(pat,len(hits)," ".join(hits[:2]) if hits else "OK"))
# 3. config contradictions
y=io.open(os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml"),encoding="utf-8").read()
w("\n=== yml forbidden absolutes ===")
for k in ["三道门禁","必须先向用户确认","每轮调用前必须用","未确认禁止调用","原预设完整保留、一律不动","写入 §2.4"]:
    w("  %-34s %d"%(k,y.count(k)))
w("  (new) 历史文本 · 已停用=%d ; _SYNC-POLICY=%d"%(y.count("历史文本 · 已停用"),y.count("_SYNC-POLICY.md")))
# 4. links
w("\n=== link audit ===")
# reuse
exec(open(os.path.join(base,"Dependency/tmp/_linkaudit.py"),encoding="utf-8").read().replace("out=[]","out=[]").replace("def w(s): out.append(s)","def w(s): pass"),globals()) if False else None
# manual
docs=[("README.md",base),("VN-工作流改造施工文档.md",base),("VN-工作流改造说明.md",base),
 ("Plugins/dsh-user-presets/README.md",os.path.join(base,"Plugins/dsh-user-presets")),
 ("Plugins/dsh-user-presets/VN-工作流现行规范.md",os.path.join(base,"Plugins/dsh-user-presets")),
 ("Plugins/dsh-user-presets/skills/_SYNC-POLICY.md",os.path.join(base,"Plugins/dsh-user-presets/skills")),
 ("Reports/预设约束互博成因与治理方案-20261110.md",os.path.join(base,"Reports")),
 ("Reports/预设约束互博治理后复查-20261110.md",os.path.join(base,"Reports"))]
tot=0;bad=0
for rel,bd in docs:
    t=io.open(os.path.join(base,rel),encoding="utf-8").read()
    for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)",t):
        tg=m.group(2).split("#")[0]
        if tg.startswith(("http","mailto:")) or tg=="":continue
        tot+=1
        if not os.path.exists(os.path.normpath(os.path.join(bd,tg))): bad+=1
w("  total=%d missing=%d"%(tot,bad))
# 5. sync notes
w("\n=== sync notes ===")
cnt=0
for dp,dn,fn in os.walk(S):
    for f in fn:
        if f=="SKILL.md" and "【同源副本】" in io.open(os.path.join(dp,f),encoding="utf-8").read():
            cnt+=1
w("  SKILL.md with 【同源副本】 note: %d"%cnt)
w("  _SYNC-POLICY.md: %s"%os.path.exists(os.path.join(S,"_SYNC-POLICY.md")))
# 6. doc status
w("\n=== doc status ===")
sp=io.open(os.path.join(base,"Plugins/dsh-user-presets/VN-工作流现行规范.md"),encoding="utf-8").read()
br=io.open(os.path.join(base,"Plugins/dsh-user-presets/README.md"),encoding="utf-8").read()
rr=io.open(os.path.join(base,"README.md"),encoding="utf-8").read()
rep2=io.open(os.path.join(base,"Reports/预设约束互博治理后复查-20261110.md"),encoding="utf-8").read()
w("  现行规范 2757/224 残留: %d ; 转录定位: %d"%(sp.count("2757")+sp.count("224 行"),sp.count("转录为一份人读规范")))
w("  bundle README 13 个预设/12 个: %d ; 20 个: %d"%(br.count("13 个自建预设")+br.count("13 个 `preset-")+br.count("12 个 preset"),br.count("20 个")))
w("  root README 仍在役: %d ; _SYNC-POLICY 索引: %d"%(rr.count("仍在役的 VN 文档"),rr.count("_SYNC-POLICY.md")))
w("  复查报告 §9: %d ; 正确复验说明: %d"%(rep2.count("## 9. 修复实施状态"),rep2.count("均为改写后的否定语境")))
io.open(os.path.join(base,"Dependency/tmp/_verify_final2_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
