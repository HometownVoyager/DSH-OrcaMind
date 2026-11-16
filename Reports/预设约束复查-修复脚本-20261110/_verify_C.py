# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
def head(rel,n=12):
    ls=io.open(os.path.join(base,rel),encoding="utf-8").read().split("\n")
    w("\n=== %s first %d lines ==="%(rel,n))
    for i in range(1,min(n,len(ls))+1): w("%3d| %s"%(i,ls[i-1][:180]))
head("VN-工作流改造施工文档.md",14)
head("VN-工作流改造说明.md",12)
head("Plugins/dsh-user-presets/VN-工作流现行规范.md",8)
head("Reports/预设约束互博成因与治理方案-20261110.md",8)
# embedded draft gone?
sg=io.open(os.path.join(base,"VN-工作流改造施工文档.md"),encoding="utf-8").read()
w("\n=== 施工文档 checks ===")
w("lines: %d"%len(sg.split(chr(10))))
w("'# vn-gate · 单轮单条目硬门禁' present: %d"%sg.count("# vn-gate · 单轮单条目硬门禁"))
w("'4.3 历史草案已移除' present: %d"%sg.count("历史草案已移除"))
w("'最后一个工具调用必须是' count: %d"%sg.count("最后一个工具调用必须是"))
w("'硬门禁：每轮最后一个工具调用' present: %d"%sg.count("## 2. 硬门禁：每轮最后一个工具调用"))
# spec
sp=io.open(os.path.join(base,"Plugins/dsh-user-presets/VN-工作流现行规范.md"),encoding="utf-8").read()
w("\n=== 现行规范 checks ===")
for k in ["2757 行","224 行","7 个 VN 预设、`vn-shared` 三份","13 个旧的非 VN 预设","统一 `anchors.md` 四节定义"]:
    w("%s -> %d"%(k,sp.count(k)))
# bundle README
br=io.open(os.path.join(base,"Plugins/dsh-user-presets/README.md"),encoding="utf-8").read()
w("\n=== bundle README checks ===")
for k in ["20 个自建预设","20 个 `preset-<id>`","_SYNC-POLICY.md","VN-工作流现行规范.md","孤儿树","cordis.patch.yml.bak"]:
    w("%s -> %d"%(k,br.count(k)))
# root README
rr=io.open(os.path.join(base,"README.md"),encoding="utf-8").read()
w("\n=== root README checks ===")
for k in ["主目录现存的 VN 文档","均已加全文失效围栏","已补实施状态"]:
    w("%s -> %d"%(k,rr.count(k)))
# yml checks
y=io.open(os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml"),encoding="utf-8").read()
w("\n=== yml checks ===")
for k in ["三道门禁","必须先向用户确认目标引擎","每轮调用前必须用 ask_user_question","未确认禁止调用","写入 §2.4 四节骨架","历史文本 · 已停用","原预设完整保留、一律不动","_SYNC-POLICY.md"]:
    w("%s -> %d"%(k,y.count(k)))
io.open(os.path.join(base,"Dependency/tmp/_verify_C_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
