import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH=':memory:';
process.env.APP_SECRET='memory-integration-contract-tests';
const {createAppDatabase}=await import('../db/runtime.js');
const {insertUser}=await import('./routeTestUtils.js');
const {createCharacter}=await import('../modules/characters.js');
const {upsertStatusBar,getStatusBar}=await import('../modules/statusBars.js');
const {createDomainPlanningSession}=await import('../services/conversationMemory/domainPlanning.js');
const {withSavepoint}=await import('../modules/savepoint.js');
const {submitJob,claimNextJob,completeJob,failJob,cancelJob,finishCancelledJob,cancelConversationJobs,getConversationProcessingSummary}=await import('../services/jobs/jobQueue.js');
const {prepareMemoryGeneration}=await import('../services/conversationMemory/processingPolicy.js');
const {getConversationForUser}=await import('../routes/helpers.js');
const {commitMemoryPacket,getMemoryProcessingState}=await import('../services/conversationMemory/commit.js');
const {runMemorySummaryJob}=await import('../services/conversationMemory/derivedJobs.js');
const {resolveMemoryContextSync}=await import('../services/conversationMemory/context.js');
const {runConversationPostprocessing}=await import('../services/jobs/conversationPostprocessing.js');
const {createConversationMemoriesRouter}=await import('../routes/conversationMemories.js');
const {withServer}=await import('./routeTestUtils.js');
const {default:express}=await import('express');

function fixture(t) {
  const database=createAppDatabase(':memory:');t.after(()=>database.close());const userId='integration-user';insertUser(database,userId);
  const character=createCharacter(database,userId,{name:'米拉'});const conversationId='integration-conversation';
  database.prepare(`INSERT INTO conversations(id,user_id,character_id,title,created_at,updated_at,state_status)
    VALUES(?,?,?,'记忆测试','2026-11-01','2026-11-01','ready')`).run(conversationId,userId,character.id);
  const message=(id,text)=>{database.prepare(`INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,'assistant',?,?)`)
    .run(id,userId,conversationId,text,`2026-11-01T00:00:${String(database.prepare('SELECT COUNT(*) n FROM messages').get().n).padStart(2,'0')}Z`);return id;};
  const job=(type,key,extra={})=>submitJob(database,userId,type,{conversationId,timelineRevision:1,requiredStages:['memory'],...extra},{internal:true,idempotencyKey:key});
  return {database,userId,character,conversationId,message,job};
}

test('failed core blocks later core while derived tasks retain independent scoped cancellation',t=>{
  const f=fixture(t);const first=f.job('conversation.postprocess','first');f.job('conversation.postprocess','second');
  const derived=f.job('memory.index','derived',{memoryRevision:0});
  const claimed=claimNextJob(f.database,'core',{types:['conversation.postprocess']});assert.equal(claimed.id,first.id);
  failJob(f.database,claimed.id,claimed.leaseOwner,new Error('broken'));
  assert.equal(claimNextJob(f.database,'next',{types:['conversation.postprocess']}),null);
  assert.equal(claimNextJob(f.database,'index',{types:['memory.index']}).id,derived.id);
  assert.equal(getConversationProcessingSummary(f.database,f.userId,f.conversationId).coreReady,false);
  assert.equal(cancelConversationJobs(f.database,f.userId,f.conversationId).length,3);
});

for (const terminal of ['failed','cancelled']) for (const requirement of ['optional','required','legacy']) {
  test(`${terminal} ${requirement} core preserves the required-only recovery scheduling boundary`,t=>{
    const f=fixture(t);
    const requiredStages=requirement==='optional'?[]:requirement==='legacy'?undefined:['memory'];
    const first=f.job('conversation.postprocess','first',{requiredStages});
    const second=f.job('conversation.postprocess','second');
    const claimed=claimNextJob(f.database,'first-worker',{types:['conversation.postprocess']});
    assert.equal(claimed.id,first.id,'the earlier queued job keeps its serial position');
    assert.equal(claimNextJob(f.database,'parallel-worker',{types:['conversation.postprocess']}),null,'running raw work remains serial');
    if (terminal==='failed') failJob(f.database,claimed.id,claimed.leaseOwner,new Error('fixture core failed'));
    else {
      cancelJob(f.database,f.userId,claimed.id);
      assert.equal(claimNextJob(f.database,'cancelling-worker',{types:['conversation.postprocess']}),null,'cancellation does not bypass a running lease');
      finishCancelledJob(f.database,claimed.id,claimed.leaseOwner);
    }
    const next=claimNextJob(f.database,'next-worker',{types:['conversation.postprocess']});
    if (requirement==='optional') assert.equal(next.id,second.id);
    else assert.equal(next,null,`${requirement} failure still requires repair`);
  });
}

