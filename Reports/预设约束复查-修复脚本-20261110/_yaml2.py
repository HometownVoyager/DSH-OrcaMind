# -*- coding: utf-8 -*-
import os, io, yaml
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
class L(yaml.SafeLoader): pass
L.add_constructor('tag:yaml.org,2002:js', lambda l,n: l.construct_scalar(n))
with io.open(os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml"),encoding="utf-8") as f:
    d=yaml.load(f,Loader=L)
w("top-level type=%s len=%d"%(type(d).__name__,len(d)))
w("first entry keys: %s"%list(d[0].keys()))
inner=d[0].get("insert")
w("insert type=%s len=%d"%(type(inner).__name__,len(inner)))
rows=[x for x in inner if isinstance(x,dict) and str(x.get("id","")).startswith("preset-")]
w("preset rows: %d"%len(rows))
for r in rows:
    w("  %-28s disabled=%s"%(r["id"],r.get("disabled","-")))
# check VN7 customSkillDirs via parsed structure
w("\nVN7 parsed customSkillDirs:")
for r in rows:
    if r["id"].startswith("preset-vn-"):
        cfg=r.get("config",{})
        plugins=cfg.get("plugins",[])
        for p in plugins:
            if p.get("id")=="skill-filesystem":
                dirs=p.get("config",{}).get("customSkillDirs",[])
                w("  %-24s -> %s"%(r["id"],[x.split('/')[-1] for x in dirs]))
# override wording in vn-script
w("\nvn-script R4 wording:")
S=os.path.join(base,"Plugins/dsh-user-presets/skills/vn-script")
for dp,dn,fn in os.walk(S):
    for f in fn:
        if f=="SKILL.md":
            t=io.open(os.path.join(dp,f),encoding="utf-8").read()
            n=t.count("默认逐轮确认后推进")
            if n: w("  %s -> %d"%(os.path.relpath(os.path.join(dp,f),base),n))
io.open(os.path.join(base,"Dependency/tmp/_yaml2_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
