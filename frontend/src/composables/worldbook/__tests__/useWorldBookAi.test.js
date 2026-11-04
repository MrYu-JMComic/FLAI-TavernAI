import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useWorldBookAi } from '../useWorldBookAi.js';
import { applyWorldBookChanges, fetchWorldBook, streamWorldBookDraft } from '../../../api/worldBooks.js';

vi.mock('../../../api/worldBooks.js', () => ({ streamWorldBookDraft: vi.fn(), applyWorldBookChanges: vi.fn(), fetchWorldBook: vi.fn() }));
vi.mock('../../useAssistantRuntimePreferences', () => ({ useAssistantRuntimePreferences: () => ({ assistantModel: ref(''), assistantPlanMode: ref(false), assistantStreamingEnabled: ref(false), assistantThinkingLevel: ref('off') }) }));

const workspace = () => ({ version: 1, activeRef: 'existing:a', targets: [{ ref:'existing:a', bookId:'a', baseRevision:'base', profile:{ name:'原书' }, profilePatch:{description:'补充'}, upserts:[], removals:[] }, { ref:'new:b', bookId:null, profile:{name:'新书'}, entries:[{name:'航线',content:'航线设定',triggerKeys:'航线'}], profilePatch:{}, upserts:[], removals:[] }] });
const changes = () => [{ref:'existing:a',bookId:'a',baseRevision:'base',profile:{description:'补充'},upserts:[],removals:[]},{ref:'new:b',bookId:null,profile:{name:'新书'},entries:[{name:'航线',content:'航线设定',triggerKeys:'航线'}]}];
function createAssistant() {
  const scope=effectScope();
  const notify={warning:vi.fn(),error:vi.fn(),success:vi.fn(),info:vi.fn()};
  const assistant=scope.run(() => useWorldBookAi({providerRef:ref(null),notify}));
  return {...assistant,scope,notify};
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('world book assistant conversation and saving', () => {
  it('continues the latest pending workspace and accepts a read-only reply', async () => {
    const ai=createAssistant();
    ai.setSelectedBookIds(['a']);
    streamWorldBookDraft.mockResolvedValueOnce({workspace:workspace(),changes:changes(),reply:'已整理更新与新建。'});
    ai.aiRequirement.value='更新当前书，另外创建新书';
    await ai.completeWorldBookWithAi();
    expect(ai.aiChanges.value).toHaveLength(2);
    expect(ai.aiRequirement.value).toBe('');
    streamWorldBookDraft.mockResolvedValueOnce({workspace:workspace(),changes:changes(),reply:'航线位于东海。'});
    ai.aiRequirement.value='解释刚才的航线';
    await ai.completeWorldBookWithAi();
    expect(streamWorldBookDraft.mock.calls[1][0]).toMatchObject({selectedBookIds:['a'],workspace:workspace(),history:[{role:'user',content:'更新当前书，另外创建新书'},{role:'assistant',content:'已整理更新与新建。'}]});
    expect(ai.aiStatus.value).toBe('completed');
    expect(ai.aiHistory.value.at(-1).content).toBe('航线位于东海。');
    expect(ai.notify.warning).not.toHaveBeenCalled();
    ai.scope.stop();
  });
  it('retains a streamed checkpoint after pause and ignores an older run stream', async () => {
    const ai=createAssistant();
    let oldHandlers;
    streamWorldBookDraft.mockImplementationOnce(async (_payload,handlers) => { oldHandlers=handlers; handlers.workspace({workspace:workspace(),changes:changes()}); return {aborted:true}; });
    ai.aiRequirement.value='补充';
    await ai.completeWorldBookWithAi();
    expect(ai.aiStatus.value).toBe('paused');
    expect(ai.aiChanges.value).toHaveLength(2);
    // Cancellation must invalidate stream callbacks even without a route change.
    ai.cancelWorldBookAi();
    oldHandlers.workspace({workspace:{targets:[]},changes:[]});
    expect(ai.aiChanges.value).toHaveLength(2);
    ai.scope.stop();
  });
  it('keeps a cancelled in-flight run resumable with its streamed checkpoint', async () => {
    const ai=createAssistant();
    let oldHandlers;
    let rejectRun;
    ai.aiRequirement.value='补充';
    streamWorldBookDraft.mockImplementationOnce((_payload, handlers, signal) => {
      oldHandlers=handlers;
      signal.addEventListener('abort', () => rejectRun(new DOMException('Aborted', 'AbortError')), { once: true });
      return new Promise((_resolve, reject) => { rejectRun=reject; });
    });
    const run=ai.completeWorldBookWithAi();
    oldHandlers.workspace({workspace:workspace(),changes:changes()});
    ai.cancelWorldBookAi();
    await run;
    expect(ai.aiLoading.value).toBe(false);
    expect(ai.aiStatus.value).toBe('paused');
    expect(ai.aiChanges.value).toHaveLength(2);
    oldHandlers.workspace({workspace:{targets:[]},changes:[]});
    expect(ai.aiChanges.value).toHaveLength(2);
    ai.scope.stop();
  });
  it.each(['available', 'unavailable'])('retries with the same request identity and rebases applied targets without dropping unchecked drafts (randomUUID %s)', async availability => {
    if (availability === 'unavailable') vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ai=createAssistant();
    ai.aiWorkspace.value=workspace(); ai.aiChanges.value=changes();
    applyWorldBookChanges.mockRejectedValueOnce(new Error('网络中断'));
    await ai.applyAiWorldBookChanges([changes()[0]]);
    expect(applyWorldBookChanges.mock.calls[0][0].requestId).toEqual(expect.any(String));
    expect(applyWorldBookChanges.mock.calls[0][0].requestId.length).toBeGreaterThan(0);
    applyWorldBookChanges.mockResolvedValueOnce({books:[{ref:'existing:a',book:{id:'a',revision:'saved',name:'原书',description:'补充',entries:[]}}]});
    await ai.applyAiWorldBookChanges([changes()[0]]);
    expect(applyWorldBookChanges.mock.calls[0][0].requestId).toBe(applyWorldBookChanges.mock.calls[1][0].requestId);
    expect(ai.aiChanges.value.map(change => change.ref)).toEqual(['new:b']);
    expect(ai.aiWorkspace.value.targets[0]).toMatchObject({ref:'existing:a',baseRevision:'saved',profilePatch:{},upserts:[],removals:[]});
    expect(ai.aiWorkspace.value.targets[1].entries).toHaveLength(1);
    ai.scope.stop();
  });
  it('reports request preparation errors and leaves the pending changes ready to retry', async () => {
    const ai=createAssistant();
    ai.aiWorkspace.value=workspace(); ai.aiChanges.value=changes();
    await expect(ai.applyAiWorldBookChanges([{ ...changes()[0], upserts: {} }])).resolves.toBeUndefined();
    expect(ai.notify.error).toHaveBeenCalledOnce();
    expect(applyWorldBookChanges).not.toHaveBeenCalled();
    expect(ai.aiSaving.value).toBe(false);
    expect(ai.aiChanges.value).toHaveLength(2);
    applyWorldBookChanges.mockResolvedValueOnce({books:[{ref:'existing:a',book:{id:'a',name:'原书'}}]});
    await ai.applyAiWorldBookChanges([changes()[0]]);
    expect(applyWorldBookChanges).toHaveBeenCalledOnce();
    expect(ai.notify.success).toHaveBeenCalledOnce();
    ai.scope.stop();
  });
  it('locks an approved plan to its returned target and preserves its server scope', async () => {
    const ai=createAssistant();
    ai.assistantPlanMode.value=true; ai.setSelectedBookIds(['a']); ai.aiRequirement.value='补充规则';
    streamWorldBookDraft.mockResolvedValueOnce({phase:'plan',workspace:workspace(),changes:[],plan:{worldBookScope:'scope-hash',steps:[{id:'one',section:'entries',intent:'补充规则'}]}});
    await ai.completeWorldBookWithAi();
    streamWorldBookDraft.mockResolvedValueOnce({workspace:workspace(),changes:changes(),reply:'完成'});
    await ai.executeWorldBookPlan();
    expect(streamWorldBookDraft.mock.calls[1][0]).toMatchObject({selectedBookIds:['a'],workspace:workspace(),plan:{worldBookScope:'scope-hash',approved:true}});
    expect(ai.aiPlan.value).toBeNull();
    ai.scope.stop();
  });
  it.each(['paused', 'failed'])('keeps the latest execution workspace after %s and replans from it', async status => {
    const ai=createAssistant();
    ai.assistantPlanMode.value=true; ai.aiRequirement.value='补充规则';
    streamWorldBookDraft.mockResolvedValueOnce({phase:'plan',workspace:{targets:[]},plan:{worldBookScope:'scope-hash',steps:[{id:'one',section:'entries',intent:'补充规则'}]}});
    await ai.completeWorldBookWithAi();
    streamWorldBookDraft.mockImplementationOnce(async (_payload, handlers) => {
      handlers.workspace({workspace:workspace(),changes:changes()});
      if (status === 'failed') throw new Error('连接断开');
      return {aborted:true};
    });
    await ai.executeWorldBookPlan();
    expect(ai.aiStatus.value).toBe(status);
    expect(ai.aiPlan.value).toBeNull();
    expect(ai.aiChanges.value).toHaveLength(2);
    streamWorldBookDraft.mockResolvedValueOnce({phase:'plan',workspace:workspace(),plan:{steps:[{id:'next',intent:'继续'}]}});
    await ai.completeWorldBookWithAi();
    expect(streamWorldBookDraft.mock.calls[2][0].workspace).toEqual(workspace());
    ai.scope.stop();
  });
  it('clears an earlier plan when continuing the conversation without executing it', async () => {
    const ai=createAssistant();
    ai.assistantPlanMode.value=true; ai.aiRequirement.value='先规划';
    streamWorldBookDraft.mockResolvedValueOnce({phase:'plan',workspace:workspace(),plan:{steps:[{id:'old',intent:'旧计划'}]}});
    await ai.completeWorldBookWithAi();
    ai.assistantPlanMode.value=false; ai.aiRequirement.value='按新要求继续';
    streamWorldBookDraft.mockResolvedValueOnce({workspace:workspace(),changes:changes(),reply:'新结果'});
    await ai.completeWorldBookWithAi();
    expect(ai.aiPlan.value).toBeNull();
    expect(ai.aiChanges.value).toHaveLength(2);
    await ai.executeWorldBookPlan();
    expect(streamWorldBookDraft).toHaveBeenCalledTimes(2);
    ai.scope.stop();
  });
  it('reloads one conflicting original without clearing other pending books', async () => {
    const ai=createAssistant();
    ai.aiWorkspace.value=workspace(); ai.aiChanges.value=changes();
    applyWorldBookChanges.mockRejectedValueOnce(new Error('原书已发生变化，请重新读取'));
    await ai.applyAiWorldBookChanges(changes());
    expect(ai.aiChanges.value).toHaveLength(2);
    fetchWorldBook.mockResolvedValueOnce({id:'a',revision:'latest',name:'最新原书',entries:[]});
    await ai.reloadAiWorldBook(changes()[0]);
    expect(ai.aiWorkspace.value.targets[0]).toMatchObject({baseRevision:'latest',profilePatch:{}});
    expect(ai.aiChanges.value.map(change => change.ref)).toEqual(['new:b']);
    ai.aiRequirement.value='以最新原书补充';
    streamWorldBookDraft.mockResolvedValueOnce({workspace:ai.aiWorkspace.value,changes:ai.aiChanges.value,reply:'完成'});
    await ai.completeWorldBookWithAi();
    expect(streamWorldBookDraft.mock.calls[0][0].workspace.targets[0].baseRevision).toBe('latest');
    ai.scope.stop();
  });
  it('discards an unavailable target while preserving another new draft for the next turn', async () => {
    const ai=createAssistant();
    ai.aiWorkspace.value=workspace(); ai.aiChanges.value=changes(); ai.setSelectedBookIds(['a']);
    ai.discardAiWorldBook(changes()[0]);
    expect(ai.aiChanges.value.map(change => change.ref)).toEqual(['new:b']);
    ai.aiRequirement.value='继续完成新书';
    streamWorldBookDraft.mockResolvedValueOnce({workspace:ai.aiWorkspace.value,changes:ai.aiChanges.value,reply:'完成'});
    await ai.completeWorldBookWithAi();
    expect(streamWorldBookDraft.mock.calls[0][0].selectedBookIds).toEqual([]);
    expect(streamWorldBookDraft.mock.calls[0][0].workspace.targets.map(target => target.ref)).toEqual(['new:b']);
    ai.scope.stop();
  });
});
