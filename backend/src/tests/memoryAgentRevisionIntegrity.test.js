import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createCharacter } from '../modules/characters.js';
import { deleteConversationMemory,listConversationMemories } from '../modules/conversationMemories.js';
import { commitMemoryPacket,captureMemoryCheckpoint,restoreMemoryCheckpoint } from '../services/conversationMemory/commit.js';
import { runConversationMemoryAgent } from '../services/conversationMemoryAgent.js';
import { executeProviderTool } from '../services/providerToolResults.js';
import { listMemoryRecords,listMemoryEntities,listCurrentMemoryClaims,listCurrentMemoryKnowledge,listCurrentMemoryThreads,getMemoryState } from '../repositories/conversationMemoryRepository.js';
import { listMemoryWorkbenchDomainRefs } from '../repositories/conversationMemoryWorkbenchRepository.js';

const settings={providerType:'custom',baseUrl:'https://integrity.invalid/v1',model:'isolated-test',apiKey:'fixture-key'};

/** Seed an old, fully typed event and a distinct current observation; all providers and storage are isolated. */
function fixture(t) {
  const database=createAppDatabase(':memory:');t.after(()=>database.close());
  const userId='integrity-owner',conversationId='integrity-story';
  database.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,'now')").run(userId,userId,'hash');
  const character=createCharacter(database,userId,{name:'Mira'});
  database.prepare("INSERT INTO conversations(id,user_id,character_id,title,state_status,created_at,updated_at) VALUES(?,?,?,'Integrity','ready','now','now')")
    .run(conversationId,userId,character.id);
  const message=(id,role,content,order)=>database.prepare("INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?,?)")
    .run(id,userId,conversationId,role,content,`2026-11-01T00:00:${String(order).padStart(2,'0')}Z`);
  message('old-user','user','Mira receives the key.',1);
  message('old-assistant','assistant','Mira holds the key in the cellar. Noel believes the key is in the attic.',2);
  const seed=commitMemoryPacket(database,userId,conversationId,{messageId:'old-assistant',sources:[{messageId:'old-assistant',revision:1}],
    entities:[{key:'mira',name:'Mira',kind:'actor',castKey:'main-character'},{key:'noel',name:'Noel',kind:'actor'},
      {key:'key',name:'Silver key',kind:'object'},{key:'cellar',name:'Cellar',kind:'place'}],
    events:[{key:'key-event',kind:'fact',subjectEntityId:'mira',participants:['noel'],locationEntityId:'cellar',narrativeTime:'Before dawn',
      content:'Mira holds the key in the cellar.',visibility:'restricted',actorIds:['mira'],truthStatus:'established',
      evidence:[{messageId:'old-assistant',quote:'Mira holds the key in the cellar.'}]}],
    claims:[{eventKey:'key-event',subjectEntityId:'mira',objectEntityId:'key',predicate:'owns',value:{quantity:1},truthStatus:'established'},
      {eventKey:'key-event',subjectEntityId:'mira',predicate:'planned_return',value:'tomorrow',validFrom:6}],
    knowledge:[{eventKey:'key-event',actorEntityId:'mira',epistemicState:'experienced'},
      {eventKey:'key-event',actorEntityId:'noel',epistemicState:'false_belief',beliefContent:'The key is in the attic.'}],
    threads:[{eventKey:'key-event',id:'find-key',ownerEntityId:'noel',kind:'clue',title:'Find the key',resolutionTrigger:'Locate the silver key'}],
    domainRefs:[{eventKey:'key-event',domain:'scene_object',recordId:'scene-key',revision:'3',outcome:{quantity:1}}]});
  message('current-user','user','Please clarify the key record.',3);
  message('current-assistant','assistant','Mira still holds the key in the cellar. The key record was invalidated.',4);
  const entities=Object.fromEntries(listMemoryEntities(database,userId,conversationId).map(row=>[row.name,row.id]));
  const memory=()=>listConversationMemories(database,userId,conversationId,{includeArchived:true})[0];
  const userMessage={id:'current-user',role:'user',content:'Please clarify the key record.'};
  const assistantMessage={id:'current-assistant',role:'assistant',content:'Mira still holds the key in the cellar. The key record was invalidated.'};
  const conversation={id:conversationId,characterId:character.id,settings:{accessorySkills:{memoryAgent:{enabled:true,tools:{pin_memory:true,invalidate_memory:true}}}}};
  let run=0;
  const prepare=async(actions,packet={})=>runConversationMemoryAgent({database,userId,conversation,userMessage,assistantMessage,settings,
    prepareOnly:true,idempotencyKey:`integrity-run-${++run}`,runTools:async(_settings,_messages,tools,execute)=>{
      for(const [name,args,expected=true] of actions) {
        const result=(await executeProviderTool(execute,name,args,{},undefined,tools)).result;
        assert.equal(result.ok,expected,`${name}: ${JSON.stringify(result)}`);
      }
      assert.equal((await executeProviderTool(execute,'finish_memory_review',{packet}, {},undefined,tools)).result.ok,true);
      return {};
    }});
  return {database,userId,conversationId,entities,memory,prepare,seed};
}

