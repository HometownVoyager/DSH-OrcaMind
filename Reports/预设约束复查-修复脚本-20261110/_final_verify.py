# -*- coding: utf-8 -*-
"""Final comprehensive validation of the 2026-11-10 VN audit fix."""
import os, io, re, hashlib
from collections import defaultdict
BASE = r"D:\Tools\DeepSeek Harness"
SK = os.path.join(BASE, "Plugins", "dsh-user-presets", "skills")
YML = os.path.join(BASE, "Plugins", "dsh-user-presets", "cordis.patch.yml")
out = []
def w(s="") : out.append(s)
def rd(rel): return io.open(os.path.join(BASE, rel), encoding="utf-8").read()

w("=" * 70)
w("FINAL VALIDATION · 2026-11-10 VN preset audit fix")
w("=" * 70)

# ---------------------------------------------------------------- 1. YAML validity
w("\n[1] YAML structural sanity")
y = rd("Plugins/dsh-user-presets/cordis.patch.yml")
lines = y.split("\n")
preset_rows = [(i, l.strip()) for i, l in enumerate(lines, 1) if re.match(r"^\s*- id: preset-", l)]
disabled = [(i, l.strip()) for i, l in enumerate(lines, 1) if "disabled: true" in l]
w("  preset-* rows: %d (expected 20)" % len(preset_rows))
w("  disabled: true lines: %d" % len(disabled))
w("  VN7 customSkillDirs: check each has 2 dirs (vn-shared + stage)")
vn_ids = ["vn-bible", "vn-outline", "vn-script", "vn-asset-list", "vn-asset-make", "vn-screenplay", "vn-game"]
for vid in vn_ids:
    idx = next(i for i, l in enumerate(lines) if l.strip() == "- id: preset-%s" % vid)
    # find next customSkillDirs
    csd = next(i for i in range(idx, min(idx + 200, len(lines))) if "customSkillDirs:" in lines[i])
    dirs = [lines[j].strip() for j in range(csd + 1, csd + 4) if lines[j].strip().startswith('- "')]
    w("    %-16s -> %s" % (vid, dirs))
# constitution identical?
w("  constitution md5 across 7 VN presets:")
prefixes = []
for i, l in enumerate(lines):
    if l.strip() == "prefix: |":
        block = []
        j = i + 1
        while j < len(lines) and (lines[j].startswith("                ") or lines[j].strip() == ""):
            block.append(lines[j])
            j += 1
        txt = "\n".join(block).strip()
        if "【指令裁决" in txt:
            const = "\n".join([x for x in block if re.match(r"\s+\d\.", x)])
            prefixes.append((i + 1, hashlib.md5(const.encode()).hexdigest()[:10]))
w("    %s" % prefixes)
w("    all identical: %s" % (len(set(h for _, h in prefixes)) == 1))

# ---------------------------------------------------------------- 2. P0 residuals
w("\n[2] P0 runtime-contradiction residuals (VN skill trees only)")
vndirs = ["vn-shared", "vn-bible", "vn-script", "vn-screenplay", "vn-outline", "vn-asset-make", "vn-asset-list", "vn-game"]
files = []
for d in vndirs:
    for dp, dn, fn in os.walk(os.path.join(SK, d)):
        for f in fn:
            if f == "SKILL.md":
                files.append(os.path.join(dp, f))
checks = {
    "末位 ask 收尾": r"以\s*`?ask_user_question`?\s*收尾|ask_user_question.*收尾",
    "不跨组套用": r"不跨组套用",
    "无用户明确确认不进入下一轮": r"无用户明确确认不进入下一轮",
    "按目录链逐项过": r"按目录链逐项过",
    "修正本轮产物": r"修正本轮产物",
    "承担全链 / 全链 Check": r"承担全链|全链 Check",
    "应写死": r"应写死",
    "禁止开始": r"禁止开始",
    "§3.0.7": r"§3\.0\.7",
    "§2.2/§2.3/§2.4": r"§2\.[234]",
    "B 版四节定义": r"① 基准事实与创意核心|④ 历史·术语·文风 \| 时间线",
}
for title, pat in checks.items():
    hits = []
    for p in files:
        t = io.open(p, encoding="utf-8").read()
        for m in re.finditer(pat, t):
            hits.append("%s:%d" % (os.path.relpath(p, SK), t[:m.start()].count("\n") + 1))
    w("  %-30s %d %s" % (title, len(hits), " ".join(hits[:4]) if hits else "OK"))