test('generation waits outside the lock and failed core preserves unaccepted input',async t=>{
  const f=fixture(t);f.job('conversation.postprocess','wait');const claimed=claimNextJob(f.database,'worker');
  const current=()=>({...getConversationForUser(f.database,f.userId,f.conversationId),settings:{accessorySkills:{cgScene:{enabled:true},memoryAgent:{enabled:false,memoryPolicy:{syncMode:'blocking'}}}}});
  const pending=prepareMemoryGeneration(f.database,f.userId,current);
  assert.equal(f.database.prepare('SELECT active_generation_id FROM conversations').get().active_generation_id,'');
  completeJob(f.database,claimed.id,claimed.leaseOwner,{});
  const prepared=await pending;assert.equal(prepared.summary.coreReady,true);
  f.job('conversation.postprocess','fail');const next=claimNextJob(f.database,'worker');failJob(f.database,next.id,next.leaseOwner,new Error('failed'));
  await assert.rejects(prepareMemoryGeneration(f.database,f.userId,current),error=>error.code==='MEMORY_CORE_FAILED'&&error.accepted===false);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM messages').get().n,0);
});

test('generation rejects known invalid timelines without waiting or accepting input',async t=>{
  const f=fixture(t);
  f.job('memory.index','derived');
  const wait=t.mock.method(globalThis,'setTimeout',()=>assert.fail('invalid state must not enter the core wait loop'));
  for (const state of ['needs_rebuild','stale','legacy_partial']) {
    f.database.prepare('UPDATE conversations SET state_status=? WHERE id=?').run(state,f.conversationId);
    let reads=0;
    const current=()=>{
      reads++;
      return {...getConversationForUser(f.database,f.userId,f.conversationId),settings:{accessorySkills:{cgScene:{enabled:true},memoryAgent:{enabled:false}}}};
    };
    const before=f.database.prepare('SELECT total_changes() n').get().n;
    await assert.rejects(prepareMemoryGeneration(f.database,f.userId,current),
      error=>error.code==='CONVERSATION_STATE_REBUILD_REQUIRED'&&error.status===409&&error.accepted===false);
    assert.equal(reads,1);
    assert.equal(f.database.prepare('SELECT total_changes() n').get().n,before);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM messages').get().n,0);
    assert.equal(f.database.prepare('SELECT active_generation_id FROM conversations').get().active_generation_id,'');
  }
  assert.equal(wait.mock.callCount(),0);
});

test('generation retains raw and no-summary bypasses for invalid timelines',async t=>{
  const f=fixture(t);
  f.database.prepare("UPDATE conversations SET state_status='stale' WHERE id=?").run(f.conversationId);
  const current=required=>({...getConversationForUser(f.database,f.userId,f.conversationId),
    settings:{accessorySkills:{cgScene:{enabled:required},memoryAgent:{enabled:false}}}});
  assert.equal((await prepareMemoryGeneration(f.database,f.userId,()=>current(true))).summary,null);
  f.job('memory.index','derived');
  const raw=await prepareMemoryGeneration(f.database,f.userId,()=>current(false));
  assert.deepEqual(raw.effective.requiredStages,[]);
  assert.equal(raw.summary.coreReady,false);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM messages').get().n,0);
});

