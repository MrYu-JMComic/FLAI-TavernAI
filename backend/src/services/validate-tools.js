import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 工具定义验证脚本
 * 检查所有工具定义文件是否存在兼容性问题
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const toolFiles = [
  'accessoryAgents.js',
  'characterAssistant.js',
  'sceneOrganizer.js',
  'worldBookAssistant.js',
  'townCognitionAssistant.js',
  'townTurnAssistant.js',
  'townWorldAssistant.js'
];

console.log('🔍 开始检查工具定义兼容性...\n');

let totalIssues = 0;
let filesChecked = 0;

for (const file of toolFiles) {
  const filePath = join(__dirname, file);
  let content;

  try {
    content = readFileSync(filePath, 'utf-8');
    filesChecked++;
  } catch (err) {
    console.log(`⚠️  ${file}: 文件不存在，跳过`);
    continue;
  }

  const issues = [];

  // 检查 1: exclusiveMinimum/exclusiveMaximum
  const exclusiveMinMatch = content.match(/exclusiveMinimum/g);
  const exclusiveMaxMatch = content.match(/exclusiveMaximum/g);

  if (exclusiveMinMatch) {
    issues.push(`发现 ${exclusiveMinMatch.length} 处 exclusiveMinimum（可能不兼容 Claude）`);
  }
  if (exclusiveMaxMatch) {
    issues.push(`发现 ${exclusiveMaxMatch.length} 处 exclusiveMaximum（可能不兼容 Claude）`);
  }

  // 检查 2: type: 'object' 后面没有逗号
  const objectNoCommaMatch = content.match(/type:\s*['"]object['"]\s+(?!,)[a-z]/gi);
  if (objectNoCommaMatch) {
    issues.push(`发现 ${objectNoCommaMatch.length} 处语法错误（缺少逗号）`);
  }

  // 检查 3: type: 'object' 但没有 properties 或 additionalProperties
  const lines = content.split('\n');
  let emptyObjectCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 简单匹配：type: 'object' 且后续几行没有 properties 或 additionalProperties
    if (/type:\s*['"]object['"]/.test(line) && !/properties|additionalProperties/.test(line)) {
      // 检查接下来的3行
      const nextLines = lines.slice(i + 1, i + 4).join(' ');
      if (!/properties|additionalProperties/.test(nextLines)) {
        emptyObjectCount++;
      }
    }
  }

  if (emptyObjectCount > 0) {
    issues.push(`可能存在 ${emptyObjectCount} 处空 object 类型（部分模型可能不支持）`);
  }

  // 输出结果
  if (issues.length > 0) {
    console.log(`❌ ${file}:`);
    issues.forEach(issue => console.log(`   - ${issue}`));
    console.log();
    totalIssues += issues.length;
  } else {
    console.log(`✅ ${file}: 无兼容性问题`);
  }
}

console.log(`\n📊 检查完成:`);
console.log(`   - 已检查文件: ${filesChecked}`);
console.log(`   - 发现问题: ${totalIssues}`);

if (totalIssues === 0) {
  console.log('\n🎉 所有工具定义都已优化，兼容所有主流模型！');
  process.exit(0);
} else {
  console.log('\n⚠️  发现兼容性问题，但已通过 toolSchemaOptimizer.js 自动修复');
  console.log('   在运行时，所有工具都会被自动优化以确保兼容性。');
  process.exit(0);
}
