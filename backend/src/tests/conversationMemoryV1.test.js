import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH=':memory:';
process.env.APP_SECRET='test-memory-v1-contracts';
const {createAppDatabase}=await import('../db.js');
const {insertUser}=await import('./routeTestUtils.js');
const {createCharacter}=await import('../modules/characters.js');
const {createConversationMemory,updateConversationMemory,disableConversationMemory,listConversationMemories,pinConversationMemory}=await import('../modules/conversationMemories.js');
const {runConversationMemoryAgent}=await import('../services/conversationMemoryAgent.js');
const {commitMemoryPacket,captureMemoryCheckpoint,restoreMemoryCheckpoint,getMemoryProcessingState,ensureMemoryBaseline}=await import('../services/conversationMemory/commit.js');
const {listMemoryRecords,listMemoryEntities,captureMemoryPrefix,captureMemorySnapshot,resolveMemoryEntity,listCurrentMemoryKnowledge,listCurrentMemoryThreads,listCurrentMemoryClaims}=await import('../repositories/conversationMemoryRepository.js');
const {captureConversationSnapshot,restoreConversationSnapshot,writeConversationCheckpoint}=await import('../repositories/conversationSnapshotRepository.js');
const {branchConversation}=await import('../modules/branches.js');
const {searchUserContent}=await import('../services/fullTextSearch.js');
const {readMemoryWorkbench}=await import('../services/conversationMemory/workbench.js');

function setup(t) {
  const database=createAppDatabase(':memory:'); t.after(()=>database.close()); const userId='memory-v1-user';
  insertUser(database,userId); const character=createCharacter(database,userId,{name:'Mira'}); const conversationId='memory-v1-conversation';
  database.prepare(`INSERT INTO conversations(id,user_id,character_id,title,created_at,updated_at,state_status) VALUES(?,?,?,?,?,?,?)`).run(conversationId,userId,character.id,'Story','2026-01-01','2026-01-01','ready');
  const message=(id,content,role='assistant')=>{
    database.prepare('INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?,?)').run(id,userId,conversationId,role,content,`2026-01-${String(database.prepare('SELECT COUNT(*) AS n FROM messages').get().n+1).padStart(2,'0')}`);
    return {id,content,role};
  };
  const userMessage=message('user-1','I hand Mira the key.','user');
  const assistantMessage=message('assistant-1','Mira hides the key in the cellar and tells Noel it is in the attic.');
  const settings={providerType:'custom',baseUrl:'https://memory.test/v1',model:'memory-model',apiKey:'test-key'};
  const conversation={id:conversationId,settings:{accessorySkills:{memoryAgent:{enabled:true}}}};
  return {database,userId,conversationId,character,userMessage,assistantMessage,settings,conversation,message};
}

const recordTools=async(_settings,_messages,_tools,execute)=>{
  const result=await execute('record_memory',{memoryType:'event',content:'Mira received the key.',sourceMessageId:'user-1',quote:'I hand Mira the key.'});
  assert.equal(result.ok,true); await execute('finish_memory_review',{}); return {};
};

test('prepared extraction leaves projections and canonical facts untouched until one atomic commit',async t=>{
  const f=setup(t); const prepared=await runConversationMemoryAgent({...f,runTools:recordTools,prepareOnly:true});
  assert.equal(prepared.mode,'prepared');
  assert.equal(prepared.packet.events.length,1,'domain planners receive the same typed observation even when record_memory was used');
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM conversation_memories').get().n,0);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n,0);
  const before=getMemoryProcessingState(f.database,f.userId,f.conversationId);
  assert.throws(()=>prepared.commit({applyDomainPlan(){throw new Error('domain rejected');}}),/domain rejected/);
  assert.equal(getMemoryProcessingState(f.database,f.userId,f.conversationId).revision,before.revision);
  assert.equal(listConversationMemories(f.database,f.userId,f.conversationId).length,0);
  const receipt=prepared.commit({enqueueDerived(){ f.database.prepare("UPDATE conversations SET title='committed' WHERE id=?").run(f.conversationId); return {summary:'queued'}; }});
  assert.equal(receipt.accepted,1); assert.equal(receipt.jobs.summary,'queued');
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId).length,1);
  assert.equal(prepared.commit().duplicate,true);
});