test('authoritative domain plans remain private until atomic apply and reject concurrent edits',t=>{
  const f=fixture(t);upsertStatusBar(f.database,f.userId,f.conversationId,{variables:[{name:'HP',value:80}]});
  const plan=createDomainPlanningSession(f.database,f.userId,f.conversationId);t.after(()=>plan.close());
  upsertStatusBar(plan.database,f.userId,f.conversationId,{variables:[{name:'HP',value:40}]});
  assert.equal(getStatusBar(f.database,f.userId,f.conversationId).variables[0].value,80);
  assert.throws(()=>withSavepoint(f.database,'test_plan',()=>{plan.apply();throw new Error('receipt failed');}),/receipt failed/);
  assert.equal(getStatusBar(f.database,f.userId,f.conversationId).variables[0].value,80);
  withSavepoint(f.database,'test_plan',()=>plan.apply());
  assert.equal(getStatusBar(f.database,f.userId,f.conversationId).variables[0].value,40);
  const raced=createDomainPlanningSession(f.database,f.userId,f.conversationId);t.after(()=>raced.close());
  upsertStatusBar(raced.database,f.userId,f.conversationId,{variables:[{name:'HP',value:20}]});
  upsertStatusBar(f.database,f.userId,f.conversationId,{variables:[{name:'HP',value:60}]});
  assert.throws(()=>raced.apply(),error=>error.code==='MEMORY_DOMAIN_CHANGED');
});

test('hierarchical summary output is committed independently and source races never roll back core',async t=>{
  const f=fixture(t);const text=Array.from({length:20},(_,i)=>`第${i}次承诺仍未兑现。`).join('');const messageId=f.message('story',text);
  const receipt=commitMemoryPacket(f.database,f.userId,f.conversationId,{messageId,sources:[{messageId,revision:1}],
    events:Array.from({length:20},(_,i)=>({key:`event-${i}`,kind:'promise',content:`第${i}次承诺仍未兑现。`,truthStatus:'established',
      evidence:[{messageId,quote:`第${i}次承诺仍未兑现。`}]}))});
  f.job('memory.summarize','summarize',{memoryRevision:receipt.revision});const job=claimNextJob(f.database,'summary');
  const summarySources=[];
  const result=await runMemorySummaryJob(f.database,{job,payload:job.payload,signal:new AbortController().signal},
    {settings:{providerType:'custom',model:'summary',baseUrl:'https://example.test',apiKey:'x'},summarize:async messages=>{
      summarySources.push(JSON.parse(messages[1].content).map(row=>row.text));return {content:'米拉多次承诺，仍待兑现。'};
    }});
  assert.ok(result.summaries>=3);
  assert.deepEqual(summarySources[0],Array.from({length:16},(_,i)=>`第${i}次承诺仍未兑现。`));
  assert.deepEqual(summarySources[1],Array.from({length:4},(_,i)=>`第${i+16}次承诺仍未兑现。`));
  assert.ok(f.database.prepare("SELECT id FROM memory_summaries WHERE level='chapter'").get());
  const core=getMemoryProcessingState(f.database,f.userId,f.conversationId);
  f.database.prepare('UPDATE conversation_memory_state SET revision=revision+1 WHERE conversation_id=?').run(f.conversationId);
  await assert.rejects(runMemorySummaryJob(f.database,{job,payload:job.payload},{}),error=>error.code==='JOB_SOURCE_STALE');
  assert.equal(getMemoryProcessingState(f.database,f.userId,f.conversationId).coreOrder,core.coreOrder);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_events').get().n,20);
});

