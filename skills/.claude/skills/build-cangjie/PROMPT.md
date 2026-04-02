## 仓颉项目构建（build-cangjie 技能）

**⚠️ 触发关键词：**
cjc编译 | 编译仓颉 | build cjc/runtime/stdlib/stdx | 搭建编译环境

**⚠️ 硬规则（极其重要，否则 cjc 不可用）：**
- 构建后必须 `source {workspace-root}/cangjie_compiler/output/envsetup.sh`
- cjc 二进制：`{workspace-root}/cangjie_compiler/output/bin/cjc`（直接使用，无需 find）
- 验证构建：`cjc hello.cj -o hello && ./hello`

> `{workspace-root}` 是仓颉项目根目录（仓颉各子项目 cangjie_compiler/、cangjie_runtime/、cangjie_stdx/ 等在其下），而非固定名称。

详细构建步骤、平台支持、组件顺序，见 `skills/.claude/skills/build-cangjie/SKILL.md`
