# Autonomous Backlog

The autonomous loop should choose one small item per run. Add new findings here instead of making broad, speculative rewrites.

## Ready

### 原有任务
- Improve empty, loading, and error states in the Vue views.
- Add backend tests for provider settings, character CRUD, and streaming error paths.
- Improve frontend API error handling and user-facing messages.
- Add lightweight accessibility checks for forms and chat controls.
- Burn down `node scripts/find-inaccessible-vue-controls.mjs --json` findings.
  The current non-blocking diagnostic reports no potentially inaccessible Vue
  controls after clearing the chat, image, economy, toast, NPC, save panel, talent, variable editor, character form, preset, settings, and world book findings.
- Re-run `node scripts/find-unreferenced-vue-components.mjs` before deleting
  or rewiring dormant Vue components. The scanner currently has no unreviewed
  candidates; `ExtensionManager.vue` and `VirtualMessageList.vue` are recorded
  in `automation/reviewed-unreferenced-vue-components.json` as reviewed dormant
  components. `VirtualMessageList.vue` should not be wired into `ChatView.vue`
  until the chat scroll/anchor contract supports a component-backed scroller.

### 新增：AI风月参考功能（高优先级）
- **世界书系统：** 角色卡附加世界观设定，触发词自动注入上下文
- **角色卡标签：** 标签系统，支持筛选和分类浏览
- **会话存档/读档：** 保存对话进度，支持多存档位
- **对话模板/预设：** 系统提示词+参数组合预设

### 新增：AI风月参考功能（中优先级）
- **角色卡导入/导出：** JSON 格式分享
- **Mod 系统：** 用户自定义扩展（提示词注入、文风增强）
- **自定义状态栏：** 对话中嵌入 UI 元素（HP/MP/好感度）
- **正则规则增强：** 分组、优先级、批量管理

## Needs Human Decision

- External channel integration such as Telegram, Discord, Slack, or WhatsApp.
- Automatic Git commits, remote pushes, release tags, deployments, or PR creation.
- Data migration touching `backend/data/flai.sqlite`.
- Any change that stores or transmits user conversations outside the local machine.

## Done