test('actor context excludes author summaries that reveal the truth behind a false belief',t=>{
  const f=fixture(t);const messageId=f.message('lie','钥匙藏在地窖，诺尔却被告知在阁楼。');
  const receipt=commitMemoryPacket(f.database,f.userId,f.conversationId,{messageId,sources:[{messageId,revision:1}],
    entities:[{key:'noel',name:'诺尔',kind:'actor'},{key:'mira',name:'米拉',kind:'actor'}],events:[{key:'key',kind:'event',content:'钥匙在地窖',visibility:'restricted',actorIds:['mira'],truthStatus:'established',evidence:[{messageId,quote:'钥匙藏在地窖'}]}],
    knowledge:[{actorKey:'noel',eventKey:'key',epistemicState:'false_belief',beliefContent:'钥匙在阁楼'}]});
  const actorId=f.database.prepare("SELECT id FROM memory_entities WHERE name='诺尔'").get().id;
  f.database.prepare(`INSERT INTO memory_summaries(id,user_id,conversation_id,level,content,start_order,end_order,source_hash,profile_fingerprint,status,created_at)
    VALUES('summary',?,?,'scene','钥匙真在地窖',1,1,'hash','test','active','now')`).run(f.userId,f.conversationId);
  const event=f.database.prepare('SELECT id,source_hash FROM memory_events').get();
  f.database.prepare('INSERT INTO memory_summary_dependencies(summary_id,event_id,source_hash) VALUES(?,?,?)').run('summary',event.id,event.source_hash);
  const context=resolveMemoryContextSync(f.database,{user:{id:f.userId},character:f.character,conversation:{id:f.conversationId,settings:{accessorySkills:{memoryAgent:{memoryPolicy:{isolation:'actor',actorId}}}}}});
  assert.equal(context.summaries.length,0);assert.ok(context.memory.context.includes('阁楼'));assert.ok(!context.memory.context.includes('地窖'));
  assert.equal(receipt.revision,1);
});

test('synchronous savepoints reject Promise callbacks and roll back immediate writes',t=>{
  const f=fixture(t);
  assert.throws(()=>withSavepoint(f.database,'test_async',()=>{
    f.database.prepare("UPDATE conversations SET title='bad' WHERE id=?").run(f.conversationId);return Promise.resolve();
  }),/must be synchronous/);
  assert.equal(f.database.prepare('SELECT title FROM conversations').get().title,'记忆测试');
});

test('postprocessing accepts staged memory and domain changes together, then reuses one durable receipt',async t=>{
  const f=fixture(t);const messageId=f.message('accepted','米拉打开了城门。');
  f.database.prepare("UPDATE messages SET postprocess_state='pending' WHERE id=?").run(messageId);
  upsertStatusBar(f.database,f.userId,f.conversationId,{variables:[{name:'门',value:'关闭'}]});
  const queued=f.job('conversation.postprocess','atomic-turn',{assistantMessageId:messageId,assistantRevision:1});
  const job=claimNextJob(f.database,'worker',{types:['conversation.postprocess']});assert.equal(job.id,queued.id);
  let domainCalls=0;
  const options={
    runMemoryAgent:async input=>({mode:'prepared',packet:{events:[{kind:'event',content:'米拉打开了城门',truthStatus:'established'}]},
      commit:({applyDomainPlan,enqueueDerived})=>commitMemoryPacket(f.database,f.userId,f.conversationId,{
        idempotencyKey:input.idempotencyKey,messageId,sources:[{messageId,revision:1}],events:[{key:'open',kind:'event',content:'米拉打开了城门',truthStatus:'established',evidence:[{messageId,quote:'米拉打开了城门'}]}]
      },{applyActions:()=>applyDomainPlan(),enqueueDerived})}),
    runAccessoryAgents:async ({db,extractionPacket})=>{
      domainCalls++;assert.equal(extractionPacket.events[0].content,'米拉打开了城门');
      assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_events').get().n,0);
      upsertStatusBar(db,f.userId,f.conversationId,{variables:[{name:'门',value:'打开'}]});
      assert.equal(getStatusBar(f.database,f.userId,f.conversationId).variables[0].value,'关闭');
      return [{skill:'statusBar',ok:true}];
    }
  };
  const environment={job,payload:job.payload,signal:new AbortController().signal};
  const receipt=await runConversationPostprocessing(f.database,environment,options);
  assert.equal(receipt.memories,1);
  assert.equal(getStatusBar(f.database,f.userId,f.conversationId).variables[0].value,'打开');
  const derivedCount=()=>f.database.prepare("SELECT COUNT(*) n FROM jobs WHERE conversation_id=? AND stage<>'core'").get(f.conversationId).n;
  const count=derivedCount();assert.ok(count>0);
  assert.deepEqual(await runConversationPostprocessing(f.database,environment,options),receipt);
  assert.equal(domainCalls,1);assert.equal(derivedCount(),count);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_commits').get().n,1);
});

