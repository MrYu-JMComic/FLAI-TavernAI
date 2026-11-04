import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAppDatabase } from '../db/runtime.js';
import { createCharacter,getCharacter,updateCharacter } from '../modules/characters.js';
import { normalizeAccessorySkills } from '../modules/advancedSettings.js';
import { createConversationSettingsRouter } from '../routes/conversationSettings.js';
import { createCharacterSchema,saveConversationAccessorySkillsSchema } from '../validations/schemas.js';
import { getConversationForUser } from '../routes/helpers.js';
import { runConversationMemoryAgent } from '../services/conversationMemoryAgent.js';
import { commitMemoryPacket } from '../services/conversationMemory/commit.js';
import { runMemorySummaryJob } from '../services/conversationMemory/derivedJobs.js';
import { getCharacterAssistantToolDefinitions } from '../services/characterAssistant.js';
import { submitJob,claimNextJob } from '../services/jobs/jobQueue.js';
import { createProviderProfile } from '../repositories/providerProfileRepository.js';
import { encryptSecret } from '../security.js';
import { withServer } from './routeTestUtils.js';
import { THINKING_LEVELS } from '../../../shared/providerThinking.js';

const provider={providerType:'custom',gatewayName:'Test',baseUrl:'https://memory-thinking.test/v1',model:'memory-model',
  apiKey:'fixture-key',supportsReasoning:true,thinkingLevel:'low',extraBody:{}};

/** Exercise persisted author defaults and real request adapters with isolated storage and intercepted HTTP only. */
function fixture(t,thinkingLevel='') {
  const database=createAppDatabase(':memory:');t.after(()=>database.close());
  const userId='thinking-owner',conversationId='thinking-story';
  database.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,'now')").run(userId,userId,'hash');
  const character=createCharacter(database,userId,{name:'Mira',authorAdvancedSettings:{accessorySkills:{memoryAgent:{enabled:true,thinkingLevel}}}});
  database.prepare("INSERT INTO conversations(id,user_id,character_id,title,state_status,created_at,updated_at) VALUES(?,?,?,'Thinking','ready','now','now')")
    .run(conversationId,userId,character.id);
  const userMessage={id:'user-turn',role:'user',content:'Remember the key handover.'};
  const assistantMessage={id:'assistant-turn',role:'assistant',content:'Mira received the key.'};
  for(const [index,message] of [userMessage,assistantMessage].entries())
    database.prepare('INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?,?)')
      .run(message.id,userId,conversationId,message.role,message.content,`2026-11-01T00:00:0${index}Z`);
  const conversation=()=>getConversationForUser(database,userId,conversationId,{includeUsage:false});
  const author=level=>updateCharacter(database,userId,character.id,{authorAdvancedSettings:{accessorySkills:{memoryAgent:{enabled:true,thinkingLevel:level}}}});
  return {database,userId,conversationId,character,userMessage,assistantMessage,conversation,author};
}

function json(value) {return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});}
function finishResponse() {return json({choices:[{message:{role:'assistant',content:null,tool_calls:[
  {id:'finish',type:'function',function:{name:'finish_memory_review',arguments:'{}'}}]}}]});}

test('memory thinking levels survive normalization, author persistence, HTTP overrides and restored inheritance',async t=>{
  const f=fixture(t,'high');
  for(const level of ['',...THINKING_LEVELS]) {
    const body={name:'Mira',authorAdvancedSettings:{accessorySkills:{memoryAgent:{thinkingLevel:level}}}};
    assert.equal(createCharacterSchema.parse(body).authorAdvancedSettings.accessorySkills.memoryAgent.thinkingLevel,level);
    assert.equal(saveConversationAccessorySkillsSchema.parse({accessorySkills:{memoryAgent:{thinkingLevel:level}}}).accessorySkills.memoryAgent.thinkingLevel,level);
    assert.equal(normalizeAccessorySkills({memoryAgent:{thinkingLevel:level}}).memoryAgent.thinkingLevel,level);
  }
  assert.equal(normalizeAccessorySkills({memoryAgent:{thinkingLevel:'invalid'}}).memoryAgent.thinkingLevel,'');
  assert.equal(saveConversationAccessorySkillsSchema.safeParse({accessorySkills:{memoryAgent:{thinkingLevel:'invalid'}}}).success,false);
  assert.equal(getCharacter(f.database,f.userId,f.character.id).authorAdvancedSettings.accessorySkills.memoryAgent.thinkingLevel,'high');
  const app=express();app.use(express.json());
  app.use('/api/conversations/:id',createConversationSettingsRouter({db:f.database,requireAuth:(request,response,next)=>{request.auth={user:{id:f.userId}};next();}}));
  await withServer(app,async base=>{
    const url=`${base}/api/conversations/${f.conversationId}/accessory-skills`;
    const patch=body=>fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await patch({accessorySkills:{memoryAgent:{thinkingLevel:'off'}}})).status,200);
    assert.equal(f.conversation().settings.accessorySkills.memoryAgent.thinkingLevel,'off');
    f.author('max');assert.equal(f.conversation().settings.accessorySkills.memoryAgent.thinkingLevel,'off','an explicit override remains stable');
    assert.equal((await patch({restoreInheritance:['memoryAgent']})).status,200);
    assert.equal(f.conversation().settings.accessorySkills.memoryAgent.thinkingLevel,'max');
    await patch({accessorySkills:{memoryAgent:{thinkingLevel:''}}});
    assert.equal(f.conversation().settings.accessorySkills.memoryAgent.thinkingLevel,'','an explicit empty level follows the provider');
    const stored=JSON.parse(f.database.prepare('SELECT user_advanced_settings FROM conversations WHERE id=?').get(f.conversationId).user_advanced_settings);
    assert.deepEqual(stored.accessorySkills.memoryAgent,{thinkingLevel:''},'saving thinking alone does not freeze other author defaults');
  });
});

