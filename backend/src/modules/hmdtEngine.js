/**
 * HMDT 分层人格记忆推演算法引擎
 * Hierarchical Memory Dynamic Traits Algorithm Engine
 *
 * 核心四大模块：
 * 1. 人格锚定层（固定基底，杜绝人设崩塌）
 * 2. 分层记忆存储层（区分瞬时/短期/长期/核心档案）
 * 3. 情绪动态计算层（量化情绪值驱动语气行为）
 * 4. 剧情推演约束层（对话生成校验，强制贴合角色）
 */

import { nowIso } from '../security.js';
import { clampNumber } from '../utils/number.js';

// ============================================
// 模块1：人格锚定层（Personality Anchoring）
// ============================================

/**
 * 创建人格锚定档案
 * @param {object} params - 角色元数据
 * @returns {object} 人格锚定对象
 */
export function createPersonalityAnchor(params) {
  const {
    name,
    identity,
    age,
    traitVector = {},
    speechStyle = {},
    taboos = [],
    coreValues = [],
    backstory = {}
  } = params;

  // 性格多维量化向量（0-100分）
  const normalizedTraits = {
    gentle: clampNumber(traitVector.gentle, 0, 100, 50),      // 温柔
    irritable: clampNumber(traitVector.irritable, 0, 100, 50), // 暴躁
    cautious: clampNumber(traitVector.cautious, 0, 100, 50),   // 谨慎
    greedy: clampNumber(traitVector.greedy, 0, 100, 50),       // 贪婪
    aloof: clampNumber(traitVector.aloof, 0, 100, 50),         // 高冷
    confident: clampNumber(traitVector.confident, 0, 100, 50), // 自信
    curious: clampNumber(traitVector.curious, 0, 100, 50),     // 好奇
    loyal: clampNumber(traitVector.loyal, 0, 100, 50)          // 忠诚
  };

  return {
    name,
    identity,
    age: clampNumber(age, 1, 200, 18),
    traitVector: normalizedTraits,
    speechStyle: {
      formality: speechStyle.formality || 'casual',      // formal/casual/mixed
      verbosity: speechStyle.verbosity || 'moderate',    // brief/moderate/verbose
      emoticons: speechStyle.emoticons || false,
      quirks: speechStyle.quirks || []                   // 口头禅/语气词
    },
    taboos: Array.isArray(taboos) ? taboos : [],         // 禁忌行为/话题
    coreValues: Array.isArray(coreValues) ? coreValues : [], // 核心价值观（优先级最高）
    backstory: {
      core: backstory.core || '',                        // 核心背景
      majorEvents: backstory.majorEvents || []           // 重大人生事件
    },
    createdAt: nowIso()
  };
}

/**
 * 验证行为是否违背人格锚定
 * @param {object} anchor - 人格锚定
 * @param {string} action - 待验证的行为/对话
 * @returns {object} { valid, violations, confidence }
 */
