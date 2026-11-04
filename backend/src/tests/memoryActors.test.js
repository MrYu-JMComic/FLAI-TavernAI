import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAppDatabase } from '../db/runtime.js';
import { createCharacter } from '../modules/characters.js';
import { branchConversation } from '../modules/branches.js';
import { insertMemoryEntity,listMemoryRecords,listCurrentMemoryClaims,listCurrentMemoryKnowledge,listCurrentMemoryThreads } from '../repositories/conversationMemoryRepository.js';
import { writeConversationCheckpoint } from '../repositories/conversationSnapshotRepository.js';
import { commitMemoryPacket,captureMemoryCheckpoint,restoreMemoryCheckpoint } from '../services/conversationMemory/commit.js';
import { listMemoryActors,readMemoryActorDossier,appendMemoryActorRecords,patchMemoryActorRecord } from '../services/conversationMemory/workbench.js';
import { createConversationMemoriesRouter } from '../routes/conversationMemories.js';
import { updateConversationMemory,pinConversationMemory,disableConversationMemory,confirmConversationMemory,deleteConversationMemory,mergeConversationMemories } from '../modules/conversationMemories.js';
import { withServer } from './routeTestUtils.js';

function fixture(t) {
  const database=createAppDatabase(':memory:');t.after(()=>database.close());
  database.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES('owner','owner','hash','now'),('other','other','hash','now')").run();
  const character=createCharacter(database,'owner',{name:'米拉'});
  for(const [id,user] of [['story','owner'],['other-story','other']])
    database.prepare("INSERT INTO conversations(id,user_id,character_id,title,created_at,updated_at,state_status) VALUES(?,?,?,'Story','now','now','ready')")
      .run(id,user,character.id);
  const entity=(id,name,kind='actor',castKey='',conversationId='story',userId='owner')=>insertMemoryEntity(database,userId,conversationId,{id,name,kind,castKey,aliases:id==='mira'?['小米']:[]});
  entity('mira','米拉','actor','main-character');entity('noel','诺尔');entity('twin','米拉');entity('outsider','访客');
  entity('key','铜钥匙','object');entity('stone','石头','object');entity('foreign','外人','actor','','other-story','other');
  let count=0;
  const message=(id,text='米拉持有铜钥匙并告诉诺尔钥匙在阁楼。')=>{
    database.prepare("INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,'owner','story','assistant',?,?)")
      .run(id,text,`2026-11-01T00:00:${String(++count).padStart(2,'0')}Z`);
    return id;
  };
  const commit=(packet,options={})=>commitMemoryPacket(database,'owner','story',packet,{kind:'author_correction',...options});
  const dossier=(actorId,options={})=>readMemoryActorDossier(database,'owner','story',actorId,options);
  const revision=()=>database.prepare("SELECT revision FROM conversation_memory_state WHERE conversation_id='story'").get()?.revision||0;
  const scene=(id='scene-key',quantity=3)=>{
    database.prepare("INSERT OR IGNORE INTO scene_nodes(id,conversation_id,name,created_at,updated_at) VALUES('room','story','房间','now','now')").run();
    database.prepare("INSERT INTO scene_objects(id,conversation_id,node_id,item_code,name,description,quantity,created_at,updated_at) VALUES(?,'story','room',?,'铜钥匙','原始描述',?,'now','now')")
      .run(id,id,quantity);
  };
  return {database,entity,message,commit,dossier,revision,scene};
}