test('provider failure after staging does not retain a half-applied fact',async t=>{
  const f=setup(t);
  await assert.rejects(()=>runConversationMemoryAgent({...f,retryDelaysMs:[],runTools:async(s,m,tools,execute)=>{
    await execute('record_memory',{memoryType:'event',content:'Mira received the key.',sourceMessageId:'user-1'});
    assert.equal(listConversationMemories(f.database,f.userId,f.conversationId).length,0);
    throw new Error('gateway lost');
  }}),/gateway lost/);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_commits').get().n,0);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n,0);
});

test('a lie keeps truth and false belief separate, and an uninformed actor cannot recall either',t=>{
  const f=setup(t);
  const receipt=commitMemoryPacket(f.database,f.userId,f.conversationId,{version:1,messageId:f.assistantMessage.id,sources:[{messageId:f.assistantMessage.id,revision:1}],
    entities:[{key:'mira',name:'Mira',kind:'actor'},{key:'noel',name:'Noel',kind:'actor'},{key:'outsider',name:'Outsider',kind:'actor'}],
    events:[{key:'hiding',kind:'event',content:'The key is in the cellar.',truthStatus:'established',visibility:'restricted',actorIds:['mira'],evidence:[{messageId:f.assistantMessage.id,quote:'Mira hides the key in the cellar'}]}],
    claims:[{eventKey:'hiding',subjectKey:'mira',predicate:'key_location',value:'cellar',truthStatus:'established'}],
    knowledge:[{eventKey:'hiding',actorKey:'mira',epistemicState:'experienced'},{eventKey:'hiding',actorKey:'noel',epistemicState:'false_belief',beliefContent:'The key is in the attic.'}]
  });
  const actors=Object.fromEntries(f.database.prepare('SELECT id,name FROM memory_entities').all().map(row=>[row.name,row.id]));
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId)[0].content,'The key is in the cellar.');
  const belief=listMemoryRecords(f.database,f.userId,f.conversationId,{actorId:actors.Noel})[0];
  assert.equal(belief.content,'The key is in the attic.'); assert.equal(belief.epistemicState,'false_belief');
  assert.equal(belief.truth_status,'false');
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId,{actorId:actors.Outsider}).length,0);
  assert.equal(receipt.packet.claims[0].value,'cellar');
});

test('current claims use the selected message count and keep facts until their future expiry',t=>{
  const f=setup(t);
  commitMemoryPacket(f.database,f.userId,f.conversationId,{
    messageId:'assistant-1',sources:[{messageId:'assistant-1',revision:1}],
    entities:[{key:'mira',name:'Mira',kind:'actor'}],
    events:[{key:'state',content:'Mira has the key.',evidence:[{messageId:'assistant-1',quote:'Mira hides the key'}]}],
    claims:[
      {eventKey:'state',subjectKey:'mira',predicate:'current_key',value:true,validFrom:1,validTo:4},
      {eventKey:'state',subjectKey:'mira',predicate:'future_key',value:true,validFrom:3},
      {eventKey:'state',subjectKey:'mira',predicate:'expired_key',value:true,validFrom:1,validTo:2}
    ]
  });
  const predicates=options=>listCurrentMemoryClaims(f.database,f.userId,f.conversationId,options).map(row=>row.predicate).sort();
  assert.deepEqual(predicates(),['current_key']);
  assert.deepEqual(predicates({asOfOrder:3}),['current_key','future_key']);
  assert.deepEqual(predicates({asOfOrder:4}),['future_key']);
});

test('explicit attempts cannot establish successful outcomes and source edits invalidate only dependent facts',t=>{
  const f=setup(t);
  commitMemoryPacket(f.database,f.userId,f.conversationId,{messageId:'assistant-1',sources:[{messageId:'assistant-1',revision:1}],events:[{key:'attempt',kind:'attempt',content:'Mira tries the lock.',truthStatus:'established',evidence:[{messageId:'assistant-1',quote:'Mira hides the key'}]}]});
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId)[0].truth_status,'unverified');
  const later=f.message('assistant-2','The door opens.');
  commitMemoryPacket(f.database,f.userId,f.conversationId,{messageId:later.id,sources:[{messageId:later.id,revision:1}],events:[{key:'door',content:'The door opens.',evidence:[{messageId:later.id,quote:'The door opens.'}]}]});
  f.database.prepare("UPDATE messages SET attachments_json='[{\"type\":\"image\",\"url\":\"changed\"}]' WHERE id=?").run(later.id);
  assert.deepEqual(listMemoryRecords(f.database,f.userId,f.conversationId).map(row=>row.kind),['attempt']);
});

