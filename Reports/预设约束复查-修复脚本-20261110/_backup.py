# -*- coding: utf-8 -*-
import os, shutil, io
base=r"D:\Tools\DeepSeek Harness"
src=os.path.join(base,"Plugins","dsh-user-presets")
dst=os.path.join(base,"Archive","Plugins","dsh-user-presets-auditfix-20261110")
os.makedirs(dst,exist_ok=True)
# copy key editable files
for rel in ["cordis.patch.yml","README.md","VN-工作流现行规范.md","skills"]:
    s=os.path.join(src,rel); d=os.path.join(dst,rel)
    if os.path.isdir(s):
        if os.path.exists(d): shutil.rmtree(d)
        shutil.copytree(s,d)
    else:
        shutil.copy2(s,d)
for rel in ["VN-工作流改造施工文档.md","VN-工作流改造说明.md","README.md","Reports/预设约束互博成因与治理方案-20261110.md"]:
    s=os.path.join(base,rel); d=os.path.join(dst,os.path.basename(rel))
    shutil.copy2(s,d)
io.open(os.path.join(base,"Dependency/tmp/_backup_done.txt"),"w",encoding="utf-8").write(dst)
print("backup ->",dst)