function assertGraph(f,current,expectedContent) {
  assert.equal(current.content,expectedContent);assert.equal(current.subject_entity_id,f.entities.Mira);
  assert.deepEqual(current.participants,[f.entities.Noel]);assert.equal(current.location_entity_id,f.entities.Cellar);assert.equal(current.narrative_time,'Before dawn');
  assert.deepEqual(current.actorIds,[f.entities.Mira]);assert.equal(current.visibility,'restricted');assert.equal(current.truth_status,'established');
  const claims=listCurrentMemoryClaims(f.database,f.userId,f.conversationId,{asOfOrder:6});
  assert.equal(claims.length,2);assert.ok(claims.every(row=>row.event_id===current.id));assert.equal(claims.find(row=>row.predicate==='planned_return').valid_from,6);
  const knowledge=listCurrentMemoryKnowledge(f.database,f.userId,f.conversationId).filter(row=>row.event_id===current.id);
  assert.equal(knowledge.length,2);assert.equal(knowledge.find(row=>row.actor_entity_id===f.entities.Noel).epistemic_state,'false_belief');
  assert.equal(knowledge.find(row=>row.actor_entity_id===f.entities.Noel).belief_content,'The key is in the attic.');
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId,{actorId:f.entities.Noel})[0].content,'The key is in the attic.');
  const thread=listCurrentMemoryThreads(f.database,f.userId,f.conversationId)[0];assert.equal(thread.thread_key,'find-key');assert.equal(thread.event_id,current.id);
  const refs=listMemoryWorkbenchDomainRefs(f.database,f.userId,f.conversationId,[current.id]);assert.equal(refs.length,1);
  assert.equal(refs[0].record_id,'scene-key');assert.equal(refs[0].revision,'3');assert.equal(refs[0].domain,'scene_object');
}

for(const operation of ['content update','confidence update','pin']) test(`Agent ${operation} preserves the complete canonical graph and false belief`,async t=>{
  const f=fixture(t);const before=f.memory();const checkpoint=captureMemoryCheckpoint(f.database,f.userId,f.conversationId);
  const content=operation==='content update'?'Mira still holds the key in the cellar.':before.content;
  const args=operation==='pin'?{pinned:true}:operation==='confidence update'?{confidence:0.7}:{content,sourceMessageId:'current-assistant',quote:content};
  const prepared=await f.prepare([[operation==='pin'?'pin_memory':'update_memory',{memoryId:before.id,revision:before.revision,...args}]]);
  assert.equal(f.memory().revision,before.revision,'preparation must leave the live projection untouched');
  const receipt=prepared.commit();const current=listMemoryRecords(f.database,f.userId,f.conversationId)[0];
  assertGraph(f,current,content);assert.equal(current.memory_id,before.id);assert.notEqual(current.id,f.seed.eventIds[0]);
  assert.equal(f.memory().pinned,operation==='pin');assert.equal(receipt.eventIds.length,1);
  assert.equal(prepared.commit().duplicate,true);
  restoreMemoryCheckpoint(f.database,f.userId,f.conversationId,checkpoint);
  assertGraph(f,listMemoryRecords(f.database,f.userId,f.conversationId)[0],before.content);
});

for(const scopeChange of [{subject:'Noel'},{memoryType:'relationship'}]) test(`Agent structured scope edit ${Object.keys(scopeChange)[0]} rolls back atomically`,async t=>{
  const f=fixture(t);const before=f.memory();const state=getMemoryState(f.database,f.userId,f.conversationId);
  const count=table=>f.database.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  const tables=['memory_commits','memory_events','memory_claims','memory_actor_knowledge','memory_plot_threads','memory_domain_refs','jobs'];
  const counts=Object.fromEntries(tables.map(table=>[table,count(table)]));
  const prepared=await f.prepare([['update_memory',{memoryId:before.id,revision:before.revision,...scopeChange}]]);
  assert.throws(()=>prepared.commit(),error=>error.status===409);
  assert.deepEqual(f.memory(),before);assert.equal(getMemoryState(f.database,f.userId,f.conversationId).revision,state.revision);
  for(const table of tables)assert.equal(count(table),counts[table],table);
  assertGraph(f,listMemoryRecords(f.database,f.userId,f.conversationId)[0],before.content);
});