test('checkpoint lineage restores old and later corrections without losing history or reviving discarded future',t=>{
  const f=setup(t);
  const first=createConversationMemory(f.database,f.userId,f.conversationId,{content:'key first',subject:'Mira'});
  const early=captureMemoryCheckpoint(f.database,f.userId,f.conversationId);
  const next=updateConversationMemory(f.database,f.userId,f.conversationId,first.id,{content:'key second',revision:first.revision});
  const later=captureMemoryCheckpoint(f.database,f.userId,f.conversationId);
  restoreMemoryCheckpoint(f.database,f.userId,f.conversationId,early);
  assert.deepEqual(listMemoryRecords(f.database,f.userId,f.conversationId).map(row=>row.content),['key first']);
  restoreMemoryCheckpoint(f.database,f.userId,f.conversationId,later);
  assert.deepEqual(listMemoryRecords(f.database,f.userId,f.conversationId).map(row=>row.content),['key second']);
  restoreMemoryCheckpoint(f.database,f.userId,f.conversationId,early);
  const current=listConversationMemories(f.database,f.userId,f.conversationId)[0];
  updateConversationMemory(f.database,f.userId,f.conversationId,current.id,{content:'key alternate',revision:current.revision});
  assert.deepEqual(listMemoryRecords(f.database,f.userId,f.conversationId).map(row=>row.content),['key alternate']);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n,3);
  const prefix=captureMemoryPrefix(f.database,f.userId,f.conversationId,early);
  assert.deepEqual(prefix.memory_events.map(row=>row.content),['key first']);
  assert.equal(next.revision,2);
});

test('candidate review exclusion applies consistently to lexical and canonical recall',t=>{
  const f=setup(t);
  const candidate=createConversationMemory(f.database,f.userId,f.conversationId,{content:'uniqueharborkey',sourceKind:'auto',enabled:false});
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId).length,0);
  assert.equal(searchUserContent(f.database,f.userId,'uniqueharborkey',{conversationId:f.conversationId,types:['memory']}).results.length,0);
  const active=createConversationMemory(f.database,f.userId,f.conversationId,{content:'uniqueharborkey confirmed'});
  disableConversationMemory(f.database,f.userId,f.conversationId,active.id);
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId).length,0);
  assert.equal(candidate.lifecycle,'candidate');
});

test('bootstrap retains opening provenance and cast, while adopted baseline describes incomplete history',t=>{
  const f=setup(t);
  const initial=ensureMemoryBaseline(f.database,f.userId,f.conversationId,{messageId:'assistant-1',entities:[{key:'mira',castKey:'main',name:'Mira',kind:'actor'}],sources:{characterId:f.character.id}});
  assert.equal(initial.baselineKind,'bootstrap'); assert.equal(initial.coreMessageId,'assistant-1');
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_entities').get().n,1);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_source_versions').get().n,1);
  const adopted=ensureMemoryBaseline(f.database,f.userId,f.conversationId,{kind:'adopted_baseline',messageId:'assistant-1'});
  assert.equal(adopted.baselineKind,'adopted_baseline');
  assert.match(f.database.prepare('SELECT baseline_json FROM conversation_memory_state').get().baseline_json,/not_extracted/);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n,0);
});