test('author packet HTTP is revision guarded and idempotent, with safe actor workbench output',async t=>{
  const f=fixture(t);const app=express();app.use(express.json());
  app.use('/api',createConversationMemoriesRouter({db:f.database,requireAuth:(request,response,next)=>{request.auth={user:{id:f.userId}};next();}}));
  await withServer(app,async base=>{
    const url=`${base}/api/conversations/${f.conversationId}/memory-state`;
    const send=body=>fetch(`${url}/packet`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const packet={idempotencyKey:'author-retry',entities:[{key:'mira',name:'米拉',kind:'actor'},{key:'noel',name:'诺尔',kind:'actor'}],
      events:[{key:'secret',kind:'event',content:'钥匙藏在地窖',visibility:'restricted',actorIds:['mira'],truthStatus:'established'}],
      knowledge:[{actorKey:'noel',eventKey:'secret',epistemicState:'false_belief',beliefContent:'钥匙藏在阁楼'}],
      threads:[{eventKey:'secret',kind:'clue',title:'钥匙藏在地窖',resolutionTrigger:'诺尔发现地窖中的真钥匙'}]};
    assert.equal((await send({packet})).status,400);
    const first=await send({expectedRevision:0,packet});assert.equal(first.status,200);const accepted=await first.json();
    const retry=await send({expectedRevision:0,packet});assert.equal(retry.status,200);assert.equal((await retry.json()).commitId,accepted.commitId);
    const stale=await send({expectedRevision:0,packet:{...packet,idempotencyKey:'different-edit'}});assert.equal(stale.status,409);
    const author=await fetch(url).then(response=>response.json());assert.equal(author.events.length,1);
    const actorId=author.entities.find(row=>row.name==='诺尔').id;
    const actor=await fetch(`${url}?actorId=${encodeURIComponent(actorId)}`).then(response=>response.json());
    assert.equal(actor.events[0].content,'钥匙藏在阁楼');assert.equal(actor.events[0].evidenceRefs.length,0);
    assert.equal(actor.claims.length,0);assert.equal(actor.summaries.length,0);
    assert.equal(actor.threads.length,0);
    assert.ok(!JSON.stringify(actor).includes('钥匙藏在地窖'));
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_commits').get().n,1);
  });
});

test('a rejected evidence packet rolls back its planned domain write and creates no core receipt or outbox',async t=>{
  const f=fixture(t);const messageId=f.message('rejected','米拉尝试打开城门。');
  upsertStatusBar(f.database,f.userId,f.conversationId,{variables:[{name:'门',value:'关闭'}]});
  f.job('conversation.postprocess','rejected-turn',{assistantMessageId:messageId,assistantRevision:1});
  const job=claimNextJob(f.database,'worker',{types:['conversation.postprocess']});
  await assert.rejects(runConversationPostprocessing(f.database,{job,payload:job.payload,signal:new AbortController().signal},{
    runMemoryAgent:async()=>({mode:'prepared',packet:{events:[]},commit:({applyDomainPlan,enqueueDerived})=>
      commitMemoryPacket(f.database,f.userId,f.conversationId,{messageId,sources:[{messageId,revision:1}],
        events:[{key:'invalid',kind:'event',content:'城门打开',evidence:[{messageId:'not-in-this-turn',quote:'城门打开'}]}]},
      {applyActions:()=>applyDomainPlan(),enqueueDerived})}),
    runAccessoryAgents:async ({db})=>{upsertStatusBar(db,f.userId,f.conversationId,{variables:[{name:'门',value:'打开'}]});return [{skill:'statusBar',ok:true}];}
  }),/事件证据不在本轮/);
  assert.equal(getStatusBar(f.database,f.userId,f.conversationId).variables[0].value,'关闭');
  for(const table of ['memory_commits','memory_events','memory_source_versions'])assert.equal(f.database.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM jobs WHERE stage<>'core'").get().n,0);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM job_steps WHERE step_key='core'").get().n,0);
});