test('Agent invalidation and a subsequent pin cannot revive obsolete graph facts; deletion retains only immutable history',async t=>{
  const f=fixture(t);const before=f.memory();
  const invalidation=await f.prepare([['invalidate_memory',{memoryId:before.id,revision:before.revision,reason:'The current observation invalidates this record.',
    sourceMessageId:'current-assistant',quote:'The key record was invalidated.'}]]);
  invalidation.commit();
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId).length,0);assert.equal(listCurrentMemoryClaims(f.database,f.userId,f.conversationId).length,0);
  const invalidated=f.memory();const pin=await f.prepare([['pin_memory',{memoryId:before.id,revision:invalidated.revision,pinned:true},false]]);
  pin.commit();
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId).length,0);assert.equal(listCurrentMemoryClaims(f.database,f.userId,f.conversationId).length,0);
  const latest=f.database.prepare('SELECT id FROM memory_events WHERE memory_id=? ORDER BY memory_revision DESC LIMIT 1').get(before.id);
  assert.equal(listMemoryWorkbenchDomainRefs(f.database,f.userId,f.conversationId,[latest.id]).length,0);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_actor_knowledge WHERE event_id=?').get(latest.id).n,0);
  assert.equal(deleteConversationMemory(f.database,f.userId,f.conversationId,before.id),true);
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId).length,0);assert.equal(listCurrentMemoryClaims(f.database,f.userId,f.conversationId).length,0);
  assert.ok(f.database.prepare('SELECT id FROM memory_events WHERE id=?').get(f.seed.eventIds[0]),'original evidence and immutable graph history remain retained');
});

test('explicit packet corrections win over inherited knowledge, claims, plot-thread state and domain receipts',async t=>{
  const f=fixture(t);const before=f.memory();const eventKey=`projection:${before.id}`;
  const oldClaim=f.database.prepare("SELECT id FROM memory_claims WHERE event_id=? AND predicate='owns'").get(f.seed.eventIds[0]);
  const oldThread=listCurrentMemoryThreads(f.database,f.userId,f.conversationId)[0];
  const content='Mira still holds the key in the cellar.';
  const prepared=await f.prepare([['update_memory',{memoryId:before.id,revision:before.revision,content,sourceMessageId:'current-assistant',quote:content}]],{
    claims:[{eventKey,subjectEntityId:f.entities.Mira,objectEntityId:f.entities['Silver key'],predicate:'owns',value:{quantity:2},truthStatus:'established',supersedesId:oldClaim.id}],
    knowledge:[{eventKey,actorEntityId:f.entities.Noel,epistemicState:'knows'}],
    threads:[{eventKey,id:oldThread.id,kind:'clue',title:'Find the key',status:'resolved',ownerEntityId:f.entities.Noel,resolutionTrigger:'Locate the silver key'}],
    domainRefs:[{eventKey,domain:'scene_object',recordId:'scene-key',revision:'4',outcome:{quantity:2}}]
  });
  prepared.commit();const current=listMemoryRecords(f.database,f.userId,f.conversationId)[0];
  const knowledge=listCurrentMemoryKnowledge(f.database,f.userId,f.conversationId).filter(row=>row.event_id===current.id);
  assert.equal(knowledge.length,2);assert.equal(knowledge.find(row=>row.actor_entity_id===f.entities.Noel).epistemic_state,'knows');
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId,{actorId:f.entities.Noel})[0].content,content);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_actor_knowledge WHERE event_id=? AND actor_entity_id=?').get(current.id,f.entities.Noel).n,1);
  const claims=listCurrentMemoryClaims(f.database,f.userId,f.conversationId,{asOfOrder:6});
  assert.equal(claims.length,2);assert.deepEqual(claims.find(row=>row.predicate==='owns').value,{quantity:2});
  const thread=listCurrentMemoryThreads(f.database,f.userId,f.conversationId)[0];assert.equal(thread.thread_key,'find-key');assert.equal(thread.status,'resolved');
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_plot_threads WHERE event_id=? AND thread_key=?').get(current.id,'find-key').n,1);
  const refs=listMemoryWorkbenchDomainRefs(f.database,f.userId,f.conversationId,[current.id]);assert.equal(refs.length,1);assert.equal(refs[0].revision,'4');
});