test('v2 restore rehydrates canonical review records and branch remaps immutable evidence once',t=>{
  const f=setup(t);
  createConversationMemory(f.database,f.userId,f.conversationId,{content:'harbor baseline',sourceMessageId:'assistant-1',sourceExcerpt:'Mira hides the key'});
  const old=captureConversationSnapshot(f.database,f.userId,f.conversationId); old.version=2; delete old.memory;
  restoreConversationSnapshot(f.database,f.userId,f.conversationId,old);
  assert.deepEqual(listMemoryRecords(f.database,f.userId,f.conversationId).map(row=>row.content),['harbor baseline']);
  f.database.prepare("UPDATE conversations SET state_status='ready' WHERE id=?").run(f.conversationId);
  writeConversationCheckpoint(f.database,f.userId,f.conversationId);
  const branch=branchConversation(f.database,f.userId,f.conversationId,'assistant-1');
  const parent=captureMemorySnapshot(f.database,f.userId,f.conversationId);
  const child=captureMemorySnapshot(f.database,f.userId,branch.id);
  assert.equal(child.memory_events.length,1); assert.notEqual(child.memory_events[0].id,parent.memory_events[0].id);
  assert.notEqual(child.memory_events[0].memory_id,parent.memory_events[0].memory_id);
  assert.notEqual(child.memory_source_versions[0].message_id,parent.memory_source_versions[0].message_id);
  assert.equal(f.database.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(listMemoryRecords(f.database,f.userId,branch.id)[0].content,'harbor baseline');
});

test('ambiguous aliases stay unresolved and cross-scope corrections roll back without a new commit',t=>{
  const f=setup(t);
  commitMemoryPacket(f.database,f.userId,f.conversationId,{entities:[{key:'north',name:'Mira North',kind:'actor',aliases:['Mira']},{key:'south',name:'Mira South',kind:'actor',aliases:['Mira']}]},{kind:'manual'});
  assert.equal(resolveMemoryEntity(f.database,f.userId,f.conversationId,'Mira'),null);
  const before=getMemoryProcessingState(f.database,f.userId,f.conversationId);
  assert.throws(()=>commitMemoryPacket(f.database,f.userId,f.conversationId,{entities:[{key:'ambiguous',name:'Mira',kind:'actor'}]},{kind:'manual'}),error=>error.code==='MEMORY_ENTITY_UNRESOLVED');
  assert.equal(listMemoryEntities(f.database,f.userId,f.conversationId).length,2,'an ambiguous name cannot silently create a third entity');
  assert.throws(()=>commitMemoryPacket(f.database,f.userId,f.conversationId,{events:[{content:'Mira has the key.',subjectEntityId:'Mira'}]},{kind:'manual'}),error=>error.code==='MEMORY_ENTITY_UNRESOLVED');
  assert.throws(()=>commitMemoryPacket(f.database,f.userId,f.conversationId,{events:[{content:'Intruder correction.',supersedesId:'foreign-event'}]},{kind:'manual'}),error=>error.status===409);
  assert.equal(getMemoryProcessingState(f.database,f.userId,f.conversationId).revision,before.revision);
});

test('aliases append to existing entities and remain isolated by commit, cutoff and copied branch',t=>{
  const f=setup(t);
  commitMemoryPacket(f.database,f.userId,f.conversationId,{messageId:'assistant-1',entities:[{key:'tower',name:'Moon tower',kind:'place',castKey:'tower',aliases:['Old tower']}]},{kind:'manual'});
  const early=captureMemoryCheckpoint(f.database,f.userId,f.conversationId);
  const tower=resolveMemoryEntity(f.database,f.userId,f.conversationId,'Old tower');
  const late=commitMemoryPacket(f.database,f.userId,f.conversationId,{entities:[{key:'tower',id:tower.id,name:'Moon tower',kind:'place',aliases:['Silver tower']}]},{kind:'manual'});
  assert.equal(resolveMemoryEntity(f.database,f.userId,f.conversationId,'Silver tower').id,tower.id);
  assert.equal(resolveMemoryEntity(f.database,f.userId,f.conversationId,'Silver tower',{commitId:early.commitId}),null);
  assert.equal(listMemoryEntities(f.database,f.userId,f.conversationId,{commitId:early.commitId})[0].aliases.includes('Silver tower'),false);
  assert.equal(captureMemoryPrefix(f.database,f.userId,f.conversationId,early).memory_entity_aliases.some(row=>row.alias==='Silver tower'),false);
  restoreMemoryCheckpoint(f.database,f.userId,f.conversationId,early);
  commitMemoryPacket(f.database,f.userId,f.conversationId,{idempotencyKey:'alternate-alias',entities:[{key:'tower',id:tower.id,name:'Moon tower',kind:'place',aliases:['Silver tower']}]},{kind:'manual'});
  assert.equal(resolveMemoryEntity(f.database,f.userId,f.conversationId,'Silver tower').id,tower.id,'a discarded branch cannot suppress re-learning the same alias');
  assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM memory_entity_aliases WHERE alias='Silver tower'").get().n,2);
  const laterMessage=f.message('assistant-2','The tower is now called Dawn tower.');
  commitMemoryPacket(f.database,f.userId,f.conversationId,{messageId:laterMessage.id,entities:[{key:'tower',id:tower.id,name:'Moon tower',kind:'place',aliases:['Dawn tower']}]},{kind:'manual'});
  assert.equal(resolveMemoryEntity(f.database,f.userId,f.conversationId,'Dawn tower',{asOfOrder:2}),null);
  assert.equal(resolveMemoryEntity(f.database,f.userId,f.conversationId,'Dawn tower',{asOfOrder:3}).id,tower.id);
  restoreMemoryCheckpoint(f.database,f.userId,f.conversationId,early);
  writeConversationCheckpoint(f.database,f.userId,f.conversationId,{throughMessageId:'assistant-1'});
  const branch=branchConversation(f.database,f.userId,f.conversationId,'assistant-1');
  assert.equal(resolveMemoryEntity(f.database,f.userId,branch.id,'Old tower').name,'Moon tower');
  assert.equal(resolveMemoryEntity(f.database,f.userId,branch.id,'Silver tower'),null);
  assert.equal(resolveMemoryEntity(f.database,f.userId,branch.id,'Dawn tower'),null);
  assert.equal(resolveMemoryEntity(f.database,f.userId,f.conversationId,'Silver tower',{commitId:late.commitId}).id,tower.id);
});

test('discarded alias collisions and cast keys cannot affect the selected commit lineage',t=>{
  const f=setup(t);
  commitMemoryPacket(f.database,f.userId,f.conversationId,{messageId:'assistant-1',idempotencyKey:'empty-cast'},{kind:'manual'});
  const early=captureMemoryCheckpoint(f.database,f.userId,f.conversationId);
  commitMemoryPacket(f.database,f.userId,f.conversationId,{entities:[
    {key:'first',name:'First',castKey:'new-cast',aliases:['Ghost']},
    {key:'second',name:'Second',aliases:['Ghost']},
    {key:'third',name:'Third',aliases:['Ghost']}
  ]},{kind:'manual'});
  assert.equal(resolveMemoryEntity(f.database,f.userId,f.conversationId,'Ghost'),null);
  restoreMemoryCheckpoint(f.database,f.userId,f.conversationId,early);
  commitMemoryPacket(f.database,f.userId,f.conversationId,{entities:[{key:'selected',name:'Selected',castKey:'new-cast',aliases:['Ghost']}]},{kind:'manual'});
  const selected=resolveMemoryEntity(f.database,f.userId,f.conversationId,'Ghost');
  assert.equal(selected.name,'Selected');
  assert.equal(selected.cast_key,'new-cast');
  assert.equal(resolveMemoryEntity(f.database,f.userId,f.conversationId,'First'),null);
  assert.equal(listMemoryEntities(f.database,f.userId,f.conversationId).length,1);
});

test('knowledge and plot-thread revisions obey pinned commit lineage at the same narrative order',t=>{
  const f=setup(t);
  const first=commitMemoryPacket(f.database,f.userId,f.conversationId,{entities:[{key:'mira',name:'Mira',kind:'actor'}],events:[{key:'secret',content:'Cellar key.',visibility:'restricted',actorIds:['mira']}],
    knowledge:[{eventKey:'secret',actorKey:'mira',epistemicState:'knows'}],threads:[{id:'promise',eventKey:'secret',kind:'promise',title:'Return the key.',status:'open'}]},{kind:'manual'});
  const actor=f.database.prepare("SELECT id FROM memory_entities WHERE name='Mira'").get().id;
  const eventId=first.eventIds[0];
  const second=commitMemoryPacket(f.database,f.userId,f.conversationId,{knowledge:[{eventId,actorEntityId:actor,epistemicState:'unknown'}],threads:[{id:'promise',eventId,status:'resolved'}]},{kind:'manual'});
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId,{actorId:actor}).length,0);
  assert.equal(listCurrentMemoryThreads(f.database,f.userId,f.conversationId)[0].status,'resolved');
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId,{actorId:actor,commitId:first.commitId})[0].content,'Cellar key.');
  assert.equal(listCurrentMemoryKnowledge(f.database,f.userId,f.conversationId,{commitId:first.commitId})[0].epistemic_state,'knows');
  assert.equal(listCurrentMemoryThreads(f.database,f.userId,f.conversationId,{commitId:first.commitId})[0].status,'open');
  const workbench=readMemoryWorkbench(f.database,f.userId,f.conversationId,{commitId:first.commitId});
  assert.equal(workbench.knowledge[0].epistemicState,'knows');
  assert.equal(workbench.threads[0].status,'open');
  restoreMemoryCheckpoint(f.database,f.userId,f.conversationId,{commitId:first.commitId,coreOrder:0,viewOrder:2});
  assert.equal(listCurrentMemoryThreads(f.database,f.userId,f.conversationId)[0].status,'open');
  assert.equal(listCurrentMemoryKnowledge(f.database,f.userId,f.conversationId)[0].epistemic_state,'knows');
  assert.notEqual(first.commitId,second.commitId);
});