test('actor dossiers use exact native IDs, aliases and graph associations instead of matching names in text',t=>{
  const f=fixture(t);f.message('turn');
  f.commit({messageId:'turn',events:[
    {key:'subject',subjectEntityId:'mira',content:'米拉得到一把钥匙'},
    {key:'participant',participants:['noel'],content:'有人在远方敲钟'},
    {key:'mention',content:'这个未关联文本也提及米拉'},
    {key:'twin',subjectEntityId:'twin',content:'另一位米拉走进屋子'},
    {key:'relation',content:'两人成为朋友'},
    {key:'knowledge',visibility:'restricted',actorIds:['mira'],content:'秘密位置'},
    {key:'thread',content:'等待重逢'}],
    claims:[{eventKey:'relation',subjectEntityId:'mira',predicate:'friend',objectEntityId:'noel',truthStatus:'established'}],
    knowledge:[{eventKey:'knowledge',actorEntityId:'noel',epistemicState:'knows'},{eventKey:'knowledge',actorEntityId:'outsider',epistemicState:'unknown'}],
    threads:[{eventKey:'thread',ownerEntityId:'noel',title:'重逢',kind:'goal'}]});
  const actors=listMemoryActors(f.database,'owner','story').actors;
  assert.equal(actors.length,4);assert.equal(actors.find(row=>row.id==='mira').origin,'card');assert.equal(actors.find(row=>row.id==='noel').origin,'story');
  assert.deepEqual(listMemoryActors(f.database,'owner','story',{query:'小米'}).actors.map(row=>row.id),['mira']);
  assert.equal(f.dossier('mira').memories.some(row=>row.content.includes('未关联文本')),false);
  assert.deepEqual(f.dossier('twin').memories.map(row=>row.content),['另一位米拉走进屋子']);
  const noel=f.dossier('noel');
  assert.equal(noel.counts.memories,4);assert.equal(noel.relations[0].direction,'incoming');assert.equal(noel.relations[0].subjectId,'mira');
  assert.throws(()=>readMemoryActorDossier(f.database,'other','story','mira'),error=>error.code==='MEMORY_CONVERSATION_UNAVAILABLE');
  assert.throws(()=>f.dossier('foreign'),error=>error.status===404);
  assert.equal(f.dossier('outsider').counts.memories,0);
  assert.throws(()=>f.dossier('mira',{asOfOrder:'invalid'}),error=>error.code==='MEMORY_CUTOFF_INVALID');
});

test('strict viewer dossiers substitute false beliefs and never return author claims, evidence or other actor metadata',t=>{
  const f=fixture(t);f.message('turn');
  f.commit({messageId:'turn',events:[{key:'secret',subjectEntityId:'mira',content:'钥匙真实藏在地窖',truthStatus:'established',visibility:'restricted',actorIds:['mira']}],
    claims:[{eventKey:'secret',subjectEntityId:'mira',predicate:'secret',value:'地窖'}],
    knowledge:[{eventKey:'secret',actorEntityId:'noel',epistemicState:'false_belief',beliefContent:'钥匙在阁楼'}],
    threads:[{eventKey:'secret',title:'探查地窖',ownerEntityId:'noel'}]});
  const visible=f.dossier('noel',{viewerActorId:'noel'});
  assert.equal(visible.memories[0].content,'钥匙在阁楼');assert.equal(visible.events[0].truthStatus,'false');
  assert.deepEqual(visible.events[0].evidenceRefs,[]);assert.deepEqual(visible.relations,[]);assert.deepEqual(visible.items,[]);
  assert.equal(JSON.stringify(visible).includes('地窖'),false);
  assert.equal(JSON.stringify(visible).includes('mira'),false);assert.equal(visible.memories[0].subject,'');
  assert.deepEqual(listMemoryActors(f.database,'owner','story',{viewerActorId:'noel'}).actors.map(row=>row.id),['noel']);
  assert.throws(()=>f.dossier('mira',{viewerActorId:'noel'}),error=>error.status===404);
  assert.equal(f.dossier('outsider',{viewerActorId:'outsider'}).counts.memories,0);
});

test('possessions require explicit ownership claims; authoritative scene receipts do not duplicate item ledgers',t=>{
  const f=fixture(t);f.message('turn');f.scene();
  f.commit({messageId:'turn',events:[{key:'key',content:'米拉拿着铜钥匙'},{key:'seen',content:'米拉看到了石头'},{key:'unknown',content:'米拉拥有一块石头'}],
    claims:[{eventKey:'key',subjectEntityId:'mira',predicate:'holds',objectEntityId:'key',truthStatus:'established'},
      {eventKey:'seen',subjectEntityId:'mira',predicate:'sees',objectEntityId:'stone'},
      {eventKey:'unknown',subjectEntityId:'mira',predicate:'owns',objectEntityId:'stone',value:'一堆'}],
    domainRefs:[{eventKey:'key',domain:'scene_object',recordId:'scene-key',revision:'1'}]});
  const items=f.dossier('mira').items;
  assert.equal(items.length,2);assert.equal(items.find(row=>row.entityId==='key').quantity,3);
  assert.equal(items.find(row=>row.entityId==='key').authoritative,true);assert.equal(items.find(row=>row.entityId==='stone').quantity,null);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM scene_objects').get().n,1);
});

