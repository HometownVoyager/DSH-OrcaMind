# -*- coding: utf-8 -*-
import os, io, glob, re
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s=""): out.append(s)
def rr(p,ranges,label):
    ls=io.open(p,encoding="utf-8").read().split("\n")
    w("\n#### %s (%d lines) ####"%(label,len(ls)))
    seen=set()
    for a,b in ranges:
        for i in range(a,min(b,len(ls))+1):
            if i not in seen: w("%5d| %s"%(i,ls[i-1].rstrip())); seen.add(i)
S=os.path.join(base,"Plugins","dsh-user-presets","skills")
rr(os.path.join(S,"comfyui-work/moss-image-guide/SKILL.md"),[(55,70)],"comfyui guide 55-70")
rr(os.path.join(S,"vn-screenplay/staging-draft-format/SKILL.md"),[(1,5),(30,36)],"staging-draft-format")
rr(os.path.join(S,"vn-asset-list/asset-index-gap-bootstrap/SKILL.md"),[(1,10),(26,32)],"asset-index-gap-bootstrap")
rr(os.path.join(S,"vn-screenplay/staging-acceptance/SKILL.md"),[(30,38),(43,48)],"staging-acceptance")
docs={os.path.basename(p):p for p in glob.glob(os.path.join(base,"*.md"))}
for k,p in docs.items():
    if "施工文档" in k: rr(p,[(2348,2362),(2476,2484)],"shigong 2348-2362/2476-2484")
rr(os.path.join(base,"Plugins","dsh-user-presets","cordis.patch.yml"),[(5089,5097)],"yml 5089-5097")
rep=os.path.join(base,"Reports","预设约束互博成因与治理方案-20261110.md")
rr(rep,[(120,135),(160,213)],"first report 120-135/160-213")
# search-query-craft locations
w("\n#### search-query-craft files ####")
for dp,dn,fn in os.walk(S):
    for f in fn:
        if f=="SKILL.md" and "search-query-craft" in dp:
            w(os.path.relpath(os.path.join(dp,f),S))
# Agentic work in yml
y=io.open(os.path.join(base,"Plugins","dsh-user-presets","cordis.patch.yml"),encoding="utf-8").read().split("\n")
w("\n#### Agentic work / 末位 in yml ####")
for i,l in enumerate(y,1):
    if "Agentic" in l or "自主规划" in l: w("%5d| %s"%(i,l.strip()))
io.open(os.path.join(base,"Dependency/tmp/_scan7_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
