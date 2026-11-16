# -*- coding: utf-8 -*-
import os, io, glob, re
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
y=io.open(os.path.join(base,"Plugins","dsh-user-presets","cordis.patch.yml"),encoding="utf-8").read().split("\n")
# disabled preset ranges
for name,a,b in [("screenplay-writing",2607,2900),("vn-design",3300,3560),("vn-staging",3608,3990)]:
    w("=== %s (%d-%d) Agentic/自主规划/末位 hits ==="%(name,a,b))
    for i in range(a,min(b,len(y))+1):
        l=y[i-1]
        if any(k in l for k in ["Agentic","自主规划","最后一个工具调用","末位","Ask","禁止一轮"]):
            w("%5d| %s"%(i,l.strip()[:180]))
w("\n=== yml prefix persona markers (VN7) ===")
for i,l in enumerate(y,1):
    if l.strip()=="- id: persona" and 4250<i<5700:
        w("%5d| %s"%(i,l.strip()))
w("\n=== yml first VN preset boundary 4255-4275 ===")
for i in range(4255,4276): w("%5d| %s"%(i,y[i-1]))
# shigong embedded draft boundaries
docs={os.path.basename(p):p for p in glob.glob(os.path.join(base,"*.md"))}
for k,p in docs.items():
    if "施工文档" in k:
        ls=io.open(p,encoding="utf-8").read().split("\n")
        w("\n=== %s lines 2348-2360 / 2475-2486 ==="%k)
        for a,b in [(2348,2360),(2475,2486)]:
            for i in range(a,b+1): w("%5d| %s"%(i,ls[i-1][:160]))
        # count ``` lines
        w("--- all ``` fence lines between 2340 and 2500 ---")
        for i in range(2340,2501):
            if ls[i-1].strip().startswith("```"): w("%5d| %s"%(i,ls[i-1][:100]))
# bak files
w("\n=== .bak under Plugins/dsh-user-presets ===")
for dp,dn,fn in os.walk(os.path.join(base,"Plugins","dsh-user-presets")):
    for f in fn:
        if ".bak" in f: w(os.path.relpath(os.path.join(dp,f),base))
# doubled prefix
w("\n=== doubled Plugins/dsh-user-presets paths ===")
for dp,dn,fn in os.walk(os.path.join(base,"Plugins","dsh-user-presets","skills")):
    for f in fn:
        if f.endswith(".md"):
            p=os.path.join(dp,f)
            t=io.open(p,encoding="utf-8").read()
            if "Plugins/dsh-user-presets/Plugins/dsh-user-presets" in t or t.count("Plugins/dsh-user-presets/")>1:
                w("%s count=%d"%(os.path.relpath(p,base),t.count("Plugins/dsh-user-presets/")))
io.open(os.path.join(base,"Dependency/tmp/_scan9_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
