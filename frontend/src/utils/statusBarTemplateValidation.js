import {
  STATUS_BAR_TEMPLATE_VALIDATOR_ALLOWED_TAGS,
  STATUS_BAR_TEMPLATE_VOID_TAGS,
  hasDangerousStatusBarCss
} from './statusBarTemplateSecurity.js';
import { validateStatusTemplateSyntax } from '../../../shared/statusTemplateRenderer.js';

// Structural checks shared by the chat status-bar editor and the character
// blueprint editor. Returns raw (possibly repeated) issue strings; callers
// dedupe and cap them for display.
export function collectStatusBarTemplateRawIssues(template) {
  const raw = String(template || '').trim();
  const issues = [];
  if (!raw) {
    return ['自定义模板不能为空；如果只想显示变量，请切回“内置样式”。'];
  }
  if (raw[0] === '{') {
    return [];
  }
  if (/<\s*script\b|<\/\s*script\s*>/i.test(raw)) {
    issues.push('自定义模板不支持 <script> 或 JavaScript。');
  }
  if (/<\s*(iframe|object|embed|link|meta|base|form|input|textarea|select|img|video|audio|svg)\b/i.test(raw)) {
    issues.push('自定义模板只能使用安全展示标签，不支持表单、外链、媒体或嵌入标签。');
  }
  if (/\son[a-z]+\s*=/i.test(raw) || /javascript:/i.test(raw)) {
    issues.push('自定义模板不支持 onClick 等事件属性或 javascript: 链接。');
  }
  if (/\{\{\s*\}\}|\{\s*\}/.test(raw)) {
    issues.push('占位符不能为空，请使用 {{HP}}、{{HP.max}} 或 {HP}。');
  }
  if ((raw.match(/\{\{/g) || []).length !== (raw.match(/\}\}/g) || []).length) {
    issues.push('双花括号占位符数量不匹配，请检查 {{变量}} 是否闭合。');
  }
  for (const issue of validateStatusTemplateSyntax(raw)) {
    issues.push(issue);
  }

  const styleBlocks = raw.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];
  for (const block of styleBlocks) {
    const css = block.replace(/^<style\b[^>]*>/i, '').replace(/<\/style>$/i, '');
    if (hasDangerousStatusBarCss(css)) {
      issues.push('CSS 不支持 @import、url()、expression()、behavior 或 javascript:。');
      break;
    }
    if (!hasBalancedCssBraces(css)) {
      issues.push('CSS 花括号不成对，请检查 <style> 里的规则。');
      break;
    }
  }

  const stack = [];
  const tagPattern = /<\s*(\/?)([a-z][\w:-]*)(?:\s[^<>]*)?>/gi;
  let match;
  while ((match = tagPattern.exec(raw))) {
    const tag = match[2].toLowerCase();
    const isClosing = match[1] === '/';
    const tagText = match[0];
    if (!STATUS_BAR_TEMPLATE_VALIDATOR_ALLOWED_TAGS.has(tag)) {
      issues.push(`不支持 <${tag}> 标签；请改用 div/span/p/ul/li/table 等展示标签。`);
      continue;
    }
    if (isClosing) {
      const previous = stack.pop();
      if (previous !== tag) {
        issues.push(`标签闭合顺序不正确：遇到 </${tag}>，但上一个未闭合标签是 <${previous || '无'}>。`);
        break;
      }
      continue;
    }
    if (!STATUS_BAR_TEMPLATE_VOID_TAGS.has(tag) && !/\/\s*>$/.test(tagText)) {
      stack.push(tag);
    }
  }
  if (stack.length) {
    issues.push(`标签未闭合：<${stack[stack.length - 1]}>。`);
  }

  return issues;
}

function hasBalancedCssBraces(css) {
  let depth = 0;
  for (const char of String(css || '')) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}
