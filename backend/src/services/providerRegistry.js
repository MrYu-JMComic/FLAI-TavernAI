import { appConfig } from '../config.js';

export const providerPresets = {
  openai: {
    providerType: 'openai',
    gatewayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    supportsReasoning: false,
    extraBody: {}
  },
  deepseek: {
    providerType: 'deepseek',
    gatewayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    supportsReasoning: true,
    extraBody: {}
  },
  gemini: {
    providerType: 'gemini',
    gatewayName: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    supportsReasoning: true,
    extraBody: {
      extra_body: {
        google: {
          thinking_config: {
            include_thoughts: true
          }
        }
      }
    }
  },
  anthropic: {
    providerType: 'anthropic',
    gatewayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-6',
    supportsReasoning: true,
    extraBody: {}
  },
  xai: {
    providerType: 'xai',
    gatewayName: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.1',
    supportsReasoning: true,
    extraBody: {}
  },
  mistral: {
    providerType: 'mistral',
    gatewayName: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-medium-3-5',
    supportsReasoning: true,
    extraBody: {}
  },
  qwen: {
    providerType: 'qwen',
    gatewayName: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-plus',
    supportsReasoning: true,
    extraBody: {}
  },
  glm: {
    providerType: 'glm',
    gatewayName: 'Z.AI GLM',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-5.1',
    supportsReasoning: true,
    extraBody: {}
  },
  kimi: {
    providerType: 'kimi',
    gatewayName: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.5',
    supportsReasoning: true,
    extraBody: {}
  },
  custom: {
    providerType: 'custom',
    gatewayName: '自定义网关',
    baseUrl: '',
    model: '',
    supportsReasoning: false,
    extraBody: {}
  }
};

export function defaultProviderSettings() {
  return providerPresets[appConfig.providerDefaultType] || providerPresets.deepseek;
}
