# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
Y=os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml")
y=io.open(Y,encoding="utf-8").read()
checks={
 "A1 game desc": "本预设实行两道确认门：第一轮为规格门，必须先向用户确认目标引擎",
 "A1 三道门禁 tail": "严格遵循统一六目录、目录纪律、三道门禁、单轮单条目七步循环、README 状态机与共用规范前置条件。\"",
 "A2 must": "每轮调用前必须用 ask_user_question 询问用户选择工具",
 "A2 未确认禁止": "并确认参数，未确认禁止调用任何生图工具；后续",
 "§2.4 yml": "写入 §2.4 四节骨架",
 "B6 s1": "- 随后以 Agentic work 的方式自主规划该阶段内的子任务，调用所需技能或工具，产出一份可供用户审阅的草稿，而不是等待用户逐步发出每一个微指令。符合已确认规则的子任务可以自行完成；影响全局一致性的关键决策必须先经用户拍板，缺口处理按「求证与拍板规则」执行。",
 "B6 s2": "- 随后以 Agentic work 的方式自主规划该阶段内的子任务，调用所需技能或工具，产出一份可供用户审阅的草稿，而不是等待用户逐步发出每一个微指令。符合已确认规则的子任务可以自行完成；影响全局一致性的关键决策必须先向用户确认。",
 "B6 s3": "- 随后以 Agentic work 的方式自主规划本轮子任务，调用所需技能或工具，产出一份可供用户审阅的草稿，而不是等待用户逐步发出每一个微指令。符合已确认规则的子任务可以自行完成；影响全局一致性的关键决策与缺口裁决必须先向用户确认。",
 "N1 comment": "          # 共享 `novel-writing` 的 11 个通用写作 skills（novel-project-bootstrap 另有\n          # 「开题类型判定」增补，见该 skill 头部；原预设完整保留、一律不动），\n          # 并沿用其工具行与共性基线 persona，增补 13 个类型 skills——",
}
for k,v in checks.items(): w("%-16s %d"%(k,y.count(v)))
S=os.path.join(base,"Plugins/dsh-user-presets/skills")
w("\n--- frontmatter closing '---\\n\\n' counts ---")
g=[]
for n in ["character-voice","continuity","novel-chapter-writing","novel-outlining","novel-revision","novel-structure","pov-craft","research-materials","story-bible","writing-craft"]:
    g+=["genre-fiction/%s/SKILL.md"%n,"novel-writing/%s/SKILL.md"%n]
g+=["official-docs/spec-common/SKILL.md","paper-writing/spec-common/SKILL.md","prompt-writing/spec-common/SKILL.md","social-issues/spec-common/SKILL.md"]
g+=["game-design/search-query-craft/SKILL.md","official-docs/search-query-craft/SKILL.md","paper-writing/search-query-craft/SKILL.md","prompt-writing/search-query-craft/SKILL.md","social-issues/search-query-craft/SKILL.md"]
bad=[]
for rel in g:
    t=io.open(os.path.join(S,rel),encoding="utf-8").read()
    c=t.count("\n---\n\n")
    if c!=1: bad.append((rel,c))
w("total files: %d, bad frontmatter pattern: %d"%(len(g),len(bad)))
for rel,c in bad: w("  %s -> %d"%(rel,c))
w("\n--- N2 / N5 strings ---")
for rel,key in [("genre-fiction/novel-project-bootstrap/SKILL.md","本文件派生自家族母本 `novel-writing/skills/novel-project-bootstrap/SKILL.md`"),
                ("novel-writing/novel-project-bootstrap/SKILL.md","本文件是家族母本"),
                ("comfyui-work/moss-image-guide/SKILL.md","python Plugins/dsh-user-presets/skills/comfyui-work/moss-image-prompt-enhancer/scripts/compile_prompt.py \\")]:
    t=io.open(os.path.join(S,rel),encoding="utf-8").read()
    w("%s -> %d"%(rel,t.count(key)))
io.open(os.path.join(base,"Dependency/tmp/_precheck_B_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
