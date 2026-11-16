# -*- coding: utf-8 -*-
import os, io, re, glob, hashlib
from collections import defaultdict
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s=""): out.append(s)
yml=io.open(os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml"),encoding="utf-8").read()
lines=yml.split("\n")
w("===== prompt-writing references in yml =====")
for i,l in enumerate(lines,1):
    if "prompt-writing" in l: w("%5d| %s"%(i,l.strip()))
w("\n===== all customSkillDirs block contents =====")
for i,l in enumerate(lines,1):
    if "customSkillDirs:" in l:
        w("--- around line %d ---"%i)
        for j in range(i,min(i+8,len(lines))+1):
            w("%5d| %s"%(j,lines[j-1]))
        if "skills/" in "\n".join(lines[i:i+8]): pass

w("\n===== N1/N2/N5 non-VN files =====")
skillroot=os.path.join(base,"Plugins/dsh-user-presets/skills")
for rel in ["genre-fiction/novel-project-bootstrap/SKILL.md","novel-writing/novel-project-bootstrap/SKILL.md"]:
    p=os.path.join(skillroot,rel)
    ls=io.open(p,encoding="utf-8").read().split("\n")
    w("\n--- %s (%d lines) first 22 ---"%(rel,len(ls)))
    for i in range(1,23): w("%4d| %s"%(i,ls[i-1]))
# comfyui path
p=os.path.join(skillroot,"comfyui-work/moss-image-guide/SKILL.md")
ls=io.open(p,encoding="utf-8").read().split("\n")
w("\n--- comfyui moss-image-guide:65 ---")
for i in [63,64,65,66,67]: w("%4d| %s"%(i,ls[i-1]))

# identical groups among non-VN
w("\n===== MD5 duplicate groups (all SKILL.md) =====")
groups=defaultdict(list)
for dp,dn,fn in os.walk(skillroot):
    for f in fn:
        if f=="SKILL.md":
            p=os.path.join(dp,f)
            data=io.open(p,"rb").read()
            groups[hashlib.md5(data).hexdigest()].append(os.path.relpath(p,skillroot))
for h,ps in groups.items():
    if len(ps)>1: w("%s => %s"%(h[:10]," | ".join(ps)))

io.open(os.path.join(base,"Dependency/tmp/_scan6_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
