# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
# references to dsh-preset-craft / prompt-writing in docs
cands=["README.md","Plugins/dsh-user-presets/README.md","Plugins/dsh-user-presets/VN-工作流现行规范.md",
       "VN-工作流改造施工文档.md","VN-工作流改造说明.md","Reports/预设约束互博成因与治理方案-20261110.md",
       "Reports/预设约束互博治理后复查-20261110.md"]
for rel in cands:
    p=os.path.join(base,rel)
    if not os.path.exists(p): continue
    for i,l in enumerate(io.open(p,encoding="utf-8").read().split("\n"),1):
        if "dsh-preset-craft" in l or "prompt-writing" in l:
            w("%s:%d| %s"%(rel,i,l.strip()[:250]))
w("\n=== yml §2.x / §3.0.7 / §4.3 refs ===")
y=io.open(os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml"),encoding="utf-8").read().split("\n")
for i,l in enumerate(y,1):
    if any(k in l for k in ["§2.2","§2.3","§2.4","§3.0.7","§4.3"]): w("%5d| %s"%(i,l.strip()[:200]))
w("\n=== §3.0.7 in skills (all) ===")
S=os.path.join(base,"Plugins","dsh-user-presets","skills")
for dp,dn,fn in os.walk(S):
    for f in fn:
        if f.endswith(".md"):
            p=os.path.join(dp,f)
            for i,l in enumerate(io.open(p,encoding="utf-8").read().split("\n"),1):
                if "§3.0.7" in l: w("%s:%d"%(os.path.relpath(p,base),i))
io.open(os.path.join(base,"Dependency/tmp/_scan11_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
