# -*- coding: utf-8 -*-
import os, io, re
root = r"D:\Tools\DeepSeek Harness\Plugins\dsh-user-presets\skills"
vndirs = ["vn-shared","vn-bible","vn-script","vn-screenplay","vn-outline","vn-asset-make","vn-asset-list","vn-game"]
files=[]
for d in vndirs:
    for dp,dn,fn in os.walk(os.path.join(root,d)):
        for f in fn:
            if f=="SKILL.md": files.append(os.path.join(dp,f))
files.sort()
out=[]
def w(s=""): out.append(s)
pats = ["以 `ask_user_question` 收尾","ask_user_question` 收尾","并承担全链","全链 Check","硬门","禁止开始","不开始逐场","§3.0.7","§2.2","§2.3","§2.4","代为把 A 区","仅 Stop 步","Stop 步 `ask_user_question`","全量核查","按目录链逐项过","修正本轮产物","不跨组套用","全链","无用户明确确认"]
for fp in files:
    rel=os.path.relpath(fp,root)
    lines=io.open(fp,encoding="utf-8").read().split("\n")
    hit=False
    for i,l in enumerate(lines,1):
        if any(p in l for p in pats):
            if not hit:
                w("\n--- %s ---" % rel); hit=True
            w("%4d| %s" % (i,l.strip()))
io.open(r"D:\Tools\DeepSeek Harness\Dependency/tmp/_scan3_out.txt","w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
