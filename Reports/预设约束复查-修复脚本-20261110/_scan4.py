# -*- coding: utf-8 -*-
import os, io, re, glob
base = r"D:\Tools\DeepSeek Harness"
out=[]
def w(s=""): out.append(s)

def dump_ranges(fp, ranges, label):
    lines=io.open(fp,encoding="utf-8").read().split("\n")
    w("\n######## %s (%d lines) ########" % (label, len(lines)))
    done=set()
    for a,b in ranges:
        for i in range(a, min(b,len(lines))+1):
            if i not in done:
                w("%5d| %s" % (i, lines[i-1])); done.add(i)

fp=os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml")
lines=io.open(fp,encoding="utf-8").read().split("\n")
w("===== YML PRESET ROWS (%d lines) =====" % len(lines))
for i,l in enumerate(lines,1):
    if re.search(r"^\s*-?\s*id:\s*preset-", l) or "disabled: true" in l:
        w("%5d| %s" % (i,l.strip()))
w("\n===== YML customSkillDirs / skills mounts =====")
for i,l in enumerate(lines,1):
    if "customSkillDirs" in l or (l.strip().startswith("- skills/") or l.strip().startswith("- 'skills/") or l.strip().startswith('- "skills/')):
        w("%5d| %s" % (i,l.rstrip()))
w("\n===== YML L330-345 / L5075-5092 / L5500-5535 =====")
for a,b in [(330,345),(5075,5092),(5500,5535)]:
    for i in range(a,min(b,len(lines))+1):
        w("%5d| %s" % (i, lines[i-1]))
w("\n===== YML description lines containing keywords =====")
for i,l in enumerate(lines,1):
    if "description:" in l and any(k in l for k in ["确认","门禁","ask_user","必须先","禁止"]):
        w("%5d| %s" % (i,l.strip()))

skillroot=os.path.join(base,"Plugins/dsh-user-presets/skills")
for rel in ["vn-bible/vn-bible-docx/SKILL.md","vn-bible/vn-bible-brainstorm/SKILL.md","vn-bible/vn-bible-characters/SKILL.md","vn-bible/vn-bible-world/SKILL.md","vn-script/story-bible/SKILL.md","vn-script/character-voice/SKILL.md","vn-script/vn-script-format/SKILL.md","vn-game/game-acceptance/SKILL.md","vn-game/game-engine-skeleton/SKILL.md","vn-game/game-implementation-spec/SKILL.md"]:
    p=os.path.join(skillroot,rel)
    ls=io.open(p,encoding="utf-8").read().split("\n")
    w("\n######## %s (%d lines) ########" % (rel,len(ls)))
    for i,l in enumerate(ls,1):
        if any(k in l for k in ["四节","锚点","已确认","确认","硬门","Stop","§","全链","全量","基准事实","角色与关系","世界观","历史","年龄","称谓","空间拓扑"]):
            w("%5d| %s" % (i,l.strip()))

w("\n===== ALL dangling section refs =====")
for dp,dn,fn in os.walk(skillroot):
    for f in fn:
        if f=="SKILL.md":
            p=os.path.join(dp,f)
            ls=io.open(p,encoding="utf-8").read().split("\n")
            for i,l in enumerate(ls,1):
                if any(k in l for k in ["§3.0.7","§2.2","§2.3","§2.4"]):
                    w("%s:%d| %s" % (os.path.relpath(p,skillroot),i,l.strip()))

w("\n===== spec-common first 12 lines =====")
p=os.path.join(skillroot,"official-docs/spec-common/SKILL.md")
for i,l in enumerate(io.open(p,encoding="utf-8").read().split("\n")[:12],1):
    w("%3d| %s" % (i,l))

# docs via glob (avoid literal CJK in source)
docs = {}
for f in glob.glob(os.path.join(base,"*.md")):
    docs[os.path.basename(f)] = f
w("\n===== ROOT MD FILES =====")
for k in sorted(docs): w(k)
for frag,rng in [("施工文档",(1,14)),("改造说明",(1,14)),("现行规范",(1,75))]:
    for k,p in docs.items():
        if frag in k:
            dump_ranges(p,[rng],"DOC "+k)
for name in ["README.md"]:
    pass
pre = os.path.join(base,"Plugins/dsh-user-presets","README.md")
dump_ranges(pre,[(1,60)],"BUNDLE README")
rootre = os.path.join(base,"README.md")
dump_ranges(rootre,[(50,115),(140,150)],"ROOT README")

io.open(os.path.join(base,"Dependency/tmp/_scan4_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done",len(out))
