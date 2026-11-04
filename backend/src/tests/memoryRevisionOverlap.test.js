import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createCharacter } from '../modules/characters.js';
import { listConversationMemories,updateConversationMemory,pinConversationMemory } from '../modules/conversationMemories.js';
import { commitMemoryPacket } from '../services/conversationMemory/commit.js';
import { runConversationMemoryAgent } from '../services/conversationMemoryAgent.js';
import { executeProviderTool } from '../services/providerToolResults.js';
import { listMemoryRecords,getMemoryState } from '../repositories/conversationMemoryRepository.js';
import { MemoryRevisionError } from '../domain/conversationMemory/contracts.js';

const settings={providerType:'custom',baseUrl:'https://overlap.invalid/v1',model:'scripted-fixture',apiKey:'fixture-key'};
const oldContent='Mira holds the key.';
const newContent='Mira still holds the key.';
const storyTables=['memory_commits','memory_entities','memory_source_versions','memory_events','memory_evidence',
  'memory_claims','memory_actor_knowledge','memory_plot_threads','memory_domain_refs','conversation_memories',
  'conversation_memory_state','jobs'];

/** Seed one accepted memory and a later observation; script the real tool boundary without provider or disk writes. */
function fixture(t) {
  const database=createAppDatabase(':memory:');t.after(()=>database.close());
  const userId='overlap-owner',conversationId='overlap-story';
  database.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,'now')").run(userId,userId,'hash');
  const character=createCharacter(database,userId,{name:'Mira'});
  database.prepare("INSERT INTO conversations(id,user_id,character_id,title,state_status,created_at,updated_at) VALUES(?,?,?,'Overlap','ready','now','now')")
    .run(conversationId,userId,character.id);
  for (const [index,message] of [
    {id:'old-user',role:'user',content:'Receive the key.'},{id:'old-assistant',role:'assistant',content:oldContent},
    {id:'current-user',role:'user',content:'Clarify the key record.'},{id:'current-assistant',role:'assistant',content:newContent}
  ].entries()) database.prepare('INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?,?)')
    .run(message.id,userId,conversationId,message.role,message.content,`2026-11-01T00:00:0${index}Z`);
  const seed=commitMemoryPacket(database,userId,conversationId,{messageId:'old-assistant',sources:[{messageId:'old-assistant',revision:1}],
    entities:[{key:'mira',name:'Mira',kind:'actor',castKey:'main-character'}],
    events:[{key:'original',kind:'fact',subjectEntityId:'mira',content:oldContent,evidence:[{messageId:'old-assistant',quote:oldContent}]}],
    claims:[{eventKey:'original',subjectEntityId:'mira',predicate:'holds',value:'key'}]});
  const conversation={id:conversationId,characterId:character.id,settings:{accessorySkills:{memoryAgent:{enabled:true,tools:{pin_memory:true}}}}};
  const memory=()=>listConversationMemories(database,userId,conversationId,{includeArchived:true})[0];
  const event=(key='explicit',supersedesId=seed.eventIds[0])=>({key,supersedesId,kind:'fact',content:newContent,
    evidence:[{messageId:'current-assistant',quote:newContent}]});
  const packet=events=>({messageId:'current-assistant',sources:[{messageId:'current-assistant',revision:1}],events});
  const snapshot=()=>Object.fromEntries(storyTables.map(table=>[table,database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const prepare=script=>runConversationMemoryAgent({database,userId,conversation,settings,prepareOnly:true,retryDelaysMs:[],
    userMessage:{id:'current-user',role:'user',content:'Clarify the key record.'},
    assistantMessage:{id:'current-assistant',role:'assistant',content:newContent},
    runTools:async(_settings,_messages,tools,execute)=>{
      const call=async(name,args)=>(await executeProviderTool(execute,name,args,{},undefined,tools));
      await script(call);return {};
    }});
  return {database,userId,conversationId,seed,memory,event,packet,snapshot,prepare};
}

/** Keep same-memory tool operations ordered while allowing several legitimate edits to produce one final projection. */
async function stageTools(f,operation,call) {
  const before=f.memory();let revision=before.revision;
  if (operation.includes('update')) {
    const result=await call('update_memory',{memoryId:before.id,revision:revision++,content:newContent,
      sourceMessageId:'current-assistant',quote:newContent});
    assert.equal(result.result.ok,true,JSON.stringify(result));
  }
  if (operation.includes('pin')) {
    const result=await call('pin_memory',{memoryId:before.id,revision,pinned:true});
    assert.equal(result.result.ok,true,JSON.stringify(result));
  }
}

/** Bypass finish deliberately to verify the public commit's atomic fallback against actual projection mutations. */
function applyTools(f,operation) {
  const {database,userId,conversationId}=f;let changed=f.memory();
  if (operation.includes('update')) changed=updateConversationMemory(database,userId,conversationId,changed.id,{
    revision:changed.revision,content:newContent,sourceMessageId:'current-assistant',sourceExcerpt:newContent});
  if (operation.includes('pin')) changed=pinConversationMemory(database,userId,conversationId,changed.id,{revision:changed.revision,pinned:true});
  return changed;
}

function assertRevisionConflict(error,code) {
  assert.ok(error instanceof MemoryRevisionError);assert.equal(error.code,code);
  assert.equal(error.status,409);assert.equal(error.accepted,false);return true;
}

for (const operation of ['update','pin','update+pin']) test(`finish rejects ${operation} and an explicit revision, then accepts a corrected packet without losing staged edits`,async t=>{
  const f=fixture(t);const before=f.snapshot();
  const prepared=await f.prepare(async call=>{
    await stageTools(f,operation,call);
    const rejected=await call('finish_memory_review',{packet:{events:[f.event()]}});
    assert.equal(rejected.result.ok,false);assert.equal(rejected.result.code,'MEMORY_REVISION_PATH_CONFLICT');
    assert.equal(rejected.stop,false);assert.equal(rejected.result.remainingAttempts,2);
    assert.match(rejected.result.error,/packet\.events/);assert.deepEqual(f.snapshot(),before);
    const corrected=await call('finish_memory_review',{packet:{}});
    assert.equal(corrected.result.ok,true);assert.equal(corrected.stop,true);assert.deepEqual(f.snapshot(),before);
  });
  const receipt=prepared.commit();const current=listMemoryRecords(f.database,f.userId,f.conversationId);
  assert.equal(receipt.eventIds.length,1);assert.equal(current.length,1);
  assert.equal(current[0].memory_revision,operation==='update+pin'?3:2);
  assert.equal(current[0].content,operation.includes('update')?newContent:oldContent);
  assert.equal(f.memory().pinned,operation.includes('pin'));
  assert.equal(f.memory().revision,current[0].memory_revision);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_events WHERE supersedes_id=?').get(f.seed.eventIds[0]).n,1);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('finish rejects duplicate explicit replacements and allows one corrected full revision',async t=>{
  const f=fixture(t);const before=f.snapshot();
  const prepared=await f.prepare(async call=>{
    const rejected=await call('finish_memory_review',{packet:{events:[f.event('first'),f.event('second')]}});
    assert.equal(rejected.result.ok,false);assert.equal(rejected.result.code,'MEMORY_REVISION_TARGET_CONFLICT');
    assert.equal(rejected.stop,false);assert.deepEqual(f.snapshot(),before);
    const corrected=await call('finish_memory_review',{packet:{events:[f.event('corrected')]}});
    assert.equal(corrected.result.ok,true);assert.deepEqual(f.snapshot(),before);
  });
  const receipt=prepared.commit();assert.equal(receipt.eventIds.length,1);
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId).length,1);
  assert.equal(f.memory().content,newContent);assert.equal(f.memory().revision,2);
});

