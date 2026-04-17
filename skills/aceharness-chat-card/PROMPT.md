## 富文本卡片渲染（aceharness-chat-card 技能）

**⚠️ 触发关键词：**
做个卡片 | card | badges | 徽章 | 进度条 | tabs | 折叠 | 可视化

---

## ⚠️ 最高优先级规则（必须遵守）

### 规则 1：输出格式正确性

**展示任何结构化内容时，必须使用 ```card 代码块：**
- PR/Issue 分析、统计数据、状态、列表、摘要等 → 必须用 ```card
- 禁止使用 ```json 或纯文本输出结构化内容
- card 代码块与普通文字内容必须**独立输出**，不要混在同一条消息里

### 规则 2：生成前必须验证（硬性要求）

**生成任何 ```card 代码块前，必须用验证脚本确认格式正确：**

```bash
# 先生成 JSON，然后验证
echo '你的JSON' | node /absolute/path/to/skills/aceharness-chat-card/scripts/validate-card.mjs
```

发现错误**立即修正**后，再输出到用户可见区域。**禁止跳过验证步骤**。

**⚠️ 所有告警（warning）和报错（error）都必须处理，不允许忽略任何一条验证输出。即使是非致命的告警也必须修正后才能输出。验证通过的标准是：零错误 + 零告警。**

### 规则 3：card 与 action 是完全独立的概念

| 概念 | 定义 | 代码块 |
|------|------|--------|
| card | 可视化卡片，用于展示结构化信息 | ```card ``` |
| action | 操作指令块，用于触发系统行为 | ```action ``` |

两者**完全独立**，用途不同，语法不同，禁止混淆。

---

## 精确的 JSON Schema（必须严格遵守）

```typescript
interface CardSchema {
  header?: {
    icon?: string;        // material-symbols-outlined 图标名（任何合法 Material Icons 名称）
    title: string;       // 标题，必填
    subtitle?: string;   // 副标题
    gradient?: string;    // tailwind 渐变，如 "from-blue-500 to-cyan-500"
    badges?: { text: string; color?: string }[];  // 注意是 badges（复数），不是 badge
  };
  blocks: Block[];       // 有序内容块，**禁止为空数组**
  actions?: { label: string; prompt: string; icon?: string }[];
}

type Block =
  | { type: 'info'; rows: { label: string; value: string; icon?: string }[] }  // 注意是 rows，不是 title+content
  | { type: 'badges'; items: { text: string; color?: string }[] }              // 注意是 items，不是 badges
  | { type: 'text'; content: string; maxLines?: number }                      // 注意是 content
  | { type: 'code'; code: string; lang?: string; copyable?: boolean }        // 注意是 code，不是 title+content
  | { type: 'progress'; value: number; max?: number; label?: string }
  | { type: 'steps'; current: number; total: number }
  | { type: 'tabs'; tabs: { key: string; label: string; blocks: Block[] }[] }
  | { type: 'collapse'; title: string; icon?: string; subtitle?: string; blocks: Block[]; defaultOpen?: boolean }
  | { type: 'list'; items: { icon?: string; color?: string; text: string }[] }  // 注意是 text，不是 label
  | { type: 'status'; state: string; color?: string; animated?: boolean; rows?: { label: string; value: string }[] }
  | { type: 'actions'; items: { label: string; prompt: string; icon?: string }[] }
  | { type: 'divider' }
```

---

## ❌ 常见错误（必须避免）

### 错误 1：使用 ```json 而不是 ```card

**错误：**
````json
```json
{"header": {...}, "blocks": [...]}
```
````

**正确：**
````card
```card
{"header": {...}, "blocks": [...]}
```
````

### 错误 2：header 用 badge 而不是 badges

**错误：**
```json
{"header": {"badge": "严重"}}
```

**正确：**
```json
{"header": {"badges": [{"text": "严重", "color": "red"}]}}
```

### 错误 3：info 用 title+content 而不是 rows

**错误：**
```json
{"type": "info", "title": "基本信息", "content": "**提交人:** yms_hi"}
```

**正确：**
```json
{"type": "info", "rows": [{"label": "提交人", "value": "yms_hi", "icon": "person"}]}
```

### 错误 4：code 用 title+content 而不是 code

**错误：**
```json
{"type": "code", "title": "错误信息", "content": "Error..."}
```

**正确：**
```json
{"type": "code", "code": "Error...", "lang": "text"}
```

### 错误 5：badges 用 label 而不是 text

**错误：**
```json
{"type": "badges", "items": [{"label": "bug", "color": "red"}]}
```

**正确：**
```json
{"type": "badges", "items": [{"text": "bug", "color": "red"}]}
```

### 错误 6：list 用 label 而不是 text

**错误：**
```json
{"type": "list", "items": [{"icon": "check", "label": "已完成"}]}
```

**正确：**
```json
{"type": "list", "items": [{"icon": "check_circle", "text": "已完成"}]}
```

### 错误 7：blocks 为空

**错误：**
```json
{"header": {...}, "blocks": []}
```

**正确：**
```json
{"header": {...}, "blocks": [{"type": "text", "content": "描述内容"}]}
```

### 错误 8：跳过验证直接输出

**生成 card 后必须验证：**
```bash
echo '{"header": {...}, "blocks": [...]}' | node /absolute/path/to/skills/aceharness-chat-card/scripts/validate-card.mjs
```

---

## 推荐常用图标（不限于此列表，任何 Material Icons 图标名均可使用，验证脚本会检查合法性）

**Git/代码：** `merge_type` `fork_right` `account_tree` `commit` `tag` `source` `link` `content_copy` `difference` `analytics` `rule` `fact_check` `rate_review` `approval` `merge` `playlist_add_check` `done_all`

**文件：** `description` `insert_drive_file` `note` `article` `folder` `file_copy` `receipt`

**状态/进度：** `running_with_errors` `pending` `hourglass_empty` `schedule` `timelapse` `autorenew` `visibility` `check_circle` `cancel` `stop` `play_arrow` `pause` `refresh` `next_plan` `assistant` `psychology` `recommend`

**操作：** `search` `filter_list` `sort` `download` `upload` `settings` `launch` `arrow_forward` `arrow_back` `close` `add` `remove` `edit` `delete`

**信息：** `info` `help` `smart_toy` `rocket_launch` `bolt` `flash_on` `electric_bolt` `power` `battery_charging_full` `device_thermostat` `speed`

**导航：** `chat` `mail` `phone` `flag` `bookmark` `star` `favorite` `thumb_up` `thumb_down` `share`

---

## 正确示例

### Issue 分析卡片（正确格式）
````card
```card
{"header": {"icon": "bug_report", "title": "[BUG] 编译器内部错误", "subtitle": "Issue #3112 · Cangjie/UsersForum", "badges": [{"text": "bug", "color": "red"}, {"text": "待办的", "color": "gray"}]}, "blocks": [{"type": "info", "rows": [{"label": "提交人", "value": "yms_hi", "icon": "person"}, {"label": "时间", "value": "2026-03-25 22:12:43", "icon": "schedule"}, {"label": "状态", "value": "待办的", "icon": "pending"}]}, {"type": "code", "code": "Internal Compiler Error: Signal 11 received", "lang": "text"}, {"type": "list", "items": [{"icon": "check_circle", "text": "仅提供 Bug 报告，不参与开发"}]}]}
```
````