test('ambiguous scene receipts cannot attach an unrelated authoritative quantity to a possession',t=>{
  const f=fixture(t);f.message('turn');f.scene();f.scene('other-key',9);
  f.commit({messageId:'turn',events:[{key:'key',content:'米拉拿着一把铜钥匙'}],
    claims:[{eventKey:'key',subjectEntityId:'mira',predicate:'holds',objectEntityId:'key',value:{quantity:1}}],
    domainRefs:[{eventKey:'key',domain:'scene_object',recordId:'scene-key'},{eventKey:'key',domain:'scene_object',recordId:'other-key'}]});
  const item=f.dossier('mira').items[0];assert.equal(item.quantity,1);assert.equal(item.authoritative,false);assert.equal(item.recordId,'');
});

test('historical dossiers use checkpoint lineage, revision and scene quantities instead of future live state',t=>{
  const f=fixture(t);f.message('early');f.scene();
  f.commit({messageId:'early',events:[{key:'key',subjectEntityId:'mira',content:'最初有三把钥匙'}],
    claims:[{eventKey:'key',subjectEntityId:'mira',predicate:'owns',objectEntityId:'key'}],
    domainRefs:[{eventKey:'key',domain:'scene_object',recordId:'scene-key'}]});
  const earlyRevision=f.revision();writeConversationCheckpoint(f.database,'owner','story',{throughMessageId:'early'});
  const early=captureMemoryCheckpoint(f.database,'owner','story');
  f.message('later');f.commit({messageId:'later',entities:[{key:'new',kind:'actor',name:'未来角色'}],events:[{key:'future',subjectEntityId:'mira',content:'未来记忆'}]});
  f.database.prepare("UPDATE scene_objects SET quantity=99,revision=2 WHERE id='scene-key'").run();
  const historical=f.dossier('mira',{asOfMessageId:'early'});
  assert.equal(historical.revision,earlyRevision);assert.equal(historical.items[0].quantity,3);
  assert.equal(historical.memories.some(row=>row.content==='未来记忆'),false);
  assert.equal(listMemoryActors(f.database,'owner','story',{asOfMessageId:'early'}).actors.some(row=>row.name==='未来角色'),false);
  restoreMemoryCheckpoint(f.database,'owner','story',early);
  assert.equal(listMemoryActors(f.database,'owner','story').actors.some(row=>row.name==='未来角色'),false);
  assert.equal(f.dossier('mira').memories.some(row=>row.content==='未来记忆'),false);
});

test('actor batches validate all records before one revision-guarded, idempotent canonical commit',t=>{
  const f=fixture(t);
  const request={expectedRevision:0,idempotencyKey:'batch',records:[{content:'第一条'},{content:'第二条',participants:['noel']}]};
  const first=appendMemoryActorRecords(f.database,'owner','story','twin',request);
  assert.equal(first.eventIds.length,2);assert.equal(f.revision(),1);assert.equal(f.dossier('twin').counts.memories,2);assert.equal(f.dossier('mira').counts.memories,0);
  const count=f.database.prepare('SELECT COUNT(*) n FROM jobs').get().n;
  assert.equal(appendMemoryActorRecords(f.database,'owner','story','twin',request).duplicate,true);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM jobs').get().n,count);
  assert.throws(()=>appendMemoryActorRecords(f.database,'owner','story','twin',{...request,records:[{content:'不同内容'}]}),error=>error.status===409);
  assert.throws(()=>appendMemoryActorRecords(f.database,'owner','story','twin',{...request,idempotencyKey:'stale'}),error=>error.code==='MEMORY_REVISION_CHANGED');
  for(const records of [[{content:'合法'},{content:'越界',participants:['foreign']}],Array.from({length:81},()=>({content:'超限'})),[{content:'非法字段',subjectEntityId:'foreign'}]])
    assert.throws(()=>appendMemoryActorRecords(f.database,'owner','story','mira',{expectedRevision:1,idempotencyKey:'bad',records}),error=>error.status===400);
  assert.equal(f.revision(),1);assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_events').get().n,2);
});

