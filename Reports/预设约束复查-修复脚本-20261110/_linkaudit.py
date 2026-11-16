# -*- coding: utf-8 -*-
import os, io, re
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
# each doc: (rel, directory it lives in)
docs=[
 ("README.md", base),
 ("VN-工作流改造施工文档.md", base),
 ("VN-工作流改造说明.md", base),
 ("Plugins/dsh-user-presets/README.md", os.path.join(base,"Plugins/dsh-user-presets")),
 ("Plugins/dsh-user-presets/VN-工作流现行规范.md", os.path.join(base,"Plugins/dsh-user-presets")),
 ("Plugins/dsh-user-presets/skills/_SYNC-POLICY.md", os.path.join(base,"Plugins/dsh-user-presets/skills")),
 ("Reports/预设约束互博成因与治理方案-20261110.md", os.path.join(base,"Reports")),
 ("Reports/预设约束互博治理后复查-20261110.md", os.path.join(base,"Reports")),
]
allbad=[]
for rel,bd in docs:
    t=io.open(os.path.join(base,rel),encoding="utf-8").read()
    res=[]
    for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)",t):
        tg=m.group(2).split("#")[0]
        if tg.startswith(("http","mailto:")) or tg=="": continue
        full=os.path.normpath(os.path.join(bd,tg))
        res.append((tg,os.path.exists(full)))
    bad=[x for x,ok in res if not ok]
    allbad+= [(rel,x) for x in bad]
    w("%-58s links=%2d missing=%d"%(rel,len(res),len(bad)))
    for b in bad: w("     MISSING %s"%b)
w("\nTOTAL missing: %d"%len(allbad))
io.open(os.path.join(base,"Dependency/tmp/_linkaudit_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
