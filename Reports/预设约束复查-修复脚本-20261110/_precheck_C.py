# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
for rel in ["VN-工作流改造施工文档.md","VN-工作流改造说明.md"]:
    ls=io.open(os.path.join(base,rel),encoding="utf-8").read().split("\n")
    w("=== %s lines 3-9 (index 2:9) ==="%rel)
    for i in range(3,10): w("%3d| %s"%(i,ls[i-1]))
sg=io.open(os.path.join(base,"VN-工作流改造施工文档.md"),encoding="utf-8").read().split("\n")
i43=[i for i,l in enumerate(sg) if l.startswith("### 4.3 ")]
i5=[i for i,l in enumerate(sg) if l.startswith("## 5. 四份 Docx 同步细则")]
w("\n4.3 idx(1-based)=%s ; 5. idx(1-based)=%s ; delta=%d"%([i+1 for i in i43],[i+1 for i in i5],i5[0]-i43[0]))
# B6 row exact
rep=io.open(os.path.join(base,"Reports/预设约束互博成因与治理方案-20261110.md"),encoding="utf-8").read()
w("\nB6 row present: %d"%rep.count("| B6 | 修 `vn-gate/SKILL.md:97-105`"))
w("77 line present: %d"%rep.count("- 「**最后一个工具调用必须是 ask_user_question**」在 `Plugins/dsh-user-presets/` 内共 **77 处**"))
w("§7 header present: %d"%rep.count("## 7. 需要用户拍板的取舍\n"))
# root README 99 exact fragment
rr=io.open(os.path.join(base,"README.md"),encoding="utf-8").read()
w("\nREADME99 fragment: %d"%rr.count("主目录仍在役的 VN 文档：`VN-工作流改造施工文档.md`、`VN-工作流改造说明.md` |"))
# bundle README structure anchor
br=io.open(os.path.join(base,"Plugins/dsh-user-presets/README.md"),encoding="utf-8").read()
w("bundle 注册方式 anchor: %d"%br.count("注册方式：`~/.dsh/profiles/web/package.json`"))
w("bundle 13 preset line: %d"%br.count("这个 bundle 承载 13 个自建预设"))
io.open(os.path.join(base,"Dependency/tmp/_precheck_C_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
