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

w("===== ANCHORS FOUR-SECTION NAMING =====")
markers = {
 "A_年龄": "年龄与生理时间轴矩阵",
 "A_空间": "空间拓扑与动线模型",
 "A_称谓": "称谓三层解耦网格",
 "A_资产": "核心资产与体态状态机",
 "B_基准": "基准事实与创意核心",
 "B_角色": "角色与关系",
 "B_世界": "世界观与地理",
 "B_历史": "历史·术语·文风",
 "四节": "四节",
}
for fp in files:
    rel=os.path.relpath(fp,root)
    t=io.open(fp,encoding="utf-8").read()
    tags=[k for k,v in markers.items() if v in t]
    if tags: w("%-64s %s" % (rel, ",".join(tags)))

w("\n===== EXACT LINES CONTAINING KEY PHRASES (all files) =====")
keys = ["全量核查","逐项过","全链","修正本轮产物","ask_user_question 收尾","不跨组套用","不必互斥套用","无用户明确确认不进入下一轮","应写死","禁止开始","代为把","置「已确认」","§2.2","§2.3","§2.4","§3.0.7","以 ask_user_question 收尾","两组"]
for fp in files:
    rel=os.path.relpath(fp,root)
    lines=io.open(fp,encoding="utf-8").read().split("\n")
    for i,l in enumerate(lines,1):
        if any(k in l for k in keys):
            w("%s:%d| %s" % (rel,i,l.strip()))

io.open(r"D:\Tools\DeepSeek Harness\Dependency/tmp/_scan2_out.txt","w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
