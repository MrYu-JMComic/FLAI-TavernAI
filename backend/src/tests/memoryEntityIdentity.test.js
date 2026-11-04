import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { branchConversation } from '../modules/branches.js';
import { writeConversationCheckpoint } from '../repositories/conversationSnapshotRepository.js';
import { listMemoryEntities,listMemoryRecords,getMemoryState } from '../repositories/conversationMemoryRepository.js';
import { commitMemoryPacket,captureMemoryCheckpoint,restoreMemoryCheckpoint } from '../services/conversationMemory/commit.js';

/** Keep identity enrollment and branch operations in an independent database without provider calls. */
function fixture(t) {
  const database=createAppDatabase(':memory:');t.after(()=>database.close());
  const userId='identity-owner',conversationId='identity-story';
  database.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,'now')").run(userId,userId,'hash');
  database.prepare("INSERT INTO characters(id,user_id,name,created_at,updated_at) VALUES('identity-card',?,'Mira','now','now')").run(userId);
  database.prepare("INSERT INTO conversations(id,user_id,character_id,title,state_status,created_at,updated_at) VALUES(?,?,'identity-card','Identity','ready','now','now')")
    .run(conversationId,userId);
  let count=0;
  const message=id=>database.prepare("INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,'assistant','Identity observation',?)")
    .run(id,userId,conversationId,`2026-11-01T00:00:${String(++count).padStart(2,'0')}Z`);
  const commit=(packet,target=conversationId)=>commitMemoryPacket(database,userId,target,packet,{kind:'manual'});
  const entities=(target=conversationId)=>listMemoryEntities(database,userId,target);
  return {database,userId,conversationId,message,commit,entities};
}

test('same-name actors with distinct cast keys keep restricted memories and knowledge separate',t=>{
  const f=fixture(t);
  f.commit({entities:[{key:'a',name:'Mira',castKey:'actor-a'},{key:'b',name:'Mira',castKey:'actor-b'}],
    events:[{key:'a-secret',subjectKey:'a',content:'The cellar key belongs to A.',visibility:'restricted',actorIds:['a']},
      {key:'b-secret',subjectKey:'b',content:'B waits at the northern gate.',visibility:'restricted',actorIds:['b']}],
    knowledge:[{eventKey:'a-secret',actorKey:'a',epistemicState:'knows'},
      {eventKey:'b-secret',actorKey:'b',epistemicState:'experienced'}]});
  const actors=f.entities();assert.equal(actors.length,2);
  const first=actors.find(row=>row.cast_key==='actor-a'),second=actors.find(row=>row.cast_key==='actor-b');
  assert.notEqual(first.id,second.id);
  for(const [actor,content] of [[first,'The cellar key belongs to A.'],[second,'B waits at the northern gate.']]) {
    const visible=listMemoryRecords(f.database,f.userId,f.conversationId,{actorId:actor.id});
    assert.deepEqual(visible.map(row=>row.content),[content]);
    assert.equal(visible[0].subject_entity_id,actor.id);assert.deepEqual(visible[0].actorIds,[actor.id]);
  }
});

test('the same cast key reuses an entity and appends aliases within and across packets',t=>{
  const f=fixture(t);
  f.commit({entities:[{key:'first',name:'Mira',castKey:'actor-a'},
    {key:'second',name:'Captain Mira',castKey:'actor-a',aliases:['The captain']}]});
  const original=f.entities()[0];assert.equal(f.entities().length,1);
  f.commit({entities:[{key:'again',name:'Commander Mira',castKey:'actor-a'}]});
  f.commit({entities:[{key:'by-id',id:original.id,name:'Admiral Mira',castKey:'actor-a'}]});
  const current=f.entities()[0];assert.equal(f.entities().length,1);assert.equal(current.id,original.id);
  for(const alias of ['Mira','Captain Mira','The captain','Commander Mira','Admiral Mira']) assert.ok(current.aliases.includes(alias));
  assert.equal(current.cast_key,'actor-a');
});

