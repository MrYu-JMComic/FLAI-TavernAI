# 自定义状态栏

会话的状态栏编辑器和角色的“初始状态栏”均提供三种模式：内置样式、展示模板、代码模式。代码模式可以分别编辑 HTML、CSS、JavaScript，选择 HTML 或 Vue 3，并载入示例、展开预览。切换模式会保留当前编辑草稿。

## 编写代码

“自定义模板”（模式选择中的“展示模板”）也可以直接粘贴含 `<script>`、`onclick` 等事件属性或 `javascript:` 链接的 HTML，不用转换成 JSON 或切换编辑器。这类模板通过现有独立文档运行，保留主题、内置样式类和 `data-sb-action` 按钮；普通展示模板继续使用原有展示规则。

模板 HTML 中的 `{{HP}}`、条件与循环继续随状态变化；`<script>` 整个元素、事件属性和 JavaScript 链接保留原文，不参与占位符替换或变量推断。脚本内读取 `values.HP`、`api.getVariable('HP')`，需要跟随更新时注册 `api.onUpdate()`。变量更新不会重新执行脚本，并保留未被模板结构替换的 DOM 节点及其监听器。脚本可监听 `DOMContentLoaded`，使用外部脚本或 `type="module"`，数据脚本如 `type="application/json"` 保持为数据。

模板内容不再进行保存前的标签、事件、CSS、JavaScript 或占位符语法校验；代码运行错误直接显示在状态栏上方。AI 完善助手提供“预览状态栏”按钮，桌面位于标题操作区，手机位于更多菜单。预览使用当前未保存的角色草稿，可以测试折叠、事件按钮和变量变化；预览中的变量修改、快捷回复和发送操作仅用于展示，不会保存到角色或发出消息。

分区折叠由模板脚本自行控制时，只需使用 `data-sb-target` 指定目标，避免同时声明全栏 `data-sb-action="collapse"`；旧模板带有目标时也不会再触发全栏收起。进度宽度可写 `width: {{HP.percentage}}%` 或 `width: {{HP.percent}}`，后者已经包含百分号。旧模板误写 `{{HP.percent}}%`、`{{HP | percent}}%` 或 `{{@percent}}%` 时，渲染器会合并紧邻占位符的重复百分号，避免产生无效的 `22%%` 宽度；模板原文保持不变。完整分区模板见 [status-bar-accordion-template.html](examples/status-bar-accordion-template.html)。

```html
<section class="sb-card">
  <p>体力：{{HP}}</p>
  <button id="recover">恢复体力</button>
</section>
<script>
  document.getElementById('recover').addEventListener('click', () => {
    api.setVariable('HP', values.HP + 1);
  });
</script>
```

HTML 模式提供完整浏览器文档，可以使用原生脚本、事件属性、表单、媒体、外部资源和任意 CSS。Vue 模式将 HTML 作为 Vue 模板，支持指令、事件、组件与响应式绑定。Vue 已随应用提供，无需引用 CDN。

两种模式均提供：

| 名称 | 用途 |
| --- | --- |
| `Vue` | Vue 3 API，包括 `ref`、`computed`、`watch` 等 |
| `variables` | 响应式变量数组，包含名称、值、类型和范围等元数据 |
| `values` | 按名称访问值，例如 `values['体力']` |
| `context` | 当前 `user`、`char` 上下文 |
| `api.state` | 状态栏名称、ID 和会话 ID |

JavaScript 作为可异步执行的函数体运行。Vue 模式中 `return { ... }` 可以提供额外模板绑定，生命周期钩子应在 `await` 前注册。HTML 模式可以直接访问 `document` 操作页面。

```html
<section>
  <h3>{{ context.char }}</h3>
  <p>体力：{{ values['体力'] }}</p>
  <button @click="api.setVariable('体力', values['体力'] + 1)">恢复体力</button>
  <small>已运行 {{ seconds }} 秒</small>
</section>
```

```js
const seconds = Vue.ref(0);
const timer = setInterval(() => seconds.value++, 1000);
api.onCleanup(() => clearInterval(timer));
return { seconds };
```

## 交互 API

| 调用 | 效果 |
| --- | --- |
| `api.getVariable(name)` | 获取变量及其元数据 |
| `api.setVariable(name, value)` | 修改或新增单个变量并保存 |
| `api.updateVariables([{ name, value }])` | 批量修改并保存变量 |
| `api.quickReply(text)` | 把文字加入聊天输入框 |
| `api.send(text)` | 发送聊天消息；忙碌时加入输入框 |
| `api.openSettings()` | 打开状态栏所属设置 |
| `api.onUpdate(callback)` | 监听状态和上下文更新，返回取消监听函数 |
| `api.onCleanup(callback)` | 注册代码替换或卸载时的清理函数 |

变量同步不会重新执行脚本；修改代码会重新加载。定时器和外部监听可在 `onCleanup` 中释放。运行错误会显示在状态栏上方，可以重新运行。

代码配置保存在原有 `template` 字段中，沿用角色蓝图、模板导入导出和会话快照。整个模板上限为 50,000 字符。变量需要明确添加，不会从 Vue 表达式或 JavaScript 中推断。

## 状态栏 Agent

在“附属技能”中打开“状态栏 Agent 设置”，可独立选择服务商配置、模型 ID、思考等级和工具权限。角色设置用于新会话的默认值，会话内可以单独调整。空思考等级跟随服务商，`off` 明确关闭，其余等级按模型支持的范围生效。

Agent 可以读取完整状态、按名称新增或修改变量、移除指定变量、修改名称、替换模板片段，以及单独修改 HTML、CSS、JavaScript 或框架模式。精确替换默认要求原文只匹配一次；不匹配时返回错误并保留原内容。禁用工具后，该工具不会提供给模型，也不能通过执行路径调用。

通过已有状态栏更新规则指定跟踪内容和修改要求。旧展示模板会自动推断占位符变量，因此删除或重命名前需先修改相应占位符；工具会提示仍存在的引用。
