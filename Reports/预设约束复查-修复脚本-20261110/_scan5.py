# -*- coding: utf-8 -*-
import os, io, glob, re
base = r"D:\Tools\DeepSeek Harness"
out=[]
def w(s=""): out.append(s)
def rr(fp, ranges, label):
    ls=io.open(fp,encoding="utf-8").read().split("\n")
    w("\n######## %s (%d lines) ########" % (label,len(ls)))
    seen=set()
    for a,b in ranges:
        for i in range(a,min(b,len(ls))+1):
            if i not in seen:
                w("%5d| %s"%(i,ls[i-1].rstrip())); seen.add(i)

docs={os.path.basename(p):p for p in glob.glob(os.path.join(base,"*.md"))}
for name,rng in [("施工文档",[(1,12),(600,636),(2355,2400),(2440,2485),(2610,2625),(2750,2758)]),("说明",[(1,12),(70,100),(155,195),(218,225)])]:
    for k,p in docs.items():
        if name in k: rr(p,rng,k)

cur=os.path.join(base,"Plugins","dsh-user-presets","VN-工作流现行规范.md")
rr(cur,[(1,80)],"XIANXING FULL")

rep=os.path.join(base,"Reports","预设约束互博成因与治理方案-20261110.md")
ls=io.open(rep,encoding="utf-8").read().split("\n")
w("\n######## FIRST REPORT (%d lines) ########"%len(ls))
w("--- first 40 ---")
for i in range(1,41): w("%4d| %s"%(i,ls[i-1].rstrip()))
links=[]
for i,l in enumerate(ls,1):
    for m in re.finditer(r"\]\(([^)]+)\)", l):
        links.append((i,m.group(1)))
w("--- total links: %d ---"%len(links))
for i,u in links: w("%4d| %s"%(i,u))
w("--- section 6/7/status lines ---")
for i,l in enumerate(ls,1):
    if any(k in l for k in ["## 6","## 7","开放问题","B6","C3","硬红线","拍板","建议","待拍板"]):
        w("%4d| %s"%(i,l.rstrip()))

io.open(os.path.join(base,"Dependency/tmp/_scan5_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