test('text patches preserve exact associations, scheduled claims, false beliefs, plot threads and domain links',t=>{
  const f=fixture(t);f.message('turn');f.scene();
  f.commit({messageId:'turn',events:[{key:'original',subjectEntityId:'twin',participants:['mira'],actorIds:['twin'],visibility:'restricted',content:'钥匙原在地窖'}],
    claims:[{eventKey:'original',subjectEntityId:'twin',predicate:'owns',objectEntityId:'key',value:{quantity:3}},
      {eventKey:'original',subjectEntityId:'twin',predicate:'future',value:'未来',validFrom:5}],
    knowledge:[{eventKey:'original',actorEntityId:'noel',epistemicState:'false_belief',beliefContent:'钥匙在阁楼'}],
    threads:[{eventKey:'original',id:'find-key',ownerEntityId:'noel',kind:'clue',title:'寻找钥匙',resolutionTrigger:'找到铜钥匙'}],
    domainRefs:[{eventKey:'original',domain:'scene_object',recordId:'scene-key',revision:'1'}]});
  const checkpoint=captureMemoryCheckpoint(f.database,'owner','story');const original=f.dossier('twin').memories[0];
  const request={expectedRevision:f.revision(),revision:original.revision,eventId:original.eventId,idempotencyKey:'patch',content:'钥匙现在位于书房'};
  const receipt=patchMemoryActorRecord(f.database,'owner','story','twin',original.id,request);
  const current=f.dossier('twin');assert.equal(current.memories[0].content,request.content);assert.equal(current.memories[0].id,original.id);
  assert.equal(current.events[0].subjectEntityId,'twin');assert.deepEqual(current.events[0].participants,['mira']);assert.equal(current.items[0].recordId,'scene-key');
  assert.equal(f.dossier('noel',{viewerActorId:'noel'}).memories[0].content,'钥匙在阁楼');
  const claims=listCurrentMemoryClaims(f.database,'owner','story',{asOfOrder:5});assert.equal(claims.some(row=>row.predicate==='future'),true);
  const knowledge=listCurrentMemoryKnowledge(f.database,'owner','story').find(row=>row.event_id===receipt.eventIds[0]);assert.equal(knowledge.epistemic_state,'false_belief');
  assert.equal(listCurrentMemoryThreads(f.database,'owner','story')[0].thread_key,'find-key');
  const evidence=f.database.prepare('SELECT * FROM memory_evidence WHERE event_id=?').all(receipt.eventIds[0]);assert.equal(evidence[0].source_kind,'author');
  assert.equal(patchMemoryActorRecord(f.database,'owner','story','twin',original.id,request).duplicate,true);
  assert.throws(()=>patchMemoryActorRecord(f.database,'owner','story','twin',original.id,{...request,idempotencyKey:'stale'}),error=>error.status===409);
  assert.throws(()=>patchMemoryActorRecord(f.database,'owner','story','outsider',original.id,{...request,idempotencyKey:'outside'}),error=>error.status===404);
  restoreMemoryCheckpoint(f.database,'owner','story',checkpoint);
  assert.equal(listMemoryRecords(f.database,'owner','story')[0].content,'钥匙原在地窖');assert.equal(f.dossier('twin').items[0].recordId,'scene-key');
  assert.throws(()=>patchMemoryActorRecord(f.database,'owner','story','twin',original.id,request),error=>error.status===409);
});

test('actor counts and pages cover more than one thousand records without truncating the dossier',t=>{
  const f=fixture(t);
  const insert=f.database.prepare(`INSERT INTO memory_events(id,user_id,conversation_id,memory_id,kind,subject_entity_id,content,narrative_order,source_hash,created_at)
    VALUES(?,'owner','story',?,'event','mira',?,0,'hash','now')`);
  f.database.exec('BEGIN');
  for(let index=0;index<1051;index++)insert.run(`long-${String(index).padStart(4,'0')}`,`memory-${index}`,`第${index}条`);
  f.database.exec('COMMIT');
  const first=f.dossier('mira',{limit:500});assert.equal(first.counts.memories,1051);assert.equal(first.memories.length,500);assert.equal(first.pagination.hasMore,true);
  const last=f.dossier('mira',{offset:1000,limit:500});assert.equal(last.memories.length,51);assert.equal(last.pagination.hasMore,false);
  assert.equal(listMemoryActors(f.database,'owner','story').actors.find(row=>row.id==='mira').counts.memories,1051);
});

