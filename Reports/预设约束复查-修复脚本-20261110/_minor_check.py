# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
y=io.open(os.path.join(base,"Plugins/dsh-user-presets","cordis.patch.yml"),encoding="utf-8").read().split("\n")
w("=== 必须先向用户确认 hits ===")
for i,l in enumerate(y,1):
    if "必须先向用户确认" in l: w("%5d| %s"%(i,l.strip()[:170]))
w("\n=== bundle README '13 个' / '12 个' contexts ===")
br=io.open(os.path.join(base,"Plugins/dsh-user-presets/README.md"),encoding="utf-8").read().split("\n")
for i,l in enumerate(br,1):
    if "13 个" in l or "12 个" in l: w("%4d| %s"%(i,l.strip()[:200]))
io.open(os.path.join(base,"Dependency/tmp/_minor_check_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
