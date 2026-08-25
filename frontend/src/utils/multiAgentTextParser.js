/**
 * 多角色文本特殊解析器
 * Multi-Agent Text Parser
 *
 * 把 AI 回复解析为结构化的「角色片段」：
 * - dialogue    ：对话（「…」/ "…" / 『…』引号内容）
 * - action      ：动作/旁白（*…* / —…— / 【…】）
 * - thought     ：内心想法（(…) / （…）括号内容）
 * - scene       ：场景转换（[Scene: …] / 【场景：…】）
 * - narration   ：其余叙事文本
 *
 * 参考 SillyTavern 风格的文本标记约定。
 */

const DIALOGUE_QUOTES = [
  { open: '「', close: '」' },
  { open: '『', close: '』' },
  { open: '"', close: '"' },
  { open: '“', close: '”' },
  { open: '‘', close: '’' }
];

export function parseMultiAgentText(text = '') {
  const source = String(text || '');
  if (!source.trim()) {
    return { blocks: [], speakers: [] };
  }

  const blocks = [];
  const speakers = new Set();
  let cursor = 0;
  const length = source.length;

  // 扫描段内标记，逐段切分
  let buffer = '';
  while (cursor < length) {
    const char = source[cursor];

    // 场景标记：[Scene: xxx] 或 【场景：xxx】 或 [xxx: xxx]
    const sceneMatch = source.slice(cursor).match(/^\[(?:Scene|场景)\s*[:：]\s*([^\]]{1,80})\]/);
    if (sceneMatch) {
      flushNarration(buffer);
      buffer = '';
      blocks.push({ type: 'scene', content: sceneMatch[1].trim(), raw: sceneMatch[0] });
      cursor += sceneMatch[0].length;
      continue;
    }

    // 引号对话
    const quote = DIALOGUE_QUOTES.find((q) => source.startsWith(q.open, cursor));
    if (quote) {
      const endIndex = source.indexOf(quote.close, cursor + quote.open.length);
      if (endIndex !== -1) {
        flushNarration(buffer);
        buffer = '';
        const dialogue = source.slice(cursor + quote.open.length, endIndex);
        const afterEnd = endIndex + quote.close.length;
        // 引号后的说话人归属："你好" said Bob
        const attribution = source.slice(afterEnd, afterEnd + 40).match(/^[\s,，]*(?:said|says|说|说道|问道|喊道|答道|低声说|笑着说)\s*[:：]?\s*([^\s，。,.!！?？]{1,20})/i);
        let speaker = '';
        if (attribution) {
          speaker = attribution[1].trim();
          speakers.add(speaker);
          blocks.push({ type: 'dialogue', content: dialogue.trim(), speaker, raw: source.slice(cursor, afterEnd + attribution[0].length) });
          cursor = afterEnd + attribution[0].length;
        } else {
          // 引号内包含角色名的行内归属："我来了"——林娜
          const dashAttribution = source.slice(afterEnd, afterEnd + 30).match(/^[\s,，]*[———\-]{1,3}\s*([^\s，。,.!！?？]{1,20})/);
          if (dashAttribution) {
            speaker = dashAttribution[1].trim();
            speakers.add(speaker);
            blocks.push({ type: 'dialogue', content: dialogue.trim(), speaker, raw: source.slice(cursor, afterEnd + dashAttribution[0].length) });
            cursor = afterEnd + dashAttribution[0].length;
          } else {
            blocks.push({ type: 'dialogue', content: dialogue.trim(), speaker: '', raw: source.slice(cursor, endIndex + 1) });
            cursor = endIndex + quote.close.length;
          }
        }
        continue;
      }
    }

    // 动作标记：*…* 或 —…—
    if (char === '*' || char === '—') {
      const marker = char;
      const endIndex = source.indexOf(marker, cursor + 1);
      if (endIndex !== -1) {
        flushNarration(buffer);
        buffer = '';
        blocks.push({ type: 'action', content: source.slice(cursor + 1, endIndex).trim(), raw: source.slice(cursor, endIndex + 1) });
        cursor = endIndex + 1;
        continue;
      }
    }

    // 内心想法：(…) 或 （…）
    if (char === '(' || char === '（') {
      const close = char === '(' ? ')' : '）';
      const endIndex = source.indexOf(close, cursor + 1);
      if (endIndex !== -1) {
        flushNarration(buffer);
        buffer = '';
        blocks.push({ type: 'thought', content: source.slice(cursor + 1, endIndex).trim(), raw: source.slice(cursor, endIndex + 1) });
        cursor = endIndex + 1;
        continue;
      }
    }

    // 【…】动作/场景块
    if (char === '【') {
      const endIndex = source.indexOf('】', cursor + 1);
      if (endIndex !== -1) {
        flushNarration(buffer);
        buffer = '';
        const inner = source.slice(cursor + 1, endIndex);
        if (/^(场景|Scene)/.test(inner)) {
          blocks.push({ type: 'scene', content: inner.replace(/^(场景|Scene)\s*[:：]?\s*/, '').trim(), raw: source.slice(cursor, endIndex + 1) });
        } else {
          blocks.push({ type: 'action', content: inner.trim(), raw: source.slice(cursor, endIndex + 1) });
        }
        cursor = endIndex + 1;
        continue;
      }
    }

    buffer += char;
    cursor += 1;
  }
  flushNarration(buffer);

  function flushNarration(chunk) {
    const narration = String(chunk || '').trim();
    if (!narration) {
      return;
    }
    // 行首角色名归属：林娜：你好 或 林娜: 你好
    const lineMatch = narration.match(/^([^\s：:]{1,20})\s*[:：]\s*(.+)$/);
    if (lineMatch) {
      const speaker = lineMatch[1].trim();
      speakers.add(speaker);
      blocks.push({ type: 'dialogue', content: lineMatch[2].trim(), speaker, raw: narration });
      return;
    }
    blocks.push({ type: 'narration', content: narration, speaker: '', raw: narration });
  }

  return {
    blocks,
    speakers: [...speakers]
  };
}

/**
 * 提取一段文本中出现的角色名（用于发言归属）。
 */
export function extractSpeakerNames(blocks = []) {
  const speakers = new Set();
  for (const block of blocks) {
    if (block.type === 'dialogue' && block.speaker) {
      speakers.add(block.speaker);
    }
  }
  return [...speakers];
}

/**
 * 判断文本是否包含多角色发言（多个不同 speaker 的 dialogue 块）。
 */
export function isMultiSpeakerText(text = '') {
  const { speakers } = parseMultiAgentText(text);
  return speakers.length > 1;
}

/**
 * 把解析结果渲染为纯文本摘要（调试用）。
 */
export function summarizeParsedText(text = '') {
  const { blocks } = parseMultiAgentText(text);
  return blocks.map((block) => `[${block.type}]${block.speaker ? ` ${block.speaker}:` : ''} ${block.content.slice(0, 40)}`).join('\n');
}