test('the existing review editor preserves graph associations and same-name identity across text and pin edits',t=>{
  const f=fixture(t);f.message('turn');f.scene();f.entity('cellar','地窖','place');
  f.commit({messageId:'turn',sources:[{messageId:'turn',revision:1}],events:[{key:'original',kind:'utterance',subjectEntityId:'twin',locationEntityId:'cellar',narrativeTime:'深夜',
    participants:['mira'],actorIds:['twin'],visibility:'restricted',content:'钥匙仍在地窖',evidence:[{messageId:'turn',quote:'铜钥匙'}]}],
    claims:[{eventKey:'original',subjectEntityId:'twin',predicate:'owns',objectEntityId:'key',value:{quantity:3}},
      {eventKey:'original',subjectEntityId:'twin',predicate:'future',value:'未来',validFrom:5}],
    knowledge:[{eventKey:'original',actorEntityId:'noel',epistemicState:'false_belief',beliefContent:'钥匙在阁楼'}],
    threads:[{eventKey:'original',id:'find-key',ownerEntityId:'noel',kind:'clue',title:'寻找钥匙'}],
    domainRefs:[{eventKey:'original',domain:'scene_object',recordId:'scene-key',revision:'1'}]});
  const original=f.dossier('twin').memories[0];
  const edited=updateConversationMemory(f.database,'owner','story',original.id,{revision:original.revision,content:'关于钥匙的措辞修订'});
  pinConversationMemory(f.database,'owner','story',original.id,{revision:edited.revision,pinned:true});
  const current=f.dossier('twin');assert.equal(current.memories[0].content,'关于钥匙的措辞修订');assert.equal(current.events[0].subjectEntityId,'twin');
  assert.equal(current.events[0].kind,'utterance');assert.deepEqual(current.events[0].participants,['mira']);assert.equal(current.items[0].recordId,'scene-key');
  const stored=listMemoryRecords(f.database,'owner','story')[0];assert.equal(stored.location_entity_id,'cellar');assert.equal(stored.narrative_time,'深夜');
  assert.equal(f.dossier('noel',{viewerActorId:'noel'}).memories[0].content,'钥匙在阁楼');
  assert.equal(listCurrentMemoryClaims(f.database,'owner','story',{asOfOrder:5}).some(row=>row.predicate==='future'),true);
  assert.equal(listCurrentMemoryThreads(f.database,'owner','story')[0].thread_key,'find-key');
  const textEvent=f.database.prepare('SELECT id FROM memory_events WHERE memory_id=? AND memory_revision=?').get(original.id,edited.revision);
  assert.equal(f.database.prepare('SELECT source_kind FROM memory_evidence WHERE event_id=?').get(textEvent.id).source_kind,'author');
  assert.equal(f.database.prepare('SELECT source_kind FROM memory_evidence WHERE event_id=?').get(stored.id).source_kind,'author');
});

test('legacy invalidation and deletion do not revive typed graph facts, and plain merges cannot discard structured dependents',t=>{
  const f=fixture(t);f.message('turn');
  f.commit({messageId:'turn',events:[{key:'structured',subjectEntityId:'mira',content:'米拉拥有钥匙'},{key:'plain',subjectEntityId:'mira',content:'纯文本记录'}],
    claims:[{eventKey:'structured',subjectEntityId:'mira',objectEntityId:'key',predicate:'owns'}],
    knowledge:[{eventKey:'structured',actorEntityId:'noel',epistemicState:'knows'}],
    threads:[{eventKey:'structured',ownerEntityId:'noel',title:'找钥匙',id:'key-thread'}]});
  const records=f.dossier('mira').memories;const structured=records.find(row=>row.content==='米拉拥有钥匙');const plain=records.find(row=>row.content==='纯文本记录');
  const before=f.revision();
  assert.throws(()=>mergeConversationMemories(f.database,'owner','story',{targetId:plain.id,targetRevision:plain.revision,
    sourceItems:[{id:structured.id,revision:structured.revision}],content:'合并文本'}),error=>error.status===409);
  assert.throws(()=>updateConversationMemory(f.database,'owner','story',structured.id,{revision:structured.revision,truthStatus:'false'}),error=>error.code==='MEMORY_STRUCTURED_SCOPE_CHANGED');
  assert.equal(f.revision(),before);assert.equal(f.dossier('mira').items.length,1);
  disableConversationMemory(f.database,'owner','story',structured.id);
  assert.equal(f.dossier('mira').items.length,0);assert.equal(listCurrentMemoryClaims(f.database,'owner','story').length,0);assert.equal(f.dossier('noel').counts.memories,0);
  confirmConversationMemory(f.database,'owner','story',structured.id);
  assert.equal(f.dossier('mira').items.length,0);assert.equal(f.dossier('noel').counts.memories,0);
  deleteConversationMemory(f.database,'owner','story',structured.id);
  assert.equal(f.dossier('mira').memories.some(row=>row.id===structured.id),false);
});

