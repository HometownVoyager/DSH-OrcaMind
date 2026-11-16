# -*- coding: utf-8 -*-
import os, io, re
base=r"D:\Tools\DeepSeek Harness"
rep=os.path.join(base,"Reports","预设约束互博成因与治理方案-20261110.md")
t=io.open(rep,encoding="utf-8").read()
out=[]
for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)", t):
    target=m.group(2)
    # resolve relative to Reports/
    p=target.split("#")[0]
    full=os.path.normpath(os.path.join(base,"Reports",p))
    exists=os.path.exists(full)
    if not exists:
        out.append("MISSING %s -> %s"%(target,full))
w=[]
w.append("total links: %d"%len(re.findall(r"\[([^\]]*)\]\(([^)]+)\)",t)))
w.append("missing targets: %d"%len(out))
for o in out: w.append(o)
# show links that point into Reports/ with ../
w.append("\n--- links starting with ../ pointing to Reports files (should be same-dir) ---")
for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)", t):
    tg=m.group(2)
    if tg.startswith("../") and ("预设约束" in tg or tg.startswith("../Reports")):
        w.append(tg)
io.open(os.path.join(base,"Dependency/tmp/_verify_links_out.txt"),"w",encoding="utf-8").write("\n".join(w))
print("done", len(out))
