# Town 模拟：设计完善计划

本计划基于对现有实现的逐行核对，而不是重新设计。结论先说：
这套功能的**骨架是好的**——schema 规范、边界干净（`town_*` 前缀 + `town_worlds.user_id` 归属，不依赖 chat/character/NPC）、
HTTP 面完整、后端测试全绿（1228 passed / 0 failed，约 13.9s）。

问题集中在两处：**一个真实的正确性缺陷**（记忆溯源与检索截断），
以及**一个设计缺口**（免费复读与付费手动之间没有可用的中间档）。其余都是清理工作。

---

## 一、核心缺陷：记忆溯源丢失 + 检索前截断

这是唯一会**静默地持续降低所有 AI 输出质量**的问题，应优先修。

### 1.1 现象链

`backend/src/modules/townSimulation.js:198` 中，`recordTownMemory` 读取的是 `payload.sourceKind`：

```js
normalizeText(payload.sourceKind, 40) || 'simulation',
```

但连续引擎在 `backend/src/modules/townEngine.js:197 / 200 / 218` 写记忆时**完全没有传 `sourceKind`**
（那三处附近的 `source: 'town-engine'` 属于 `recordTownEvent`，是事件表的字段，与记忆表无关）。

于是引擎每 tick 产生的模板闲聊，全部落进默认值 `'simulation'`。
而 `'simulation'` 同时也是用户通过 API 手写记忆的默认值（`backend/src/validations/schemas.js:496`）。
**引擎噪声与真实记忆变得不可区分。**

对照：同文件 `townEngine.js:246` 的干预路径**确实**传了 `sourceKind: 'intervention'`，
AI 路径也各自传了 `ai-town-engine`（`townAiEngine.js:142`）与 `ai-town-cognition`（`townCognitionEngine.js:191`）。
也就是说 `source_kind` 这个列设计是对的、可用的，唯独引擎自己没有自报身份。

### 1.2 更严重的一层：截断发生在打分之前

`retrieveTownMemories`（`townSimulation.js:213-222`）：

```sql
SELECT * FROM town_memories
 WHERE town_id = ? AND resident_id = ?
 ORDER BY occurred_tick DESC, rowid DESC
 LIMIT ?
```

`candidateLimit` 默认 `Math.max(100, limit)` = **100**，且排序只按时间倒序。
打分（recency 0.35 / importance 0.25 / relevance 0.40）**发生在这 100 条取出之后**。

引擎默认 `DEFAULT_REAL_SECONDS_PER_TICK = 4`，每 tick 至少写 1 条记忆（社交 tick 写 2 条）。
一个活跃居民在**不到一小时真实运行时间**内就能把这 100 条候选全部填满。

此后，早先那条重要的 AI 记忆（importance 9）**根本进不了打分池**——
它在 SQL 层就被 `LIMIT` 切掉了，权重再怎么调都救不回来。
这不是「权重偏置」，是**硬截断**。

### 1.3 污染会自我放大

`maybeReflect`（`townEngine.js:260`）用同一个未过滤的 top-5 生成模板反思：

```js
content: `我注意到：${summary}。接下来应围绕“...”调整行动。`
```

反思本身也被持久化，于是噪声被固化、复利。
同时 `buildTownTurnContext`（`townAiEngine.js`）也取 top-5 且不区分来源——
**付费的 AI 调用正在读引擎的模板文本当上下文。**

### 1.4 修法（两个独立、可分别验证的改动）

**改动 A — 让引擎自报身份（最小、外科手术式）**

在 `townEngine.js` 的三处 `recordTownMemory` 补上 `sourceKind: 'engine-ambient'`。
不新增列、不改 schema、不动既有语义。

**改动 B — 让检索具备溯源意识**

给 `retrieveTownMemories` 增加可选 `excludeSourceKinds` / `minImportance`，
并把候选查询改成「保底高价值 + 补充近期」两段式，使高 importance 记忆不被时间截断吃掉。
例如先按 importance 取一批，再按 recency 取一批，去重后统一打分。

然后在两个消费点收紧：
- `buildTownTurnContext`：排除 `engine-ambient`，AI 只读有意义的记忆
- `maybeReflect`：同样排除，避免反思复读模板

**兼容性**：改动 B 必须保持默认行为不变（不传新参数时结果与现在一致），
这样 `townSimulation.test.js` 等既有断言不会被动摇；新行为用新增测试覆盖。

**验证**：`cd backend && npm test`，并补 3 条针对性测试
（引擎记忆带 `engine-ambient`；高 importance 老记忆在 100+ 条噪声后仍可召回；turn context 不含 ambient）。