test('memory extraction sends every explicit thinking level and follows the provider when empty',async t=>{
  const f=fixture(t);const requests=[];
  t.mock.method(globalThis,'fetch',async(url,request)=>{requests.push({url,body:JSON.parse(request.body)});return finishResponse();});
  for(const level of ['',...THINKING_LEVELS]) {
    f.author(level);
    await runConversationMemoryAgent({database:f.database,userId:f.userId,conversation:f.conversation(),
      userMessage:f.userMessage,assistantMessage:f.assistantMessage,settings:provider,prepareOnly:true,retryDelaysMs:[]});
    assert.equal(requests.at(-1).body.reasoning_effort,level==='off'?'none':level||'low');
    assert.equal(requests.at(-1).body.model,'memory-model');
  }
  assert.equal(requests.length,THINKING_LEVELS.length+1);
});

test('memory thinking follows its independent selected provider and an explicit override takes priority',async t=>{
  const f=fixture(t);const profile=createProviderProfile(f.database,f.userId,{providerType:'custom',gatewayName:'Memory only',
    baseUrl:'https://memory-independent.test/v1',model:'independent-model',encryptedApiKey:encryptSecret('independent-fixture'),
    supportsReasoning:true,extraBody:{reasoning_effort:'medium'}},{select:false});
  updateCharacter(f.database,f.userId,f.character.id,{authorAdvancedSettings:{accessorySkills:{memoryAgent:{enabled:true,providerProfileId:profile.id,thinkingLevel:''}}}});
  const requests=[];t.mock.method(globalThis,'fetch',async(url,request)=>{requests.push({url,body:JSON.parse(request.body)});return finishResponse();});
  await runConversationMemoryAgent({database:f.database,userId:f.userId,conversation:f.conversation(),userMessage:f.userMessage,assistantMessage:f.assistantMessage,
    settings:provider,prepareOnly:true,retryDelaysMs:[]});
  assert.match(requests[0].url,/memory-independent\.test/);assert.equal(requests[0].body.reasoning_effort,'medium');
  const conversation=f.conversation();conversation.settings.accessorySkills.memoryAgent.thinkingLevel='off';
  await runConversationMemoryAgent({database:f.database,userId:f.userId,conversation,userMessage:f.userMessage,assistantMessage:f.assistantMessage,
    settings:provider,prepareOnly:true,retryDelaysMs:[]});
  assert.equal(requests[1].body.reasoning_effort,'none');
});

test('derived memory summaries use the same thinking preference and do not reuse a different thinking profile',async t=>{
  const f=fixture(t,'off');
  const receipt=commitMemoryPacket(f.database,f.userId,f.conversationId,{messageId:f.assistantMessage.id,
    sources:[{messageId:f.assistantMessage.id,revision:1}],events:[{key:'key',content:f.assistantMessage.content,evidence:[{messageId:f.assistantMessage.id,quote:f.assistantMessage.content}]}]});
  submitJob(f.database,f.userId,'memory.summarize',{conversationId:f.conversationId,timelineRevision:1,memoryRevision:receipt.revision},
    {internal:true,idempotencyKey:'summary-thinking'});
  const job=claimNextJob(f.database,'summary-worker',{types:['memory.summarize']});const requests=[];
  t.mock.method(globalThis,'fetch',async(_url,request)=>{requests.push(JSON.parse(request.body));return json({choices:[{message:{role:'assistant',content:'米拉收到了钥匙。'}}]});});
  const run=()=>runMemorySummaryJob(f.database,{job,payload:job.payload,signal:new AbortController().signal},{settings:provider});
  assert.equal((await run()).summaries,1);assert.equal(requests[0].reasoning_effort,'none');
  f.author('high');assert.equal((await run()).summaries,1);assert.equal(requests[1].reasoning_effort,'high');
  assert.equal((await run()).summaries,0);assert.equal(requests.length,2,'identical profile still reuses the accepted summary');
  f.author('');assert.equal((await run()).summaries,1);assert.equal(requests[2].reasoning_effort,'low');
});

test('character assistant advertises memory thinking choices through the real tool contract',()=>{
  const tools=getCharacterAssistantToolDefinitions();const schema=tools.find(tool=>tool.function.name==='update_character_agents').function.parameters;
  const thinking=schema.properties.accessorySkills.properties.memoryAgent.properties.thinkingLevel;
  assert.deepEqual(thinking.enum,['',...THINKING_LEVELS]);assert.match(thinking.description,/memory extraction and memory summaries/);
});
