import { DatabaseSync } from 'node:sqlite';
import { captureConversationSnapshot, SNAPSHOT_STATE_TABLES } from '../../repositories/conversationSnapshotRepository.js';
import { memoryHash, MemoryRevisionError } from '../../domain/conversationMemory/contracts.js';

/** Run existing authoritative domain services on a private state copy; only their validated SQL plan is retained. */
export function createDomainPlanningSession(database,userId,conversationId) {
  // Snapshot services also use postprocessing; defer the table list until the import graph has initialized.
  const domainTables=SNAPSHOT_STATE_TABLES.filter(table=>!table.startsWith('conversation_memor')&&!table.startsWith('conversation_world_book'));
  const staging=new DatabaseSync(':memory:');
  const snapshot=()=>captureConversationSnapshot(database,userId,conversationId,{includeMessages:false,compactMemory:true});
  const before=snapshot();
  const signature=value=>memoryHash(Object.fromEntries(domainTables.map(table=>[table,value.state[table]])));
  const expected=signature(before);
  const names=[...domainTables,'automation_audit_events'];
  const pattern=new RegExp(`\\b(?:${names.join('|')})\\b`,'i');
  for(const [table,rows] of [
    ['users',database.prepare('SELECT * FROM users WHERE id=?').all(userId)],
    ['characters',database.prepare('SELECT * FROM characters WHERE id=(SELECT character_id FROM conversations WHERE id=? AND user_id=?)').all(conversationId,userId)],
    ['conversations',database.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').all(conversationId,userId)]
  ]) {
    staging.exec(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql);
    for(const row of rows) {
      const keys=Object.keys(row);
      staging.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?')})`).run(...keys.map(key=>row[key]));
    }
  }
  for(const table of names) {
    const definition=database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if(!definition?.sql) continue;
    staging.exec(definition.sql);
    const rows=before.state[table]||[];
    for(const row of rows) {
      const columns=Object.keys(row);
      staging.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?')})`).run(...columns.map(key=>row[key]));
    }
    for(const index of database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table)) staging.exec(index.sql);
  }
  const operations=[]; const savepoints=[];
  let closed=false;
  const assertOpen=()=>{if(closed)throw new Error('Domain planning session already closed');};
  const facade={
    prepare(sql) {
      assertOpen();
      const statementText=sql.replace(/'(?:''|[^'])*'/g,"''").replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\r\n]*/g,' ');
      const local=pattern.test(statementText);
      const write=/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(statementText);
      const target=local?staging:database;
      if(write&&!local&&!/\b(?:provider_[a-z_]+|user_daily_usage|user_quotas|ai_tool_executions)\b/i.test(statementText))
        throw new Error('Domain planning attempted an unregistered write');
      const statement=target.prepare(sql);
      return new Proxy(statement,{get(query,key){const value=Reflect.get(query,key,query);
        if(typeof value!=='function')return value;
        return(...args)=>{
          assertOpen();
          const result=value.apply(query,args);
          if(local&&write)operations.push({sql,args,changes:result?.changes});
          return result;
        };
      }});
    },
    exec(sql) {
      assertOpen();
      if(/^SAVEPOINT\s+/i.test(sql))savepoints.push({name:sql.trim().split(/\s+/)[1],index:operations.length});
      if(/^ROLLBACK TO SAVEPOINT\s+/i.test(sql)) {
        const name=sql.trim().split(/\s+/).at(-1); const point=savepoints.findLast(item=>item.name===name);
        if(point)operations.length=point.index;
      }
      if(!/^(?:SAVEPOINT|RELEASE|ROLLBACK|PRAGMA)\b/i.test(sql.trim()))throw new Error('Unregistered domain planning statement');
      return staging.exec(sql);
    }
  };
  return {database:facade,
    apply() {
      assertOpen();
      if(signature(snapshot())!==expected)throw new MemoryRevisionError('领域状态在计划期间已变化','MEMORY_DOMAIN_CHANGED');
      for(const operation of operations) {
        const result=database.prepare(operation.sql).run(...operation.args);
        if(operation.changes!==undefined&&result.changes!==operation.changes)throw new MemoryRevisionError('领域命令版本已变化','MEMORY_DOMAIN_CHANGED');
      }
      return {operations:operations.length};
    },
    close(){if(!closed){closed=true;staging.close();}}
  };
}

/** Domain planners share the extractor's evidence, including unresolved attempts, instead of reinterpreting raw history. */
export function memoryPacketObservation(packet={}) {
  const events=(packet.events||[]).filter(event=>event.lifecycle!=='candidate'&&event.lifecycle!=='rejected');
  const attempts=events.filter(event=>['attempt','intent'].includes(event.kind));
  const observations=events.filter(event=>!['attempt','intent','hypothesis','inference','rumor'].includes(event.kind));
  const render=rows=>rows.map(event=>JSON.stringify({kind:event.kind,truth:event.truthStatus,content:event.content,evidence:event.evidence||[]})).join('\n');
  return {user:render(attempts),assistant:render(observations)};
}