---

## 二、设计缺口：两档之间没有中间档

### 2.1 现状是「非此即彼」

| | Tier A 连续引擎 | Tier B AI 回合 |
|---|---|---|
| 触发 | `server.js:378` 已接线，全局每 1s 轮询 | 手动点击，要求 `paused` |
| 成本 | 免费 | 每 tick 一次模型调用 |
| 行为 | `dialogue[stepIndex % len]` 取模循环、活动取模循环、模板反思 | 真实生成 |
| 结果 | **确定性复读，永远重复同几句台词** | 一次点击只推进 15 模拟分钟 |

Tier B 推进一个模拟日（1440 分钟 / 15）需要 **96 次点击**。
Tier A 则会让小镇无限复读。两者都不构成「能一直看下去」的体验。

### 2.2 建议：引入 Tier A+（批量 AI 回合）

不改两档的成本模型，而是补一个**用户显式授权、有预算上限的批量推进**：

- 一次请求推进 N 个 tick（N 有上限，例如 1–24），**一次模型调用产出 N 个 tick 的计划**，
  而不是 N 次调用——这是关键，成本接近单次而覆盖数小时模拟时间
- 复用现有的乐观并发护栏（`expectedTick` / `TOWN_AI_STEP_CONFLICT` → 409），语义不变
- 沿用现有超时与 `AbortController` 模式（AI step 默认 3 分钟）

这条不必现在实现，但**应在动手前定下契约**，否则 Tier A 的取模复读会一直是默认观感。
若本轮先不做，至少应把 Tier A 的确定性循环改成「带随机权重的选取」，让复读不那么刺眼——
这是低成本的观感改善，不涉及模型调用。

---

## 三、生命周期缺口：世界只能增不能删

`backend/src/routes/towns.js`（413 行）**没有任何 DELETE 端点**，模块层也没有删除函数。

每个 AI 生成的世界要花掉一次最长 8 分钟的模型调用
（`TOWN_WORLD_GENERATION_TIMEOUT_DEFAULT_MS = 8 * 60 * 1000`），
但用户**永远无法删除它**，列表只能单向增长。

schema 已经准备好了：`town_worlds(id)` 上所有外键都是 `ON DELETE CASCADE`
（`town_events.resident_id` 是 `SET NULL`），
所以删除是一次 `DELETE FROM town_worlds WHERE id = ? AND user_id = ?` 即可级联干净。

建议补：
- `DELETE /:townId` — 删除世界（级联）
- `DELETE /:townId/residents/:residentId` — 删除居民

**安全要求**：必须校验 `user_id` 归属；删除属破坏性操作，前端需二次确认；
删除前若世界处于 `running`，应先停引擎再删，避免引擎在删除中途写入。

---

## 四、健壮性

**4.1 停机静默丢时间**
`MAX_CATCHUP_STEPS = 6`，配合 4s/tick 只能追回约 24 秒真实时间。
合盖笔记本再打开，小镇**静默冻结**且不告知用户。
建议：追赶被截断时写一条明确的 `town_events` 记录，让用户看得见「这里跳过了」。

**4.2 无按用户预算**
`runDueTownSimulationSteps` 每秒扫描**所有用户**所有 `running` 世界，无任何配额。
建议：加单轮处理世界数上限，避免单用户开多个世界拖慢全局。

**4.3 无关系图**
`memoryType: 'relationship'` 存在，但关系只隐含在记忆文本里，无法查询「谁和谁熟」。
属增强项，非缺陷，本轮可不做。

---

## 五、清理

- `frontend/src/features/town/townDemo.js`（125 行）——**死代码，零引用**。删除需用户明确同意（AGENTS.md）。
- **9 个未使用的 API 包装**（`frontend/src/api/towns.js` 导出 18 个，UI 只用 9 个）：
  `advanceTown`、`createTown`、`createTownResident`、`createTownMemory`、`createTownReflection`、
  `saveTownSchedule`、`fetchTownSchedule`、`fetchTownReflectionStatus`、`fetchTownEvents`。
  这些对应的后端端点**都是可用的**——说明是 UI 没接完，不是 API 多余。
  应当判断「接上」还是「删掉」，而不是放着。日程（schedule）与反思状态尤其值得接上，
  因为 `docs/town-simulation.md` 明确要求日程是 2–12 个有序不重叠活动。
