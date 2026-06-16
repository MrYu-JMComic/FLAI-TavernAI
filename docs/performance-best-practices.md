# FLAI Tavern AI 性能优化最佳实践

**维护日期**: 2026-06-13  
**适用版本**: v0.1.0+

---

## 📚 目录

1. [前端性能优化](#前端性能优化)
2. [后端性能优化](#后端性能优化)
3. [数据库优化](#数据库优化)
4. [代码规范](#代码规范)
5. [监控和调试](#监控和调试)

---

## 前端性能优化

### 1. 组件懒加载 ✅ 已实施

**原则**: 使用`defineAsyncComponent`进行路由级别的代码分割

```javascript
// ✅ 正确做法
const ChatView = defineAsyncComponent(() => import('./views/ChatView.vue'));

// ❌ 避免
import ChatView from './views/ChatView.vue';
```

**收益**: 减少初始bundle大小，加快首屏加载

### 2. 避免中间数组分配 ✅ 已实施

项目已完成大量数组优化工作。继续遵循以下原则：

```javascript
// ✅ 使用直接循环
function findItem(items, id) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i];
  }
  return null;
}

// ❌ 避免创建中间数组
function findItem(items, id) {
  return items.filter(item => item.id === id)[0];
}
```

### 3. 引用稳定性 ✅ 已实施

**原则**: 避免不必要的对象/数组引用替换

```javascript
// ✅ 保持引用稳定
if (!isArrayEqual(oldList, newList)) {
  list.value = newList;
}

// ❌ 总是替换引用
list.value = newList; // 即使内容相同也会触发重渲染
```

### 4. 异步操作守卫 ✅ 已实施

**原则**: 防止过期的异步响应覆盖新状态

```javascript
// ✅ 使用token守卫
let loadToken = 0;
async function loadData() {
  const token = ++loadToken;
  const data = await fetchData();
  if (token !== loadToken) return; // 过期请求，忽略
  state.value = data;
}

// ❌ 未守卫
async function loadData() {
  const data = await fetchData();
  state.value = data; // 可能被旧请求覆盖
}
```

### 5. 事件处理优化

**防抖和节流**:

```javascript
import { debounce } from './utils/timing.js';

// 搜索输入 - 使用防抖
const handleSearch = debounce((query) => {
  performSearch(query);
}, 300);

// 滚动事件 - 使用requestAnimationFrame
let rafId = null;
function handleScroll() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    updateScrollState();
    rafId = null;
  });
}
```

### 6. 大列表虚拟滚动 ✅ 已集成

项目已使用`@tanstack/vue-virtual`。继续在长列表场景使用：

```vue
<template>
  <VirtualScroller :items="messages" :itemHeight="80">
    <template #default="{ item }">
      <MessageItem :message="item" />
    </template>
  </VirtualScroller>
</template>
```

---

## 后端性能优化

### 1. 数据库查询优化 ⚠️ 需持续关注

**原则**: 使用prepared statements，避免N+1查询

```javascript
// ✅ 单次查询获取所有数据
const messages = db.prepare(`
  SELECT m.*, u.username, c.name as character_name
  FROM messages m
  LEFT JOIN users u ON m.user_id = u.id
  LEFT JOIN characters c ON m.character_id = c.id
  WHERE m.conversation_id = ?
`).all(conversationId);

// ❌ N+1查询
const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(conversationId);
messages.forEach(msg => {
  msg.user = db.prepare('SELECT * FROM users WHERE id = ?').get(msg.user_id);
});
```

### 2. API响应优化

**字段选择**: 只返回必要字段

```javascript
// ✅ 选择性返回
db.prepare('SELECT id, name, avatar FROM characters WHERE user_id = ?');

// ❌ 返回所有字段
db.prepare('SELECT * FROM characters WHERE user_id = ?');
```

**分页**: 大数据集必须分页

```javascript
const LIMIT = 50;
const offset = (page - 1) * LIMIT;
db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?')
  .all(LIMIT, offset);
```

### 3. 流式响应 ✅ 已实施

项目已支持SSE流式输出。继续用于长响应：

```javascript
// AI响应流式传输
async function* streamCompletion(prompt) {
  const stream = await provider.createChatStream(prompt);
  for await (const chunk of stream) {
    yield chunk;
  }
}
```

### 4. 缓存策略

**Provider模型缓存** ✅ 已实施:

```javascript
const providerModelCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30分钟
```

**建议扩展**:
- 用户头像缓存（内存LRU）
- 常用角色卡缓存
- 世界书条目缓存

---

## 数据库优化

### 1. 索引策略 ⚠️ 需验证

**必需索引**:

```sql
-- 会话查询
CREATE INDEX idx_conversations_user_updated 
ON conversations(user_id, updated_at DESC);

-- 消息查询
CREATE INDEX idx_messages_conversation_created 
ON messages(conversation_id, created_at);

-- 角色查询
CREATE INDEX idx_characters_user_visibility 
ON characters(user_id, visibility);

-- 世界书触发词查询
CREATE INDEX idx_worldbook_entries_book_enabled
ON worldbook_entries(book_id, enabled);
```

**验证索引使用**:

```sql
EXPLAIN QUERY PLAN 
SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at;
```

### 2. SQLite优化配置

```javascript
// 建议在db.js中添加
db.pragma('journal_mode = WAL'); // 写前日志模式，提升并发
db.pragma('synchronous = NORMAL'); // 平衡性能和安全性
db.pragma('cache_size = -64000'); // 64MB缓存
db.pragma('temp_store = MEMORY'); // 临时表在内存
```

### 3. 批量操作

```javascript
// ✅ 使用事务批量插入
const insertMany = db.transaction((rows) => {
  const stmt = db.prepare('INSERT INTO messages (content, user_id) VALUES (?, ?)');
  for (const row of rows) {
    stmt.run(row.content, row.user_id);
  }
});

insertMany(largeDataset);
```

---

## 代码规范

### 1. 避免未使用的导入 ✅ 已有守卫

项目有source-hygiene检查。遵循规范：

```javascript
// ✅ 只导入需要的
import { computed, ref } from 'vue';

// ❌ 导入未使用的
import { computed, ref, watch, onMounted } from 'vue'; // watch和onMounted未使用
```

### 2. 直接循环替代回调 ✅ 项目标准

```javascript
// ✅ 直接循环
let found = null;
for (let i = 0; i < items.length; i++) {
  if (items[i].active) {
    found = items[i];
    break;
  }
}

// ❌ 高阶函数（创建闭包和中间对象）
const found = items.find(item => item.active);
```

**例外**: 代码可读性优先时，简单的map/filter可以接受

### 3. 条件渲染优化

```vue
<!-- ✅ v-if用于不常切换的内容 -->
<HeavyComponent v-if="show" />

<!-- ✅ v-show用于频繁切换的内容 -->
<div v-show="isVisible">...</div>

<!-- ✅ 计算属性缓存复杂逻辑 -->
<script setup>
const filteredItems = computed(() => {
  return items.value.filter(item => item.active);
});
</script>
```

---

## 监控和调试

### 1. 性能监控

**前端性能标记**:

```javascript
// 测量关键操作
performance.mark('loadMessages-start');
await loadMessages();
performance.mark('loadMessages-end');
performance.measure('loadMessages', 'loadMessages-start', 'loadMessages-end');
```

**后端日志**:

```javascript
const startTime = Date.now();
const result = await expensiveOperation();
const duration = Date.now() - startTime;
if (duration > 1000) {
  console.warn(`Slow operation: ${duration}ms`);
}
```

### 2. Bundle分析

```bash
# 生成bundle分析报告
npm run build -- --analyze

# 或者使用rollup-plugin-visualizer
```

### 3. 数据库查询分析

```javascript
// 开发环境启用查询日志
if (process.env.NODE_ENV === 'development') {
  db.function('log_query', (query) => {
    console.log('Query:', query);
  });
}
```

---

## 性能检查清单

### 开发阶段
- [ ] 新组件使用懒加载（如果是路由级别）
- [ ] 避免在循环中创建中间数组
- [ ] 异步操作添加守卫token
- [ ] 大列表使用虚拟滚动
- [ ] 事件处理使用防抖/节流

### 代码审查
- [ ] 检查未使用的导入
- [ ] 验证数据库查询效率
- [ ] 确认没有N+1查询
- [ ] 检查引用稳定性

### 发布前
- [ ] 运行完整测试套件
- [ ] 检查bundle大小警告
- [ ] 验证关键路径性能
- [ ] 检查数据库索引使用

---

## 参考资源

- [Vue性能优化指南](https://vuejs.org/guide/best-practices/performance.html)
- [SQLite优化技巧](https://www.sqlite.org/optoverview.html)
- [Web性能优化](https://web.dev/performance/)

---

**维护**: 本文档应随项目演进持续更新。发现新的性能模式时及时补充。
