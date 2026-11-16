# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
def le(p):
    d=io.open(p,"rb").read()
    return "CRLF" if b"\r\n" in d else "LF"
files=[
 "Plugins/dsh-user-presets/cordis.patch.yml",
 "Plugins/dsh-user-presets/README.md",
 "Plugins/dsh-user-presets/VN-工作流现行规范.md",
 "Plugins/dsh-user-presets/skills/vn-shared/vn-gate/SKILL.md",
 "Plugins/dsh-user-presets/skills/vn-script/continuity/SKILL.md",
 "README.md",
 "Reports/预设约束互博成因与治理方案-20261110.md",
 "VN-工作流改造施工文档.md",
 "VN-工作流改造说明.md",
]
for f in files: w("%s -> %s"%(f,le(os.path.join(base,f))))
w("\n---- 数字/定位出现处（限定 8 个文件）----")
check = files[2:3]+files[6:9]+["README.md"]
for rel in dict.fromkeys(check):
    p=os.path.join(base,rel)
    t=io.open(p,encoding="utf-8").read()
    for i,l in enumerate(t.split("\n"),1):
        if any(k in l for k in ["2753","220 行","36 份","39 份","规范本体","唯一真源","不新增任何规则"]):
            w("%s:%d| %s"%(rel,i,l.strip()[:200]))
w("\n---- prompt-writing tree files ----")
pw=os.path.join(base,"Plugins","dsh-user-presets","skills","prompt-writing")
for dp,dn,fn in os.walk(pw):
    for f in sorted(fn):
        w(os.path.relpath(os.path.join(dp,f),base))
w("\n---- compile_prompt.py locations ----")
for dp,dn,fn in os.walk(os.path.join(base,"Plugins","dsh-user-presets","skills","comfyui-work")):
    for f in fn:
        if "compile_prompt" in f:
            w(os.path.relpath(os.path.join(dp,f),base))
io.open(os.path.join(base,"Dependency/tmp/_scan8_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