test('knowledge-only merge dependencies are protected even when the legacy interval guard would allow merging',t=>{
  const f=fixture(t);f.message('turn');
  f.commit({messageId:'turn',events:[{key:'source',subjectEntityId:'mira',content:'知情来源'},{key:'target',subjectEntityId:'mira',content:'另一条文本'}],
    knowledge:[{eventKey:'source',actorEntityId:'noel',epistemicState:'knows'}]});
  const records=f.dossier('mira').memories;const source=records.find(row=>row.content==='知情来源');const target=records.find(row=>row.content==='另一条文本');
  assert.throws(()=>mergeConversationMemories(f.database,'owner','story',{targetId:target.id,targetRevision:target.revision,
    sourceItems:[{id:source.id,revision:source.revision}]}),error=>error.code==='MEMORY_STRUCTURED_MERGE_UNSAFE');
  assert.equal(f.dossier('noel').counts.memories,1);assert.equal(f.revision(),1);
});

test('branch dossiers remap actor and domain IDs while preserving only the selected prefix',t=>{
  const f=fixture(t);f.message('early');f.scene();
  f.commit({messageId:'early',events:[{key:'key',subjectEntityId:'mira',content:'早期钥匙'}],
    claims:[{eventKey:'key',subjectEntityId:'mira',predicate:'owns',objectEntityId:'key'}],
    domainRefs:[{eventKey:'key',domain:'scene_object',recordId:'scene-key'}]});
  writeConversationCheckpoint(f.database,'owner','story',{throughMessageId:'early'});
  f.message('late');f.commit({messageId:'late',entities:[{key:'future',name:'未来角色',kind:'actor'}],events:[{key:'late',subjectEntityId:'mira',content:'未来事件'}]});
  const branch=branchConversation(f.database,'owner','story','early');
  const actors=listMemoryActors(f.database,'owner',branch.id).actors;assert.equal(actors.some(row=>row.name==='未来角色'),false);
  const actor=actors.find(row=>row.castKey==='main-character');assert.notEqual(actor.id,'mira');
  const dossier=readMemoryActorDossier(f.database,'owner',branch.id,actor.id);assert.deepEqual(dossier.memories.map(row=>row.content),['早期钥匙']);
  assert.equal(dossier.items[0].quantity,3);assert.notEqual(dossier.items[0].recordId,'scene-key');assert.equal(dossier.items[0].authoritative,true);
  assert.throws(()=>readMemoryActorDossier(f.database,'owner',branch.id,'mira'),error=>error.status===404);
  assert.equal(f.database.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('actor HTTP transport is authenticated, no-store, and applies bounded author changes',async t=>{
  const f=fixture(t);const app=express();app.use(express.json());
  app.use('/api',createConversationMemoriesRouter({db:f.database,requireAuth:(request,response,next)=>{request.auth={user:{id:'owner'}};next();}}));
  await withServer(app,async base=>{
    const url=`${base}/api/conversations/story/memory-state/actors`;
    const list=await fetch(url);assert.equal(list.status,200);assert.equal(list.headers.get('cache-control'),'no-store');
    const batch=await fetch(`${url}/mira/records/batch`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,idempotencyKey:'http',records:[{content:'HTTP记忆'}]})});
    assert.equal(batch.status,200);const dossier=await fetch(`${url}/mira`).then(response=>response.json());
    const record=dossier.memories[0];
    const patch=await fetch(`${url}/mira/records/${record.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:dossier.revision,revision:record.revision,eventId:record.eventId,content:'HTTP修订',idempotencyKey:'http-patch'})});
    assert.equal(patch.status,200);assert.equal(f.dossier('mira').memories[0].content,'HTTP修订');
    assert.equal((await fetch(`${url}/foreign`)).status,404);
  });
});
