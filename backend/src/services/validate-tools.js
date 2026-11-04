// Load every runtime catalog against an isolated database; never inspect or mutate a live story.
process.env.FLAI_DB_PATH = ':memory:';
const { auditAiToolContracts } = await import('./aiToolContractAudit.js');
const report = auditAiToolContracts();
console.log(`AI tool contracts: ${report.tools.length} names, ${report.variants} schema variants, ${report.exceptions.length} documented polymorphic fields.`);
for (const tool of report.tools) console.log(`  ${tool.name} [${tool.domain}/${tool.effect}] (${tool.families.join(', ')})`);
for (const error of report.errors) console.error(`ERROR: ${error}`);
console.log(report.errors.length ? `FAIL: ${report.errors.length} contract errors.` : 'PASS: runtime schema and policy audit. Remote provider compatibility requires provider-specific integration checks.');
process.exitCode = report.errors.length ? 1 : 0;
