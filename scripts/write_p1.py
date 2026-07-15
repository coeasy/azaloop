import os
path = "D:/work_code/azaloop/azaloop/docs/competitive-analysis/AzaLoop-18项目深度对比与优化方案-2026-07-14.md"
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as f:
    f.write("test content
")
print("done")