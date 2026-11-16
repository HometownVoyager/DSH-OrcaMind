# -*- coding: utf-8 -*-
import os, io, sys
base=r"D:\Tools\DeepSeek Harness"
out=[]
def w(s): out.append(s)
# --- YAML parse ---
w("=== YAML parse ===")
try:
    import yaml
    class L(yaml.SafeLoader): pass
    L.add_constructor('tag:yaml.org,2002:js', lambda l,n: l.construct_scalar(n))
    with io.open(os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml"),encoding="utf-8") as f:
        d=yaml.load(f,Loader=L)
    w("  parsed OK: top-level %s entries %d"%(type(d).__name__,len(d)))
    rows=[x for x in d if isinstance(x,dict) and x.get('id','').startswith('preset-')]
    w("  preset rows parsed: %d"%len(rows))
    w("  ids: %s"%", ".join(x['id'] for x in rows))
except Exception as e:
    w("  YAML PARSE FAILED: %r"%e)
# --- SKILL.md frontmatter sanity ---
w("\n=== SKILL.md frontmatter (post-note) ===")
for rel in ["genre-fiction/character-voice/SKILL.md","official-docs/spec-common/SKILL.md",
            "paper-writing/spec-common/SKILL.md","prompt-writing/spec-common/SKILL.md",
            "game-design/search-query-craft/SKILL.md"]:
    p=os.path.join(base,"Plugins/dsh-user-presets/skills",rel)
    t=io.open(p,encoding="utf-8").read()
    w("  %-52s starts='---'=%s  note=%d  close='---' at %d"%(rel,t.startswith("---"),t.count("【同源副本】"),t.find("\n---\n",4)))
    # try parse frontmatter
    try:
        import yaml
        fm=t.split("---")[1]
        obj=yaml.safe_load(fm)
        w("      frontmatter keys: %s"%list(obj.keys()))
    except Exception as e:
        w("      frontmatter parse FAILED: %r"%e)
# --- root README table dup check ---
w("\n=== root README doc table ===")
rr=io.open(os.path.join(base,"README.md"),encoding="utf-8").read().split("\n")
for i,l in enumerate(rr,1):
    if "_SYNC-POLICY" in l or "VN-工作流现行规范.md`" in l:
        w("  %4d| %s"%(i,l.strip()[:150]))
# --- backup contents ---
w("\n=== backup ===")
bk=os.path.join(base,"Archive","Plugins","dsh-user-presets-auditfix-20261110")
for dp,dn,fn in os.walk(bk):
    rel=os.path.relpath(dp,bk)
    if rel==".":
        w("  root: %s"%fn)
    elif "skills" in rel and rel.count(os.sep)<=1:
        w("  %s/: %d items"%(rel,len(dn)+len(fn)))
w("  total files in backup: %d"%sum(len(f) for _,_,f in os.walk(bk)))
# --- residual absolute phrases across VN skills (positive check) ---
w("\n=== positive: user-override coverage in VN stage skills ===")
S=os.path.join(base,"Plugins/dsh-user-presets/skills")
for d in ["vn-script","vn-screenplay","vn-outline","vn-bible","vn-asset-list","vn-asset-make","vn-game"]:
    cnt=0; tot=0
    for dp,dn,fn in os.walk(os.path.join(S,d)):
        for f in fn:
            if f=="SKILL.md":
                tot+=1
                t=io.open(os.path.join(dp,f),encoding="utf-8").read()
                if "用户显式指令可覆盖" in t or "用户可显式" in t or "用户已在同一条" in t: cnt+=1
    w("  %-16s %d/%d files mention override/default"% (d,cnt,tot))
io.open(os.path.join(base,"Dependency/tmp/_final_checks_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
