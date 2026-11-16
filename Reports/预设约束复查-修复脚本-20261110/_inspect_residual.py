# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
for rel,ln in [("Plugins/dsh-user-presets/skills/vn-script/continuity/SKILL.md",49),
               ("Plugins/dsh-user-presets/skills/vn-screenplay/staging-continuity/SKILL.md",15)]:
    t=io.open(os.path.join(base,rel),encoding="utf-8").read().split("\n")
    w("--- %s:%d ---"%(rel,ln)); w(t[ln-1]); w("")
# check all "原预设完整保留" comments with 2 lines of context to decide if they need N1-style note
y=io.open(os.path.join(base,"Plugins/dsh-user-presets","cordis.patch.yml"),encoding="utf-8").read().split("\n")
w("=== 原预设完整保留 contexts (3 lines each) ===")
for i,l in enumerate(y,1):
    if "原预设完整保留" in l:
        for j in range(i-1,i+2): w("%5d| %s"%(j,y[j-1][:170]))
        w("---")
io.open(os.path.join(base,"Dependency/tmp/_inspect_residual_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