- 2026-05-25: Added autonomous iteration guardrails, scripts, and reporting structure.
- 2026-06-07: Documented production startup and backup/restore steps for local SQLite data.
- 2026-06-07: Reviewed dependency versions and recorded upgrade candidates before changing them.
- 2026-06-07: Hardened frontend notification fallbacks for empty error and warning messages.
- 2026-06-07: Added provider settings route tests for API key preserve and clear behavior.
- 2026-06-07: Added streaming chat route test for provider failure SSE handling.
- 2026-06-07: Extracted shared route-test helpers for recent provider and streaming route tests.
- 2026-06-07: Added character route authorization test for non-owner patch/delete attempts.
- 2026-06-07: Added owner character route patch/delete success coverage.
- 2026-06-07: Fixed character worldBookId reporting to prefer linked world books with legacy fallback.
- 2026-06-07: Added character patch route worldBookId response coverage.
- 2026-06-07: Hardened world book character binding ownership checks.
- 2026-06-07: Filtered world book junction reads against legacy cross-owner links.
- 2026-06-07: Guarded character world book unlink routes against legacy cross-owner junction rows.
- 2026-06-07: Filtered character export world books by owner to ignore legacy cross-owner direct rows.
- 2026-06-07: Made legacy direct world book selection deterministic in character export.
- 2026-06-07: Made character export prefer linked world books before legacy direct fallback.
- 2026-06-07: Extracted character export world book lookup into a focused helper.
- 2026-06-07: Avoided legacy direct world book lookup when character export already has a linked world book.
- 2026-06-07: Reused structured frontend API error messages for SSE assistant error events.
- 2026-06-07: Made the frontend API module importable by Node-based diagnostics outside Vite.
- 2026-06-07: Added behavior coverage for frontend assistant SSE message-field errors.
- 2026-06-07: Preserved plain-text frontend assistant SSE error payloads as user-facing messages.
- 2026-06-07: Preserved nested frontend assistant SSE error messages instead of showing object strings.
- 2026-06-07: Retried frontend JSON mutations after nested CSRF error responses.
- 2026-06-07: Added streaming assistant coverage for nested CSRF retry responses.
- 2026-06-07: Ignored empty JSON frontend assistant SSE error payloads in user-facing messages.
- 2026-06-07: Added frontend API coverage for plain-text HTTP error response messages.
- 2026-06-07: Added frontend API coverage to ignore HTML HTTP error bodies in user-facing messages.
- 2026-06-07: Preserved structured frontend API 404 errors during dev backend fallback checks.
- 2026-06-07: Preserved structured frontend assistant SSE 404 errors during dev backend fallback checks.
- 2026-06-07: Avoided unnecessary frontend assistant SSE response clones outside dev backend fallback checks.
- 2026-06-07: Preserved plain-text frontend API and assistant SSE 404 errors during dev backend fallback checks.
- 2026-06-07: Kept frontend API and assistant SSE dev fallback active for generic dev-server 404 text.
- 2026-06-07: Refactored frontend API dev fallback checks to separate retry-base lookup from retry-blocking errors.
- 2026-06-07: Made frontend assistant SSE CSRF retries independent of response cloning.
- 2026-06-07: Flushed frontend assistant SSE text decoding at stream end to preserve trailing malformed UTF-8 signals.
- 2026-06-07: Made frontend assistant SSE dev fallback structured-error checks independent of response cloning.
- 2026-06-07: Blocked frontend assistant SSE dev fallback when the initial 404 response body cannot be read.
- 2026-06-07: Preserved normal frontend API HTTP status when error response bodies cannot be read.
- 2026-06-07: Preserved structured generic 404 frontend API errors while keeping raw dev-server 404 fallback active.
- 2026-06-07: Kept frontend dev fallback active for generic root `/api` dev-server 404 text.
- 2026-06-07: Added Settings personal-page load error state with retry and guarded editable forms while loading fails.
- 2026-06-07: Added Settings extension-section load error states and retries for tags, presets, mods, and regex rules.
- 2026-06-07: Added Character edit load error state and retry guard to prevent editing stale empty forms after load failures.
- 2026-06-07: Added Character form option-load error state and retry for tag/world-book choices, with parallel edit loading.
- 2026-06-07: Kept World Book detail load failures on the detail route so the existing error and retry state is reachable.
- 2026-06-07: Added Home page tag-filter load error state and retry instead of silently hiding failed tag filters.
- 2026-06-07: Added Chat sidebar load error state and retry instead of silently replacing failed history, character, or preset loads with empty lists.
- 2026-06-07: Added Chat sidebar partial-load regression coverage and made the conversation composable importable by Node diagnostics.
- 2026-06-07: Guarded Chat sidebar data loads against stale async responses overwriting newer conversation sidebar state.
- 2026-06-07: Guarded Home character list loads against stale search, sort, or tag responses overwriting newer filters.
- 2026-06-07: Guarded World Book list and detail loads against stale route responses overwriting newer state.
- 2026-06-07: Guarded Character image panel loads against stale character responses overwriting newer image state.
- 2026-06-07: Guarded Settings regex rule loads against stale group-filter responses overwriting newer rules.
- 2026-06-07: Guarded chat accessory status, economy, and skill loads against stale same-conversation refreshes.
- 2026-06-07: Guarded Chat model refreshes against stale overlapping provider-model refresh results.
- 2026-06-07: Guarded Settings tag, preset, and mod loads against stale extension refresh responses.
- 2026-06-07: Guarded Preset page reloads against stale overlapping refresh responses.
- 2026-06-07: Guarded chat branch list reloads against stale same-conversation refresh responses.
- 2026-06-07: Guarded chat message swipe initialization against stale overlapping conversation loads.
- 2026-06-07: Blocked duplicate chat swipe generation requests while a message swipe is already loading.
- 2026-06-07: Blocked duplicate chat branch creation requests while a branch action is already running.
- 2026-06-07: Guarded chat status bar saves against stale conversation responses and older save cleanup.
- 2026-06-07: Guarded chat status bar deletes against stale conversation responses and overlapping save mutations.
- 2026-06-07: Guarded chat appearance saves against stale conversation responses and stuck saving state after navigation.
- 2026-06-07: Guarded chat accessory skill saves against stale conversation responses and stuck saving state after navigation.
- 2026-06-07: Guarded chat background image uploads against stale FileReader results after newer picks or clears.
- 2026-06-07: Guarded character form background image uploads against stale FileReader results after newer picks or clears.
- 2026-06-07: Guarded character avatar uploads against stale FileReader results after newer picks.
- 2026-06-07: Guarded character image panel uploads against stale character switches during FileReader and create requests.
- 2026-06-07: Guarded character image panel edit/default/delete/reorder mutations against stale character switches.
- 2026-06-07: Guarded save panel create/load/delete/rename completions against stale conversation switches.
- 2026-06-07: Guarded NPC panel memory, behavior, and cleanup mutation completions against stale conversation or NPC selection changes.
- 2026-06-07: Guarded World Book entry save/delete/toggle/reorder completions against stale route changes.
- 2026-06-07: Guarded World Book book-level and AI-draft completions against stale route changes.
- 2026-06-07: Guarded Settings regex toggle/reorder/import completions against stale group-filter changes.
- 2026-06-07: Guarded Settings preset save/delete/default/import completions against stale extension-page and overlapping mutation state.
- 2026-06-07: Guarded Settings mod save/delete/toggle/reorder completions against stale extension-page and overlapping mutation state.
- 2026-06-07: Guarded Settings tag add/delete completions against stale extension-page, limit changes, and overlapping loads.
- 2026-06-07: Consolidated Settings extension-page transition watchers and included regex reload invalidation on page changes.
- 2026-06-07: Guarded Settings personal-page provider/profile/model/balance completions against stale page switches and overlapping requests.
- 2026-06-07: Reused a unified Settings async reset on unmount so extension mutations cannot complete against a destroyed view.
- 2026-06-07: Guarded talent roll dialog mutations against stale character or permission changes.
- 2026-06-07: Added World Book view unmount async-scope invalidation for loads, mutations, and AI draft streams.
- 2026-06-07: Guarded Home character and tag loads against stale completions after unmounts or overlapping retries.
- 2026-06-07: Guarded App session, provider, profile, and logout state against stale async completions.
- 2026-06-07: Coalesced chat scroll animation frames and canceled pending scroll timers on cleanup.
- 2026-06-07: Guarded Home chat, reaction, import, and mount-layout completions against unmounted views.
- 2026-06-07: Guarded talent roll dialog completions against unmounted dialog instances.
- 2026-06-07: Guarded Chat composer layout and quick-model completions against unmounted views.
- 2026-06-07: Guarded SaveLoadPanel load and mutation completions against unmounted panel instances.
- 2026-06-07: Aborted and invalidated chat submit streams during chat view cleanup.
- 2026-06-07: Guarded chat message action completions and editor-focus frames against unmounted views.
- 2026-06-07: Guarded EconomyPanel balance and history completions against unmounted panel instances.
- 2026-06-07: Coalesced VariableEditor scroll-sync ticks and invalidated them on unmount.
- 2026-06-07: Guarded NpcPanel load, detail, and mutation completions against unmounted panel instances.
- 2026-06-07: Guarded Settings regex file-import completions against stale extension-page state.
- 2026-06-07: Aborted CharacterFormView AI draft streams and ignored stale stream callbacks after unmount.
- 2026-06-07: Guarded Settings preset file-import read errors against stale extension-page state.
- 2026-06-07: Guarded CharacterFormView option and edit loads against stale completions after unmount.
- 2026-06-07: Guarded CharacterFormView tag-create completions against stale input and unmounts.
- 2026-06-07: Guarded CharacterFormView suggested-Mod creation against stale AI suggestions and duplicate clicks.
- 2026-06-07: Pruned App ripple timers for detached targets before stale callbacks touch old DOM.
- 2026-06-07: Snapshot CharacterFormView world-book selections during submit and guarded stale submit UI completions.
- 2026-06-07: Dismissed toast action notifications before running navigation actions.
- 2026-06-07: Guarded CharacterFormView export completions against stale routes and duplicate clicks.
- 2026-06-07: Guarded ChatView toast settings actions against delayed clicks after unmount.
- 2026-06-07: Guarded CharacterFormView delete completions against stale routes and duplicate clicks.
- 2026-06-07: Closed BaseLayout user and mobile menus on route changes to avoid stale navigation UI.
- 2026-06-07: Cleared App notifications and timers across authentication boundary changes.
- 2026-06-07: Guarded PresetView delete completions against unmounts and duplicate clicks.
- 2026-06-07: Guarded PresetView save completions against stale edit contexts and duplicate submits.
- 2026-06-07: Closed BaseLayout mobile navigation when resizing out of the mobile breakpoint.
- 2026-06-07: Optimized useViewport to update on media-query breakpoint changes instead of every resize.
- 2026-06-07: Guarded PresetView default-preset completions against unmounts and duplicate clicks.
- 2026-06-07: Coalesced ChatView viewport and keyboard layout events into one animation frame.
- 2026-06-07: Guarded Settings avatar upload entry against duplicate saves and malformed events.
- 2026-06-07: Coalesced ChatView textarea ResizeObserver work into one animation frame.
- 2026-06-07: Guarded CharacterFormView image FileReader completions against unmounts and malformed events.
- 2026-06-07: Reset ChatModelSwitcher drafts when the provider context changes while open.
- 2026-06-07: Guarded CharacterImagePanel async completions against unmounts and malformed upload events.
- 2026-06-07: Guarded chat accessory async completions against ChatView unmounts.
- 2026-06-07: Reset NPC panel add-memory/add-behavior drafts when the selected NPC context changes.
- 2026-06-07: Bound ChatSidebar history search to parent state so programmatic resets update the input UI.
- 2026-06-07: Guarded chat appearance async completions against ChatView unmounts.
- 2026-06-07: Closed ChatSettingsDrawer subpanels when the drawer closes or conversation context changes.
- 2026-06-07: Reset ChatView message editing, reasoning, swipe, and branch UI state when the conversation context changes.
- 2026-06-07: Completed chat conversation async stale guards and unmount cleanup.
- 2026-06-07: Guarded ChatModelSwitcher save state with a token and reset stale saving/refreshing on provider context changes.
- 2026-06-07: Removed duplicate chat conversation cleanup helpers left by overlapping async guard patches.
- 2026-06-07: Hardened shared viewport detection when `matchMedia` is unavailable.
- 2026-06-07: Synced ChatComposer selected preset after preset-list refreshes so deleted or missing preset IDs do not stay selected.
- 2026-06-07: Kept ChatSidebar bulk-action count scoped to currently visible selected conversations.
- 2026-06-07: Kept the active Home tag filter visible in the limited hot-tag rail after resize or tag refresh changes.
- 2026-06-07: Added frontend viewport fallback coverage for runtimes without `matchMedia`.
- 2026-06-07: Disabled ChatSidebar new-chat creation while a create request is pending to prevent duplicate conversations.
- 2026-06-07: Added chat conversation cleanup coverage for stale sidebar load completions.
- 2026-06-07: Exposed ChatSidebar loading state so retry actions show pending feedback and cannot be spammed while loading.
- 2026-06-07: Fixed prepare-commit single-path staging so tracked and untracked paths remain separate arrays.
- 2026-06-07: Disabled ChatSidebar selection controls while conversation actions are busy.