# positive checks
w("  positive: A-scheme 4 sections in vn-continuity:")
t = rd("Plugins/dsh-user-presets/skills/vn-shared/vn-continuity/SKILL.md")
for k in ["① 年龄与生理时间轴矩阵", "② 空间拓扑与动线模型", "③ 称谓三层解耦网格", "④ 核心资产与体态状态机"]:
    w("    %s -> %s" % (k, "YES" if k in t else "NO"))
w("  positive: user-override on hard gates:")
sc = rd("Plugins/dsh-user-presets/skills/vn-screenplay/staging-acceptance/SKILL.md")
w("    '用户显式指令可覆盖' in staging-acceptance: %d" % sc.count("用户显式指令可覆盖"))

# ---------------------------------------------------------------- 3. yml contradictions
w("\n[3] yml description / config contradictions removed")
for k in ["三道门禁", "必须先向用户确认目标引擎", "每轮调用前必须用 ask_user_question",
          "未确认禁止调用任何生图工具", "写入 §2.4 四节骨架", "原预设完整保留、一律不动",
          "历史文本 · 已停用", "_SYNC-POLICY.md", "默认每轮调用前用 ask_user_question"]:
    w("  %-42s %d" % (k, y.count(k)))

# ---------------------------------------------------------------- 4. docs
w("\n[4] documentation layer")
sg = rd("VN-工作流改造施工文档.md")
sm = rd("VN-工作流改造说明.md")
sp = rd("Plugins/dsh-user-presets/VN-工作流现行规范.md")
w("  施工文档 全文失效围栏: %d ; 内嵌草案标题残留: %d ; 4.3 已移除说明: %d" %
  (sg.count("全文失效围栏"), sg.count("# vn-gate · 单轮单条目硬门禁"), sg.count("历史草案已移除")))
w("  说明 全文失效围栏: %d ; 历史清单标注: %d" % (sm.count("全文失效围栏"), sm.count("历史清单 · 已于 11-07")))
w("  现行规范 定位冲突化解: %d ; 2757/224 硬数字残留: %d" %
  (sp.count("转录为一份人读规范"), (sp.count("2757") + sp.count("224 行"))))
rep = rd("Reports/预设约束互博成因与治理方案-20261110.md")
w("  首轮报告 实施状态补记: %d ; 77 处口径补齐: %d" % (rep.count("实施状态补记"), rep.count("13+36+3+20+2+3=77")))
rep2 = rd("Reports/预设约束互博治理后复查-20261110.md")
w("  复查报告 §9 实施状态: %d" % rep2.count("## 9. 修复实施状态"))
br = rd("Plugins/dsh-user-presets/README.md")
w("  bundle README: 20 个预设=%d ; VN 索引表=%d ; 孤儿树=%d" %
  (br.count("20 个自建预设"), br.count("| `vn-bible` |"), br.count("孤儿树")))
rr = rd("README.md")
w("  根 README: 全文失效围栏=%d ; _SYNC-POLICY 索引=%d ; B6 已补做=%d" %
  (rr.count("均已加全文失效围栏"), rr.count("_SYNC-POLICY.md"), rr.count("B6 已于复查后补做")))

# ---------------------------------------------------------------- 5. links
w("\n[5] Markdown link resolution (first report + key docs)")
def links_in(rel, base_dir):
    t = rd(rel)
    res = []
    for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)", t):
        tg = m.group(2).split("#")[0]
        if tg.startswith(("http", "mailto:")) or tg == "":
            continue
        full = os.path.normpath(os.path.join(base_dir, tg))
        res.append((tg, os.path.exists(full)))
    return res
