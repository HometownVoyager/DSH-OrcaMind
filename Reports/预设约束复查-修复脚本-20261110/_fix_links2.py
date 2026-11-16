# -*- coding: utf-8 -*-
import os, io
p=r"D:\Tools\DeepSeek Harness\Reports\预设约束互博成因与治理方案-20261110.md"
t=io.open(p,encoding="utf-8").read()
n=t.count("](../预设约束互博治理后复查-20261110.md)")
t=t.replace("](../预设约束互博治理后复查-20261110.md)", "](预设约束互博治理后复查-20261110.md)")
io.open(p,"w",encoding="utf-8",newline="").write(t)
print("fixed",n)
