# -*- coding: utf-8 -*-
"""Fix relative link bases in root-level / bundle-level docs."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fix_common import rep, report

SG = "VN-工作流改造施工文档.md"
SM = "VN-工作流改造说明.md"
SPEC = "Plugins/dsh-user-presets/VN-工作流现行规范.md"

# 施工文档 (at workspace root): ../Plugins/... -> Plugins/... ; ../Reports/... -> Reports/...
rep(SG, "../Plugins/dsh-user-presets/VN-工作流现行规范.md",
    "Plugins/dsh-user-presets/VN-工作流现行规范.md", 2)
rep(SG, "../Reports/预设约束互博成因与治理方案-20261110.md",
    "Reports/预设约束互博成因与治理方案-20261110.md", 1)
rep(SG, "../Reports/预设约束互博治理后复查-20261110.md",
    "Reports/预设约束互博治理后复查-20261110.md", 1)

# 改造说明 (at workspace root): same
rep(SM, "../Plugins/dsh-user-presets/VN-工作流现行规范.md",
    "Plugins/dsh-user-presets/VN-工作流现行规范.md", 1)
rep(SM, "../Reports/预设约束互博成因与治理方案-20261110.md",
    "Reports/预设约束互博成因与治理方案-20261110.md", 1)
rep(SM, "../Reports/预设约束互博治理后复查-20261110.md",
    "Reports/预设约束互博治理后复查-20261110.md", 2)

# 现行规范 (at Plugins/dsh-user-presets/): ../Reports -> ../../Reports
rep(SPEC, "../Reports/预设约束互博治理后复查-20261110.md",
    "../../Reports/预设约束互博治理后复查-20261110.md", 1)

report("F_links")
