# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
for rel in ["Plugins/dsh-user-presets/skills/comfyui-work/moss-image-guide/SKILL.md","Plugins/dsh-user-presets/skills/prompt-writing/dsh-preset-craft/SKILL.md"]:
    p=os.path.join(base,rel)
    ls=io.open(p,encoding="utf-8").read().split("\n")
    w("\n=== %s ==="%rel)
    for i,l in enumerate(ls,1):
        if "Plugins/dsh-user-presets" in l: w("%4d| %s"%(i,l.strip()))
# Also check the exact string from report: "命令拼成双"
# root README 55/99 full
rr=io.open(os.path.join(base,"README.md"),encoding="utf-8").read().split("\n")
w("\n=== root README:99 full ===")
w(rr[98])
w("\n=== root README:55 dsh-user-presets full ===")
w(rr[54])
io.open(os.path.join(base,"Dependency/tmp/_scan10_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