for (const operation of ['update','pin','update+pin']) test(`atomic commit rejects ${operation} and explicit replacement independently of finish and SQLite revision uniqueness`,t=>{
  const f=fixture(t);const before=f.snapshot();let actionCalls=0;
  assert.throws(()=>commitMemoryPacket(f.database,f.userId,f.conversationId,f.packet([f.event()]),{
    applyActions:()=>{actionCalls++;return {memories:[applyTools(f,operation)]};}
  }),error=>assertRevisionConflict(error,'MEMORY_REVISION_PATH_CONFLICT'));
  assert.equal(actionCalls,1);assert.deepEqual(f.snapshot(),before);
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId).length,1);
});

test('atomic commit rejects two explicit successors before applying actions or enqueueing derived work',t=>{
  const f=fixture(t);const before=f.snapshot();let actionCalls=0;let enqueues=0;
  assert.throws(()=>commitMemoryPacket(f.database,f.userId,f.conversationId,f.packet([f.event('first'),f.event('second')]),{
    applyActions:()=>{actionCalls++;return {memories:[]};},enqueueDerived:()=>{enqueues++;return [];}
  }),error=>assertRevisionConflict(error,'MEMORY_REVISION_TARGET_CONFLICT'));
  assert.equal(actionCalls,0);assert.equal(enqueues,0);assert.deepEqual(f.snapshot(),before);
});

test('replacements of different parents of one owned memory cannot create a same-packet branch',async t=>{
  const f=fixture(t);
  const prior=commitMemoryPacket(f.database,f.userId,f.conversationId,{messageId:'old-assistant',idempotencyKey:'older-revision',
    sources:[{messageId:'old-assistant',revision:1}],events:[{...f.event('older'),content:oldContent,
      evidence:[{messageId:'old-assistant',quote:oldContent}]}]});
  const events=[f.event('current-parent',prior.eventIds[0]),f.event('older-parent',f.seed.eventIds[0])];
  const before=f.snapshot();
  assert.throws(()=>commitMemoryPacket(f.database,f.userId,f.conversationId,f.packet(events)),
    error=>assertRevisionConflict(error,'MEMORY_REVISION_TARGET_CONFLICT'));
  assert.deepEqual(f.snapshot(),before);
  const prepared=await f.prepare(async call=>{
    const rejected=await call('finish_memory_review',{packet:{events}});
    assert.equal(rejected.result.code,'MEMORY_REVISION_TARGET_CONFLICT');assert.equal(rejected.stop,false);
    assert.deepEqual(f.snapshot(),before);
    assert.equal((await call('finish_memory_review',{packet:{events:events.slice(0,1)}})).result.ok,true);
  });
  assert.equal(prepared.commit().eventIds.length,1);
  assert.equal(listMemoryRecords(f.database,f.userId,f.conversationId).length,1);
});

test('final commit guard rejects duplicate actual projections even without explicit events',t=>{
  const f=fixture(t);const before=f.snapshot();
  assert.throws(()=>commitMemoryPacket(f.database,f.userId,f.conversationId,f.packet([]),{
    applyActions:()=>{const changed=applyTools(f,'update');return {memories:[changed,changed]};}
  }),error=>assertRevisionConflict(error,'MEMORY_REVISION_TARGET_CONFLICT'));
  assert.deepEqual(f.snapshot(),before);assert.equal(getMemoryState(f.database,f.userId,f.conversationId).revision,1);
});