test('canon filtering uses the current revision and never revives an old pin',t=>{
  const f=setup(t);
  const memory=createConversationMemory(f.database,f.userId,f.conversationId,{content:'Stable canon.'});
  const pinned=pinConversationMemory(f.database,f.userId,f.conversationId,memory.id,{pinned:true,revision:memory.revision});
  const checkpoint=captureMemoryCheckpoint(f.database,f.userId,f.conversationId);
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId,{layer:'canon'}).length,1);
  pinConversationMemory(f.database,f.userId,f.conversationId,memory.id,{pinned:false,revision:pinned.revision});
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId,{layer:'canon'}).length,0);
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId,{layer:'canon',commitId:checkpoint.commitId}).length,1);
});

test('an unfinished tool round cannot write facts or bypass evidence validation',async t=>{
  const f=setup(t);
  await assert.rejects(()=>runConversationMemoryAgent({...f,retryDelaysMs:[],runTools:async(_s,_m,_t,execute)=>{
    await execute('record_memory',{memoryType:'event',content:'Made-up key.',sourceMessageId:'foreign-message'});
    await execute('record_memory',{memoryType:'event',content:'Mira received the key.',sourceMessageId:'user-1'});
    return {};
  }}),error=>error.code==='MEMORY_AGENT_INCOMPLETE');
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n,0);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_source_versions').get().n,0);
});