export function validateAgainstAnchor(anchor, action) {
  const violations = [];
  const actionLower = action.toLowerCase();

  // 检查禁忌词
  for (const taboo of anchor.taboos) {
    if (actionLower.includes(taboo.toLowerCase())) {
      violations.push({
        type: 'taboo',
        item: taboo,
        severity: 'critical'
      });
    }
  }

  // 检查价值观冲突（简化版，实际可用向量相似度）
  for (const value of anchor.coreValues) {
    const valueKeywords = value.keywords || [];
    const contradictKeywords = value.contradict || [];

    for (const keyword of contradictKeywords) {
      if (actionLower.includes(keyword.toLowerCase())) {
        violations.push({
          type: 'value_conflict',
          item: value.name,
          severity: 'high'
        });
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    confidence: violations.length === 0 ? 1.0 : Math.max(0, 1 - violations.length * 0.3)
  };
}

// ============================================
// 模块2：四层分层记忆检索（Layered Memory）
// ============================================

const MEMORY_LAYERS = {
  CORE: 'core',           // 核心永久记忆
  LONG_TERM: 'long_term', // 长期记忆
  SHORT_TERM: 'short_term', // 短期记忆
  TRANSIENT: 'transient'  // 瞬时缓存
};

const MEMORY_WEIGHTS = {
  core: 100,
  long_term: 60,
  short_term: 30,
  transient: 10
};

/**
 * 计算记忆重要度（用于自动分层）
 * @param {object} memory - 记忆对象
 * @returns {number} 重要度分数 0-100
 */
export function calculateMemoryImportance(memory) {
  let score = 0;

  // 基础类型权重
  const typeWeights = {
    relationship: 30,
    event: 25,
    preference: 15,
    location: 10,
    fact: 20,
    summary: 35
  };
  score += typeWeights[memory.memoryType] || 10;

  // 情绪强度加分
  if (memory.emotionalIntensity) {
    score += memory.emotionalIntensity * 0.3;
  }

  // 置信度加分
  if (memory.confidence) {
    score += memory.confidence * 0.2;
  }

  // 关键词加分（重大事件）
  const criticalKeywords = ['告白', '冲突', '约定', '死亡', '背叛', '相遇', '离别', '承诺'];
  const content = (memory.content || '').toLowerCase();
  for (const keyword of criticalKeywords) {
    if (content.includes(keyword)) {
      score += 15;
    }
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * 自动分配记忆层级
 * @param {number} importance - 重要度分数
 * @returns {string} 层级标识
 */
export function assignMemoryLayer(importance) {
  if (importance >= 80) return MEMORY_LAYERS.CORE;
  if (importance >= 30) return MEMORY_LAYERS.LONG_TERM;
  return MEMORY_LAYERS.SHORT_TERM;
}

/**
 * 余弦相似度计算（简化版TF-IDF向量）
 * @param {string} text1
 * @param {string} text2
 * @returns {number} 相似度 0-1
 */
export function cosineSimilarity(text1, text2) {
  const tokenize = (text) => {
    const lower = text.toLowerCase();
    // Split Chinese into individual characters, keep words intact
    const tokens = [];
    for (const match of lower.matchAll(/[一-龥]|[a-z0-9]+/g)) {
      tokens.push(match[0]);
    }
    return tokens;
  };
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  // 构建词频向量
  const allTokens = new Set([...tokens1, ...tokens2]);
  const vector1 = [];
  const vector2 = [];

  for (const token of allTokens) {
    vector1.push(tokens1.filter(t => t === token).length);
    vector2.push(tokens2.filter(t => t === token).length);
  }

  // 计算余弦相似度
  const dotProduct = vector1.reduce((sum, val, i) => sum + val * vector2[i], 0);
  const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + val * val, 0));

  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * 检索相关记忆
 * @param {Array} memories - 所有记忆
 * @param {string} currentInput - 当前用户输入
 * @param {object} options - 检索选项
 * @returns {Array} 排序后的相关记忆
 */
export function retrieveRelevantMemories(memories, currentInput, options = {}) {
  const {
    maxResults = 10,
    similarityThreshold = 0.35,
    includeCore = true,
    includeLongTerm = true,
    includeShortTerm = true
  } = options;

  const scored = memories
    .filter(m => {
      if (!includeCore && m.layer === MEMORY_LAYERS.CORE) return false;
      if (!includeLongTerm && m.layer === MEMORY_LAYERS.LONG_TERM) return false;
      if (!includeShortTerm && m.layer === MEMORY_LAYERS.SHORT_TERM) return false;
      return true;
    })
    .map(memory => {
      const similarity = cosineSimilarity(currentInput, memory.content);
      const weight = MEMORY_WEIGHTS[memory.layer] || 10;
      const finalScore = similarity * weight;

      return {
        ...memory,
        similarity,
        finalScore
      };
    })
    .filter(m => m.similarity >= similarityThreshold)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, maxResults);

  return scored;
}

// ============================================
// 模块3：动态情绪量化推演（Emotion Engine）
// ============================================

const EMOTION_DECAY = 0.85; // 情绪衰减系数

/**
 * 初始化情绪向量
 * @param {object} initialValues - 初始情绪值
 * @returns {object} 情绪向量
 */
export function initializeEmotionVector(initialValues = {}) {
  return {
    joy: clampNumber(initialValues.joy, 0, 100, 50),        // 喜悦
    anger: clampNumber(initialValues.anger, 0, 100, 0),     // 愤怒
    sadness: clampNumber(initialValues.sadness, 0, 100, 0), // 悲伤
    fear: clampNumber(initialValues.fear, 0, 100, 0),       // 恐惧
    disgust: clampNumber(initialValues.disgust, 0, 100, 0), // 厌恶
    intimacy: clampNumber(initialValues.intimacy, 0, 100, 30), // 亲近
    updatedAt: nowIso()
  };
}

/**
 * 计算用户输入的情绪冲击值
 * @param {string} userInput - 用户输入
 * @returns {object} 情绪变化量
 */
export function calculateEmotionImpact(userInput) {
  const input = userInput.toLowerCase();
  const impact = {
    joy: 0,
    anger: 0,
    sadness: 0,
    fear: 0,
    disgust: 0,
    intimacy: 0
  };

  // 正面词汇
  const positiveKeywords = ['喜欢', '爱', '开心', '高兴', '哈哈', '棒', '好', '赞', '谢谢', '温柔'];
  const negativeKeywords = ['讨厌', '恨', '滚', '傻', '笨', '蠢', '垃圾', '废物', '去死'];
  const intimateKeywords = ['抱抱', '亲亲', '宝贝', '在一起', '喜欢你', '爱你', '陪我'];
  const sadKeywords = ['难过', '伤心', '哭', '痛苦', '失望', '绝望'];
  const fearKeywords = ['害怕', '恐怖', '可怕', '担心', '不安'];

  for (const keyword of positiveKeywords) {
    if (input.includes(keyword)) {
      impact.joy += 15;
      impact.intimacy += 10;
    }
  }

  for (const keyword of negativeKeywords) {
    if (input.includes(keyword)) {
      impact.anger += 20;
      impact.intimacy -= 15;
    }
  }

  for (const keyword of intimateKeywords) {
    if (input.includes(keyword)) {
      impact.intimacy += 25;
      impact.joy += 10;
    }
  }

  for (const keyword of sadKeywords) {
    if (input.includes(keyword)) {
      impact.sadness += 15;
    }
  }

  for (const keyword of fearKeywords) {
    if (input.includes(keyword)) {
      impact.fear += 15;
    }
  }

  return impact;
}

/**
 * 更新情绪向量
 * @param {object} currentEmotion - 当前情绪向量
 * @param {object} impact - 情绪冲击值
 * @returns {object} 新情绪向量
 */
export function updateEmotionVector(currentEmotion, impact) {
  const newEmotion = {};

  for (const key of Object.keys(currentEmotion)) {
    if (key === 'updatedAt') continue;

    // 衰减 + 冲击
    let newValue = currentEmotion[key] * EMOTION_DECAY + (impact[key] || 0);
    newValue = Math.max(0, Math.min(100, newValue)); // 钳位到 0-100
    newEmotion[key] = newValue;
  }

  newEmotion.updatedAt = nowIso();
  return newEmotion;
}

/**
 * 根据情绪阈值生成行为约束
 * @param {object} emotion - 情绪向量
 * @returns {object} 行为约束指令
 */
export function getEmotionBehaviorConstraints(emotion) {
  const constraints = {
    toneModifier: 'neutral',
    sentenceStyle: 'normal',
    cooperationLevel: 'normal',
    proactivity: 'normal',
    emotionalHints: []
  };

  // 愤怒触发
  if (emotion.anger > 70) {
    constraints.toneModifier = 'harsh';
    constraints.sentenceStyle = 'short';
    constraints.cooperationLevel = 'resistant';
    constraints.emotionalHints.push('语气生硬', '抗拒配合', '拒绝请求');
  }

  // 亲近触发
  if (emotion.intimacy > 80) {
    constraints.toneModifier = 'affectionate';
    constraints.proactivity = 'high';
    constraints.emotionalHints.push('主动撒娇', '主动关心', '增加亲昵话术');
  }

  // 悲伤触发
  if (emotion.sadness > 70) {
    constraints.toneModifier = 'melancholic';
    constraints.sentenceStyle = 'brief';
    constraints.cooperationLevel = 'passive';
    constraints.emotionalHints.push('沉默', '低落', '短句对话');
  }

  // 喜悦触发
  if (emotion.joy > 70) {
    constraints.toneModifier = 'cheerful';
    constraints.sentenceStyle = 'expressive';
    constraints.emotionalHints.push('语气轻快', '多用感叹词');
  }

  // 恐惧触发
  if (emotion.fear > 60) {
    constraints.toneModifier = 'nervous';
    constraints.cooperationLevel = 'cautious';
    constraints.emotionalHints.push('谨慎回答', '语气不安');
  }

  return constraints;
}

// ============================================
// 模块4：对话生成约束层（Prompt Builder）
// ============================================

/**
 * 构建完整的上下文提示词
 * @param {object} params - 参数对象
 * @returns {string} 完整 Prompt
 */
export function buildContextPrompt(params) {
  const {
    personalityAnchor,
    currentEmotion,
    relevantMemories,
    recentDialogue,
    userInput,
    behaviorConstraints
  } = params;

  const sections = [];

  // 1. 角色永久档案
  sections.push(`【角色永久档案】
姓名：${personalityAnchor.name}
身份：${personalityAnchor.identity}
年龄：${personalityAnchor.age}

性格特质（量化数值0-100）：
- 温柔度：${personalityAnchor.traitVector.gentle}
- 暴躁度：${personalityAnchor.traitVector.irritable}
- 谨慎度：${personalityAnchor.traitVector.cautious}
- 自信度：${personalityAnchor.traitVector.confident}
- 高冷度：${personalityAnchor.traitVector.aloof}

说话风格：
- 正式程度：${personalityAnchor.speechStyle.formality}
- 话语量：${personalityAnchor.speechStyle.verbosity}
- 语气特点：${personalityAnchor.speechStyle.quirks.join('、') || '无特殊'}

核心价值观（绝对不可违背）：
${personalityAnchor.coreValues.map(v => `- ${v.name || v}`).join('\n') || '- 无特殊价值观'}

禁忌事项（绝对不会做/说）：
${personalityAnchor.taboos.map(t => `- ${t}`).join('\n') || '- 无特殊禁忌'}

核心背景故事：
${personalityAnchor.backstory.core || '无'}`);

  // 2. 当前情绪状态
  sections.push(`\n【当前角色情绪状态】（数值化，影响对话语气和行为）
喜悦：${Math.round(currentEmotion.joy)}  愤怒：${Math.round(currentEmotion.anger)}  悲伤：${Math.round(currentEmotion.sadness)}
恐惧：${Math.round(currentEmotion.fear)}  厌恶：${Math.round(currentEmotion.disgust)}  亲近度：${Math.round(currentEmotion.intimacy)}

情绪触发的行为指令：
${behaviorConstraints.emotionalHints.map(h => `- ${h}`).join('\n') || '- 正常状态'}
当前语气调整：${behaviorConstraints.toneModifier}
句式风格：${behaviorConstraints.sentenceStyle}
配合程度：${behaviorConstraints.cooperationLevel}`);

  // 3. 关联历史记忆
  if (relevantMemories && relevantMemories.length > 0) {
    sections.push(`\n【关联历史记忆】（相似度筛选，按重要性排序）
${relevantMemories.map((m, i) =>
  `${i + 1}. [${m.layer}层 | 相似度${(m.similarity * 100).toFixed(0)}%] ${m.content}`
).join('\n')}`);
  }

  // 4. 最近对话
  if (recentDialogue && recentDialogue.length > 0) {
    sections.push(`\n【最近对话记录】（短期上下文，最近10轮）
${recentDialogue.map(d => `${d.role === 'user' ? '用户' : personalityAnchor.name}：${d.content}`).join('\n')}`);
  }

  // 5. 硬性规则
  sections.push(`\n【硬性规则】（必须严格遵守）
1. 全程严格贴合人设，禁止脱离角色（OOC - Out Of Character）
2. 行为、台词、思考逻辑必须符合角色的年龄、身份、价值观
3. 情绪随当前数值变化，不能永远一个语气
4. 绝对避开角色禁忌，禁止做出违背核心人设的行为
5. 语气和行为受当前情绪状态控制，必须体现情绪变化
6. 只输出角色对话内容，不叙述、不跳出身份、不自我解释`);

  // 6. 用户当前输入
  sections.push(`\n【用户当前输入】
${userInput}`);

  // 7. 输出要求
  sections.push(`\n【输出要求】
只输出 ${personalityAnchor.name} 的对话内容，直接开始说话，不要任何前缀或旁白。`);

  return sections.join('\n');
}

/**
 * OOC 校验（人设崩坏检测）
 * @param {object} personalityAnchor - 人格锚定
 * @param {string} generatedResponse - AI生成的回答
 * @returns {object} { valid, matchScore, issues }
 */
export function validateOOC(personalityAnchor, generatedResponse) {
  const issues = [];
  let matchScore = 100;

  // 1. 禁忌词检测
  // Taboo 是硬性约束（spec 模块4 硬性规则），critical 违规直接判定 OOC，
  // 不能只做软性扣分——否则刚好落在阈值 40 上的响应会被误判为通过。
  let hasCriticalViolation = false;
  const validation = validateAgainstAnchor(personalityAnchor, generatedResponse);
  if (!validation.valid) {
    matchScore -= validation.violations.length * 30;
    issues.push(...validation.violations.map(v => `违反${v.type}: ${v.item}`));
    hasCriticalViolation = validation.violations.some(v => v.severity === 'critical');
  }

  // 2. 语气风格检测（简化版）
  const response = generatedResponse.toLowerCase();
  const speechStyle = typeof personalityAnchor.speechStyle === 'string'
    ? { formality: 'normal', quirks: [] }
    : personalityAnchor.speechStyle;

  // 检测正式程度
  if (speechStyle.formality === 'formal') {
    const informalMarkers = ['哈哈', '嘿嘿', '呜呜', '嗯嗯'];
    for (const marker of informalMarkers) {
      if (response.includes(marker)) {
        matchScore -= 10;
        issues.push(`正式角色使用了非正式语气词: ${marker}`);
      }
    }
  }

  // 3. 口头禅检测（如果设定了，应该出现）
  if (speechStyle.quirks && speechStyle.quirks.length > 0 && generatedResponse.length > 30) {
    const hasQuirk = speechStyle.quirks.some(q =>
      response.includes(q.toLowerCase())
    );
    if (!hasQuirk && Math.random() > 0.7) { // 不是每句都必须有
      matchScore -= 5;
      issues.push('长对话中未体现角色语气特点');
    }
  }

  // 4. 简单向量匹配（伪实现）
  // 实际应该用嵌入向量，这里简化为关键词匹配
  matchScore = Math.max(0, Math.min(100, matchScore));

  return {
    valid: !hasCriticalViolation && matchScore >= 40,
    matchScore,
    issues
  };
}

// ============================================
// 完整执行流程（主函数）
// ============================================

/**
 * HMDT 引擎主执行函数
 * @param {object} params - 完整参数
 * @returns {object} 包含 prompt、验证结果、元数据
 */
export function executeHMDTEngine(params) {
  const {
    characterId,
    personalityAnchor,
    memories = [],
    recentDialogue = [],
    currentEmotion,
    userInput
  } = params;

  // Step 1: 检索相关记忆
  const relevantMemories = retrieveRelevantMemories(memories, userInput, {
    maxResults: 8,
    similarityThreshold: 0.35
  });

  // Step 2: 计算情绪冲击并更新情绪向量
  const emotionImpact = calculateEmotionImpact(userInput);
  const newEmotion = updateEmotionVector(currentEmotion, emotionImpact);

  // Step 3: 根据情绪生成行为约束
  const behaviorConstraints = getEmotionBehaviorConstraints(newEmotion);

  // Step 4: 构建完整提示词
  const prompt = buildContextPrompt({
    personalityAnchor,
    currentEmotion: newEmotion,
    relevantMemories,
    recentDialogue,
    userInput,
    behaviorConstraints
  });

  return {
    prompt,
    metadata: {
      characterId,
      emotionVector: newEmotion,
      emotionImpact,
      behaviorConstraints,
      retrievedMemories: relevantMemories.length,
      memoryDetails: relevantMemories.map(m => ({
        layer: m.layer,
        similarity: m.similarity,
        content: m.content.substring(0, 50) + '...'
      }))
    }
  };
}
