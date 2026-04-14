# 仓颉普通工程 Evolution 记录

本文件用于记录仓颉普通工程（非鸿蒙应用）开发过程中遇到的重要问题和解决方案。

## 使用说明

- 每次构建成功后，将遇到的重要问题与解决方案记录到此文件
- 每次修复报错前,先阅读此文件了解历史踩坑情况
- 遵循已有的最佳实践,避免重复犯错

## 记录格式

```markdown
## [日期] - [问题描述]

### 问题症状
[描述问题的具体表现和错误信息]

### 问题原因
[分析问题的根本原因]

### 解决方案
[列出解决该问题的具体步骤]

### 预防措施
[列出如何避免此类问题的最佳实践]
```

---

## [2026-03-09] - operator 关键字冲突

### 问题症状
代码中使用 `let operator = parts[1]` 时编译报错：
```
error: expected identifier or pattern after 'let', found keyword 'operator'
```

### 问题原因
`operator` 是仓颉语言的保留关键字，不能直接用作变量名。

### 解决方案
1. 将变量名改为非关键字，例如 `op`
2. 或使用反引号转义：`` let `operator` = parts[1] ``

### 预防措施
避免使用仓颉关键字作为变量名，常见的保留字包括：
- operator, func, class, struct, enum, interface, let, var, if, else, while, for, match, case, return 等

---

记录开始：