test('manual epistemic metadata survives editing and author-only facts cannot enter an actor view',t=>{
  const f=setup(t);
  commitMemoryPacket(f.database,f.userId,f.conversationId,{entities:[{key:'mira',name:'Mira',kind:'actor'}]},{kind:'manual'});
  const actor=f.database.prepare('SELECT id FROM memory_entities').get().id;
  const memory=createConversationMemory(f.database,f.userId,f.conversationId,{content:'Author secret.',visibility:'author',truthStatus:'established',actorIds:[actor]});
  assert.equal(memory.visibility,'author');
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId,{actorId:actor}).length,0);
  const revised=updateConversationMemory(f.database,f.userId,f.conversationId,memory.id,{revision:memory.revision,visibility:'restricted',truthStatus:'disputed'});
  assert.deepEqual(revised.actorIds,[actor]); assert.equal(revised.truthStatus,'disputed');
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId,{actorId:actor})[0].content,'Author secret.');
  assert.throws(()=>updateConversationMemory(f.database,f.userId,f.conversationId,memory.id,{revision:revised.revision,actorIds:['foreign-actor']}),/不属于/);
});

test('compact checkpoint restoration does not truncate a canonical log beyond ten thousand records',t=>{
  const f=setup(t);
  const checkpoint=captureMemoryCheckpoint(f.database,f.userId,f.conversationId);
  const insert=f.database.prepare(`INSERT INTO memory_events(id,user_id,conversation_id,memory_id,kind,content,narrative_order,source_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)`);
  f.database.exec('SAVEPOINT test_large_memory');
  for(let index=0;index<10001;index++)insert.run(`event-${index}`,f.userId,f.conversationId,`memory-${index}`,'fact',`Historical fact ${index}`,0,`source-${index}`,'2026-01-01');
  f.database.exec('RELEASE SAVEPOINT test_large_memory');
  assert.equal(JSON.stringify(captureMemoryCheckpoint(f.database,f.userId,f.conversationId)).length,JSON.stringify(checkpoint).length);
  restoreMemoryCheckpoint(f.database,f.userId,f.conversationId,checkpoint);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS count FROM conversation_memories WHERE conversation_id=?').get(f.conversationId).count,10001);
});
