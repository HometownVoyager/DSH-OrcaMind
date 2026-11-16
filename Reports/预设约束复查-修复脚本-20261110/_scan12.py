# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
def rr(p,a,b,label):
    ls=io.open(p,encoding="utf-8").read().split("\n")
    w("\n#### %s %d-%d ####"%(label,a,b))
    for i in range(a,min(b,len(ls))+1): w("%5d| %s"%(i,ls[i-1].rstrip()))
y=os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml")
rr(y,5083,5105,"yml asset-make desc")
d=os.path.join(base,"VN-工作流改造说明.md")
rr(d,88,100,"shuoming 88-100")
rr(d,160,192,"shuoming 160-192")
s=os.path.join(base,"VN-工作流改造施工文档.md")
rr(s,2360,2402,"shigong 2360-2402")
rr(s,2402,2442,"shigong 2402-2442")
io.open(os.path.join(base,"Dependency/tmp/_scan12_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
