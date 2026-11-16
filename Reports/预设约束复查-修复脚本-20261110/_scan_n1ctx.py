# -*- coding: utf-8 -*-
import os, io
base=r"D:\Tools\DeepSeek Harness"
out=[]
y=io.open(os.path.join(base,"Plugins/dsh-user-presets/cordis.patch.yml"),encoding="utf-8").read().split("\n")
for a,b in [(22,32),(684,694),(1343,1353),(1702,1712),(2951,2961),(332,346)]:
    out.append("=== %d-%d ==="%(a,b))
    for i in range(a,b+1): out.append("%5d| %s"%(i,y[i-1][:200]))
io.open(os.path.join(base,"Dependency/tmp/_scan_n1ctx_out.txt"),"w",encoding="utf-8").write("\n".join(out))
print("done")
