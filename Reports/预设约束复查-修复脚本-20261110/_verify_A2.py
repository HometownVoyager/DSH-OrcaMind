# -*- coding: utf-8 -*-
import os, io
root=r"D:\Tools\DeepSeek Harness\Plugins\dsh-user-presets\skills"
checks=[("vn-outline/vn-outline-chapter/SKILL.md",40),("vn-outline/vn-outline-endings-flags/SKILL.md",42),("vn-outline/vn-outline-structure/SKILL.md",41),("vn-script/continuity/SKILL.md",49),("vn-screenplay/staging-continuity/SKILL.md",15)]
out=[]
for rel,ln in checks:
    t=io.open(os.path.join(root,rel),encoding="utf-8").read().split("\n")
    out.append("--- %s:%d ---"%(rel,ln))
    out.append(t[ln-1])
io.open(r"D:\Tools\DeepSeek Harness\Dependency/tmp/_verify_A2_out.txt","w",encoding="utf-8").write("\n".join(out))
print("done")
