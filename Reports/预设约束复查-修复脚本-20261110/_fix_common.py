# -*- coding: utf-8 -*-
"""Shared helpers for the 2026-11-10 VN audit fix scripts."""
import io, os, sys

BASE = r"D:\Tools\DeepSeek Harness"
SKILLS = os.path.join(BASE, "Plugins", "dsh-user-presets", "skills")
LOG = []


def read(rel):
    with io.open(os.path.join(BASE, rel), encoding="utf-8") as f:
        return f.read()


def write(rel, text):
    with io.open(os.path.join(BASE, rel), "w", encoding="utf-8", newline="") as f:
        f.write(text)


def rep(rel, old, new, count=None, required=True):
    """Exact literal replacement with occurrence-count verification."""
    path = os.path.join(BASE, rel)
    t = io.open(path, encoding="utf-8").read()
    n = t.count(old)
    if required and (count is not None and n != count):
        raise RuntimeError("COUNT FAIL %s: expected %d got %d for %r" % (rel, count, n, old[:40]))
    if required and count is None and n < 1:
        raise RuntimeError("NOT FOUND %s: %r" % (rel, old[:40]))
    if n > 0:
        t2 = t.replace(old, new)
        io.open(path, "w", encoding="utf-8", newline="").write(t2)
        LOG.append((rel, n, old[:50]))
    return n


def note(s):
    LOG.append(("NOTE", s))


def report(label):
    from collections import Counter
    c = Counter()
    for rel, n, s in LOG:
        if rel == "NOTE":
            continue
        c[rel] += n
    out = ["==== %s ====" % label, "total replacements: %d across %d files" % (sum(c.values()), len(c))]
    for rel, n in sorted(c.items()):
        out.append("  %3d  %s" % (n, rel))
    txt = "\n".join(out)
    io.open(os.path.join(BASE, "Dependency/tmp/_fix_%s_log.txt" % label), "w", encoding="utf-8").write(txt)
    print(txt.encode("ascii", "backslashreplace").decode("ascii"))
    return txt
