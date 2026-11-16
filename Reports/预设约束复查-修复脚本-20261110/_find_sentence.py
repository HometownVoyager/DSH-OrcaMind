# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
t=io.open(os.path.join(base,"Reports","预设约束互博治理后复查-20261110.md"),encoding="utf-8").read()
for i,l in enumerate(t.split("\n"),1):
    if "机械复验" in l or "全部 0 命中" in l:
        print(i, repr(l))