test('unkeyed names and aliases retain strict resolution without absorbing an explicitly keyed same-name actor',t=>{
  const f=fixture(t);
  f.commit({entities:[{key:'story-actor',name:'Mira',aliases:['The captain']}]});
  const original=f.entities()[0];
  f.commit({entities:[{key:'by-alias',name:'The captain'}]});
  assert.equal(f.entities().length,1);assert.equal(f.entities()[0].id,original.id);
  f.commit({entities:[{key:'card-actor',name:'Mira',castKey:'main-character'}]});
  assert.equal(f.entities().length,2);
  assert.notEqual(f.entities().find(row=>row.cast_key==='main-character').id,original.id);
  const state=getMemoryState(f.database,f.userId,f.conversationId);
  assert.throws(()=>f.commit({entities:[{key:'ambiguous',name:'Mira'}]}),error=>error.code==='MEMORY_ENTITY_UNRESOLVED');
  assert.deepEqual(getMemoryState(f.database,f.userId,f.conversationId),state);
});

for(const originalCastKey of ['actor-a','']) test(`explicit id cannot reassign ${originalCastKey||'an unkeyed entity'} to another cast key`,t=>{
  const f=fixture(t);
  f.commit({entities:[{key:'existing',name:'Mira',castKey:originalCastKey}]});
  const original=f.entities()[0];const state=getMemoryState(f.database,f.userId,f.conversationId);
  const tables=['memory_commits','memory_entities','memory_entity_aliases','memory_events','memory_evidence'];
  const counts=()=>Object.fromEntries(tables.map(table=>[table,f.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  const before=counts();
  assert.throws(()=>f.commit({entities:[{key:'new',name:'Transient actor',castKey:'transient'},
    {key:'mismatch',id:original.id,name:'False alias',castKey:'actor-b'}]}),error=>error.code==='MEMORY_ENTITY_UNRESOLVED');
  assert.deepEqual(counts(),before);assert.deepEqual(f.entities(),[original]);
  assert.deepEqual(getMemoryState(f.database,f.userId,f.conversationId),state);
});

test('restore and branch enrollment reuse only cast keys visible in the selected lineage',t=>{
  const f=fixture(t);f.message('early');
  f.commit({messageId:'early',entities:[{key:'a',name:'Mira',castKey:'actor-a'}]});
  const first=f.entities()[0];const checkpoint=captureMemoryCheckpoint(f.database,f.userId,f.conversationId);
  f.message('later');f.commit({messageId:'later',entities:[{key:'b',name:'Mira',castKey:'actor-b',aliases:['Discarded B']}]});
  const discarded=f.entities().find(row=>row.cast_key==='actor-b');
  restoreMemoryCheckpoint(f.database,f.userId,f.conversationId,checkpoint);
  f.commit({messageId:'later',entities:[{key:'a',name:'Captain A',castKey:'actor-a'},
    {key:'b',name:'Mira',castKey:'actor-b',aliases:['Selected B']}]});
  const selected=f.entities().find(row=>row.cast_key==='actor-b');
  assert.equal(f.entities().length,2);assert.equal(f.entities().find(row=>row.cast_key==='actor-a').id,first.id);
  assert.notEqual(selected.id,discarded.id);assert.ok(!selected.aliases.includes('Discarded B'));
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM memory_entities WHERE conversation_id=? AND cast_key='actor-b'").get(f.conversationId).count,2);
  writeConversationCheckpoint(f.database,f.userId,f.conversationId,{throughMessageId:'later'});
  const branch=branchConversation(f.database,f.userId,f.conversationId,'later');
  const copied=f.entities(branch.id).find(row=>row.cast_key==='actor-b');
  assert.notEqual(copied.id,selected.id);assert.equal(f.entities(branch.id).length,2);
  f.commit({entities:[{key:'b',name:'Branch B',castKey:'actor-b'}]},branch.id);
  const updated=f.entities(branch.id).find(row=>row.cast_key==='actor-b');
  assert.equal(updated.id,copied.id);assert.equal(f.entities(branch.id).length,2);
  assert.ok(updated.aliases.includes('Branch B'));assert.ok(!selected.aliases.includes('Branch B'));
  assert.ok(!updated.aliases.includes('Discarded B'));assert.equal(f.database.prepare('PRAGMA foreign_key_check').all().length,0);
});