for rel, bd in [("Reports/预设约束互博成因与治理方案-20261110.md", os.path.join(BASE, "Reports")),
                ("Reports/预设约束互博治理后复查-20261110.md", os.path.join(BASE, "Reports")),
                ("Plugins/dsh-user-presets/VN-工作流现行规范.md", os.path.join(BASE, "Plugins", "dsh-user-presets")),
                ("Plugins/dsh-user-presets/README.md", os.path.join(BASE, "Plugins", "dsh-user-presets")),
                ("VN-工作流改造施工文档.md", BASE),
                ("VN-工作流改造说明.md", BASE)]:
    res = links_in(rel, bd)
    bad = [t for t, ok in res if not ok]
    w("  %-56s links=%3d missing=%d" % (rel.split("/")[-1], len(res), len(bad)))
    for t in bad[:5]:
        w("      MISSING: %s" % t)

# ---------------------------------------------------------------- 6. sync policy + duplicate notes
w("\n[6] sync policy + duplicate-note coverage")
sp_path = os.path.join(SK, "_SYNC-POLICY.md")
w("  _SYNC-POLICY.md exists: %s" % os.path.exists(sp_path))
groups = []
for n in ["character-voice", "continuity", "novel-chapter-writing", "novel-outlining",
          "novel-revision", "novel-structure", "pov-craft", "research-materials",
          "story-bible", "writing-craft"]:
    groups.append(["genre-fiction/%s/SKILL.md" % n, "novel-writing/%s/SKILL.md" % n])
groups.append(["official-docs/spec-common/SKILL.md", "paper-writing/spec-common/SKILL.md",
              "prompt-writing/spec-common/SKILL.md", "social-issues/spec-common/SKILL.md"])
groups.append(["game-design/search-query-craft/SKILL.md", "official-docs/search-query-craft/SKILL.md",
              "paper-writing/search-query-craft/SKILL.md", "prompt-writing/search-query-craft/SKILL.md",
              "social-issues/search-query-craft/SKILL.md"])
noted = 0
for g in groups:
    for rel in g:
        t = io.open(os.path.join(SK, rel), encoding="utf-8").read()
        if "【同源副本】" in t:
            noted += 1
w("  duplicate files with 【同源副本】 note: %d / %d" % (noted, sum(len(g) for g in groups)))
# still byte-identical?
same = 0
for g in groups[:10]:
    a = io.open(os.path.join(SK, g[0]), "rb").read()
    b = io.open(os.path.join(SK, g[1]), "rb").read()
    if a == b: same += 1
w("  genre↔novel pairs byte-identical after note: %d / 10" % same)

# ---------------------------------------------------------------- 7. file integrity
w("\n[7] file integrity spot checks")
for rel in ["Plugins/dsh-user-presets/cordis.patch.yml",
            "Plugins/dsh-user-presets/skills/vn-shared/vn-gate/SKILL.md",
            "Plugins/dsh-user-presets/skills/vn-shared/vn-continuity/SKILL.md",
            "Plugins/dsh-user-presets/skills/vn-shared/vn-spec/SKILL.md",
            "Plugins/dsh-user-presets/skills/vn-bible/vn-bible-bootstrap/SKILL.md",
            "VN-工作流改造施工文档.md", "VN-工作流改造说明.md",
            "Reports/预设约束互博成因与治理方案-20261110.md",
            "Reports/预设约束互博治理后复查-20261110.md"]:
    p = os.path.join(BASE, rel)
    d = io.open(p, "rb").read()
    w("  %-64s %7d B  CRLF=%s  frontmatter-ok=%s" %
      (rel.split("/")[-1], len(d), b"\r\n" in d,
       "n/a" if not rel.endswith("SKILL.md") else d.decode("utf-8").startswith("---")))
# backup
bk = os.path.join(BASE, "Archive", "Plugins", "dsh-user-presets-auditfix-20261110")
w("  backup exists: %s (files: %d)" % (os.path.isdir(bk), len(os.listdir(bk)) if os.path.isdir(bk) else 0))

io.open(os.path.join(BASE, "Dependency/tmp/_final_verify_out.txt"), "w", encoding="utf-8").write("\n".join(out))
print("VALIDATION DONE")
