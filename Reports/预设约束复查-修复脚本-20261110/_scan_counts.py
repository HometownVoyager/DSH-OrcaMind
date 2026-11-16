# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
cands=["README.md","Plugins/dsh-user-presets/README.md","Plugins/dsh-user-presets/VN-工作流现行规范.md",
       "VN-工作流改造施工文档.md","VN-工作流改造说明.md",
       "Reports/预设约束互博成因与治理方案-20261110.md","Reports/预设约束互博治理后复查-20261110.md"]
for rel in cands:
    p=os.path.join(base,rel)
    if not os.path.exists(p): continue
    for i,l in enumerate(io.open(p,encoding="utf-8").read().split("\n"),1):
        if any(k in l for k in ["2757","2753","2637","220 行","224 行","225 行","6178","5699"]):
            w("%s:%d| %s"%(rel,i,l.strip()[:220]))
# actual counts
for rel in ["VN-工作流改造施工文档.md","VN-工作流改造说明.md"]:
    t=io.open(os.path.join(base,rel),encoding="utf-8").read()
    w("\nACTUAL %s: %d lines, %d bytes"%(rel,len(t.split(chr(10))),len(t.encode('utf-8'))))
# check the 5 "原预设完整保留" contexts
y=io.open(os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml"),encoding="utf-8").read().split("\n")
w("\n=== 原预设完整保留 contexts ===")
for i,l in enumerate(y,1):
    if "原预设完整保留" in l: w("%5d| %s"%(i,l.strip()[:160]))
io.open(os.path.join(base,"Dependency/tmp/_scan_counts_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
