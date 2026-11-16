# -*- coding: utf-8 -*-
import os, io, re
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
def check(rel, bd):
    t=io.open(os.path.join(base,rel),encoding="utf-8").read()
    res=[]
    for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)",t):
        tg=m.group(2).split("#")[0]
        if tg.startswith(("http","mailto:")) or tg=="": continue
        full=os.path.normpath(os.path.join(bd,tg))
        res.append((tg,os.path.exists(full)))
    bad=[x for x,ok in res if not ok]
    w("%s (base=%s): links=%d missing=%d"%(rel,os.path.relpath(bd,base),len(res),len(bad)))
    for b in bad: w("   MISSING %s"%b)
# root-level docs: links relative to workspace root
check("VN-工作流改造施工文档.md", base)
check("VN-工作流改造说明.md", base)
# these use ../ because they were written assuming Reports/ base -- verify
w("\n--- 施工文档 header links (raw) ---")
sg=io.open(os.path.join(base,"VN-工作流改造施工文档.md"),encoding="utf-8").read()
for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)",sg[:1500]): w("  %s -> %s"%(m.group(1),m.group(2)))
w("\n--- 说明 header links (raw) ---")
sm=io.open(os.path.join(base,"VN-工作流改造说明.md"),encoding="utf-8").read()
for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)",sm[:1500]): w("  %s -> %s"%(m.group(1),m.group(2)))
# 现行规范 link
sp=io.open(os.path.join(base,"Plugins/dsh-user-presets/VN-工作流现行规范.md"),encoding="utf-8").read()
w("\n--- 现行规范 links ---")
for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)",sp): w("  %s -> %s"%(m.group(1),m.group(2)))
# N1 other comments: what preset are they in
y=io.open(os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml"),encoding="utf-8").read().split("\n")
w("\n--- 原预设完整保留 comments with owning preset ---")
cur=None
for i,l in enumerate(y,1):
    if l.strip().startswith("- id: preset-"): cur=l.strip()
    if "原预设完整保留" in l: w("  %5d %s | %s"%(i,cur,l.strip()[:90]))
io.open(os.path.join(base,"Dependency/tmp/_check_links2_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
