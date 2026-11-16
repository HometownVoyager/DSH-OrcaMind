# -*- coding: utf-8 -*-
import os, io, json, re
root = r"D:\Tools\DeepSeek Harness\Plugins\dsh-user-presets\skills"
out = []
def w(s=""):
    out.append(s)

# Collect all VN stage SKILL.md
vndirs = ["vn-shared","vn-bible","vn-script","vn-screenplay","vn-outline","vn-asset-make","vn-asset-list","vn-game"]
files = []
for d in vndirs:
    base = os.path.join(root, d)
    for dp, dn, fn in os.walk(base):
        for f in fn:
            if f == "SKILL.md":
                files.append(os.path.join(dp, f))
files.sort()
w("TOTAL VN SKILL.md: %d" % len(files))

# patterns of interest
pats = {
 "R2_全量核查": r"全量核查",
 "R2_逐项过": r"逐项过",
 "R2_全链": r"全链",
 "R2_修正本轮产物": r"修正本轮产物",
 "R3_ask收尾": r"ask_user_question\s*收尾|以\s*ask_user_question\s*收尾|ask_user_question.*结束|收尾.*ask_user_question",
 "R3_不跨组套用": r"不跨组套用|不必互斥套用|不互斥套用",
 "R4_无确认不进入": r"无用户明确确认不进入下一轮",
 "R5_硬门写死": r"硬门（应写死）|禁止开始|应写死",
 "R6_代为置已确认": r"代为把.*已确认|代为置|置.*已确认",
 "R7_两组选项": r"两组选项",
 "R8_§2.2": r"§2\.[234]",
 "R8_§3.0.7": r"§3\.0\.7",
 "lasttool": r"最后一个工具调用|末位工具调用|唯一且最后",
 "ask_last": r"ask_user_question",
}
# per-file counts
w("\n===== PER-FILE PATTERN HITS =====")
for fp in files:
    rel = os.path.relpath(fp, root)
    try:
        txt = io.open(fp, encoding="utf-8").read()
    except Exception as e:
        w("ERR %s %s" % (rel, e)); continue
    lines = txt.split("\n")
    hits = []
    for k, p in pats.items():
        c = len(re.findall(p, txt))
        if c:
            hits.append("%s=%d" % (k, c))
    if hits:
        w("%-70s %s" % (rel, " ".join(hits)))

# dump full text of vn-shared trio + key small files
for key in ["vn-shared/vn-gate/SKILL.md","vn-shared/vn-continuity/SKILL.md","vn-shared/vn-spec/SKILL.md","vn-bible/vn-bible-anchors/SKILL.md","vn-bible/vn-bible-bootstrap/SKILL.md","vn-script/continuity/SKILL.md","vn-screenplay/staging-continuity/SKILL.md","vn-screenplay/staging-project-bootstrap/SKILL.md","vn-outline/vn-outline-chapter/SKILL.md"]:
    fp = os.path.join(root, key)
    w("\n\n########## FILE: %s ##########" % key)
    txt = io.open(fp, encoding="utf-8").read()
    for i,l in enumerate(txt.split("\n"),1):
        w("%4d| %s" % (i,l))

io.open(r"D:\Tools\DeepSeek Harness\Dependency/tmp/_scan_fixes_out.txt","w",encoding="utf-8").write("\n".join(out))
print("done", len(out))
