# -*- coding: utf-8 -*-
import os, io, re
root=r"D:\Tools\DeepSeek Harness\Plugins\dsh-user-presets\skills"
vndirs=["vn-shared","vn-bible","vn-script","vn-screenplay","vn-outline","vn-asset-make","vn-asset-list","vn-game"]
out=[]
def w(s): out.append(s)
checks={
 "R3 末位收尾 (应为0)": r"以\s*`?ask_user_question`?\s*收尾|ask_user_question.*收尾",
 "R7 不跨组套用 (应为0)": r"不跨组套用",
 "R4 无确认不进入 (应为0)": r"无用户明确确认不进入下一轮",
 "R2 按目录链逐项过 (应为0)": r"按目录链逐项过",
 "R2 全量核查 (允许 0 或否定语境)": r"全量核查",
 "R2 修正本轮产物 (应为0)": r"修正本轮产物",
 "R2 承担全链 (应为0)": r"承担全链|全链 Check",
 "R5 硬门应写死 (应为0)": r"应写死",
 "R5 禁止开始 (应为0)": r"禁止开始",
 "R8 悬空 §3.0.7 (应为0)": r"§3\.0\.7",
 "R8 悬空 §2.2/2.3/2.4 (应为0)": r"§2\.[234]",
 "R1 B-scheme 四节 (应为0，除 docx 收录名)": r"① 基准事实与创意核心|② 角色与关系\|身份|③ 世界观与地理\|世界规则|④ 历史·术语·文风\|时间线",
}
for title,pat in checks.items():
    hits=[]
    for d in vndirs:
        for dp,dn,fn in os.walk(os.path.join(root,d)):
            for f in fn:
                if f=="SKILL.md":
                    p=os.path.join(dp,f)
                    t=io.open(p,encoding="utf-8").read()
                    for m in re.finditer(pat,t):
                        ln=t[:m.start()].count("\n")+1
                        hits.append("%s:%d"%(os.path.relpath(p,root),ln))
    w("%-46s %d %s"%(title,len(hits),(" ".join(hits[:6]) if hits else "OK")))
# R1 confirm both A-scheme present in continuity and anchors
w("\n--- R1 A-scheme in vn-continuity ---")
t=io.open(os.path.join(root,"vn-shared/vn-continuity/SKILL.md"),encoding="utf-8").read()
for k in ["① 年龄与生理时间轴矩阵","② 空间拓扑与动线模型","③ 称谓三层解耦网格","④ 核心资产与体态状态机"]:
    w("%s -> %s"%(k,"YES" if k in t else "NO"))
w("\n--- R6 已确认 rule ---")
t=io.open(os.path.join(root,"vn-shared/vn-continuity/SKILL.md"),encoding="utf-8").read()
for i,l in enumerate(t.split("\n"),1):
    if "裁决后" in l or "已确认" in l and "统一判据" in l: w("%3d| %s"%(i,l.strip()[:150]))
io.open(r"D:\Tools\DeepSeek Harness\Dependency/tmp/_verify_A_out.txt","w",encoding="utf-8").write("\n".join(out))
print("done")