- 无条件轮询：`TownExperience.vue` 每 1800ms 拉快照，**即使世界已暂停**。暂停时应停轮询。
- `followingAgentId` 是惰性的（无镜头跟随），要么实现要么移除。
- 体量：`TownExperience.vue` 864 行、`town.css` 1617 行。拆分是好事，但**属于独立改动**，
  不应与上述修复混在一个提交里。

---

## 六、执行顺序

按「先修正确性、再补缺口、最后清理」推进，每步独立可验证、可单独 review。

**第 1–6 步已完成**（2026-07-28），测试从 1228 增至 1244：

1. ✅ 引擎记忆补 `sourceKind: 'engine-ambient'`（`townEngine.js` 三处）
2. ✅ `retrieveTownMemories` 新增 `excludeSourceKinds` / `minImportance`，
   并改为「高价值保底 + 近期补充」两段式候选；不传新参数时行为与原先一致
3. ✅ `buildTownTurnContext` 排除 ambient 且设 `minImportance: 5`；
   `maybeReflect` 改为「优先真实记忆，无则回落到 ambient」——
   直接排除会让纯引擎小镇彻底不再反思，属回归，故不采用
4. ✅ `deleteTown` / `deleteTownResident` + `DELETE` 路由，含归属校验；
   删除前先置 `paused`，避免连续引擎在级联期间写入
5. ✅ 取模循环改为 seeded PRNG（FNV-1a），对 (world, resident, tick) 可复现但不再肉眼成环；
   同时避免连续重复同一台词/活动
6. ✅ 前端轮询条件化：仅在 `isRunning` 时轮询，暂停即停

**第 5 步顺带修掉两个真实缺陷**（原计划未预见）：

- **居民自言自语**：旧逻辑 `speaker = residents[stepIndex % len]`、
  `listener = residents[(stepIndex + 2) % len]`，在**恰好 2 名居民**时，
  两者对所有社交 tick 恒等——即 100% 的社交事件都是居民对自己说话。
  已改为从「排除说话者后的集合」中选听者。
- **单居民干预重复记忆**：`reactToIntervention` 中 responder 与 witness 在单居民时相同，
  `for (const resident of [responder, witness])` 会给同一人写两条同样的记忆，
  `participantIds` 也重复。已去重。

**尚未做**：

7.（可选，需先定契约）**Tier A+ 批量 AI 回合**——第二节的设计缺口仍然存在。
   建议实现前先定「一次调用产出 N 个 tick」的工具契约，再动 `townTurnAssistant.js`。

另：`townDemo.js`（死代码）与 `api/towns.js` 中 9 个未使用包装**仍保留**，
按 AGENTS.md 需用户明确同意才删除。前端删除按钮的二次确认 UI 亦未接入，
后端端点已就绪。

每步完成后按 AGENTS.md 要求执行：
```
cd backend && npm test
cd frontend && npm run build
node scripts/check-encoding.mjs
powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1
```

---

## 七、角色扮演路径顺带修复

在检查对话体验时，于 `backend/src/services/promptPipeline.js` 发现一个影响角色一致性的真实缺陷。

`omitHistoryMessagesForBudget` 在超出上下文预算时逐条丢弃历史消息，
但**不保证 user / assistant 成对丢弃**。构造用例：

```
system / user(2000 字) / assistant("short reply") / user("latest")
```

预算 300 字时，旧行为丢掉那条大 user 消息、却**保留了它的 assistant 回复**，
最终发给模型的是 `system -> assistant -> user`——
模型读到一条「对不存在的问题的回答」。

在长对话（正是预算会生效的场景）里，这会持续损害角色扮演的连贯性：
模型看到孤立的 assistant 发言，容易搞错谁说过什么、剧情到哪一步。

已改为**按「轮次」丢弃**：丢一条 user 消息时，连同紧随其后的 assistant 回复一起丢，
包括连续多条 assistant（续写场景）。system 提示与最后一条 user 消息仍受保护、永不丢弃。

回归测试见 `backend/src/tests/promptBudgetPairing.test.js`（4 条）。
已用「临时还原旧实现」验证：旧代码下其中 2 条失败，新实现下 4 条全过——
测试确实能捕获该缺陷，而非空跑。

## 八、需要你确认的两件事

1. **Tier A+**：批量 AI 回合是否要做？若做，我需要先和你定
   「一次调用产出 N 个 tick」的契约，再动 `townTurnAssistant.js` 的工具签名。
2. **死代码删除**：`townDemo.js` 与 `api/towns.js` 里 9 个未使用包装是否要删？
   按 AGENTS.md 我不会擅自删除，需要你明确说要删。
   另外前端「删除小镇 / 居民」的二次确认 UI 要不要我接上（后端端点已就绪）？
