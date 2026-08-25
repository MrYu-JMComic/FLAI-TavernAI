import assert from 'node:assert/strict';
import test from 'node:test';

const {
  generateTownWorldBlueprint,
  normalizeTownWorldBlueprint
} = await import('../services/townWorldAssistant.js');

const PROMPT = '我想要一个常年被海雾笼罩的贸易港，灯塔守望者怀疑失踪商船与海上的异常光芒有关。';

test('town world assistant sends the user idea unchanged and accepts only the required blueprint tool', async () => {
  let captured = null;
  const result = await generateTownWorldBlueprint(
    { providerType: 'openai', gatewayName: '测试网关', model: 'world-model' },
    PROMPT,
    {
      runCompletion: async (settings, messages, tools, executeTool, options) => {
        captured = { settings, messages, tools, options };
        const toolResult = await executeTool('create_town_world', createBlueprint());
        return {
          toolCalls: [{ name: 'create_town_world', arguments: createBlueprint(), result: toolResult }],
          provider: '测试网关',
          providerType: 'openai',
          model: 'world-model',
          usage: { totalTokens: 456 },
          process: []
        };
      }
    }
  );

  assert.equal(JSON.parse(captured.messages[1].content).worldIdea, PROMPT);
  assert.equal(captured.options.toolChoice, 'required');
  assert.equal(captured.tools[0].function.name, 'create_town_world');
  assert.equal(captured.tools[0].function.parameters.properties.locations.minItems, 3);
  assert.equal(captured.tools[0].function.parameters.properties.residents.minItems, 2);
  assert.equal(result.blueprint.name, '雾港');
  assert.deepEqual(result.blueprint.locations.map((item) => item.id), ['location-1', 'location-2', 'location-3']);
  assert.equal(result.provider, '测试网关');
  assert.equal(result.model, 'world-model');
});

test('town world assistant rejects plain model text even when it contains JSON', async () => {
  await assert.rejects(
    () => generateTownWorldBlueprint(
      { providerType: 'openai', gatewayName: '测试网关', model: 'world-model' },
      PROMPT,
      {
        runCompletion: async () => ({
          content: JSON.stringify(createBlueprint()),
          toolCalls: [],
          process: []
        })
      }
    ),
    /没有通过工具返回完整世界蓝图/
  );
});

test('blueprint normalization rejects missing AI-authored resident details and invalid locations', () => {
  const missingGoal = createBlueprint();
  missingGoal.residents[0].goal = '';
  assert.equal(normalizeTownWorldBlueprint(missingGoal), null);

  const wrongLocation = createBlueprint();
  wrongLocation.residents[1].startingLocation = '不存在的地点';
  assert.equal(normalizeTownWorldBlueprint(wrongLocation), null);

  const missingEnvironment = createBlueprint();
  missingEnvironment.environment.atmosphere = '';
  assert.equal(normalizeTownWorldBlueprint(missingEnvironment), null);
});

function createBlueprint() {
  return {
    name: '雾港',
    description: '终年笼罩在海雾中的贸易港，失踪商船让居民彼此猜疑。',
    environment: {
      biome: 'coastal',
      atmosphere: '潮湿、昏暗，雾笛声从看不见的海面传来。',
      settlementPattern: 'coastal',
      water: 'coast'
    },
    locations: [
      { name: '断潮灯塔', kind: 'lighthouse', description: '俯瞰外海航道的古老灯塔。', importance: 5 },
      { name: '北雾码头', kind: 'harbor', description: '失踪商船最后出现的地方。', importance: 4 },
      { name: '雾鸥酒馆', kind: 'tavern', description: '水手、商人与走私客交换消息的酒馆。', importance: 4 }
    ],
    residents: [
      {
        name: '艾琳', role: '灯塔守望者', summary: '谨慎而执着的守望者。', goal: '查明灯塔异光与失踪商船的关系', mood: '警觉',
        startingLocation: '断潮灯塔', activities: ['校准灯塔透镜', '记录海雾中的光点'], dialogue: ['海上的光昨夜更近了。', '别回应雾里的呼救。'], memories: ['她曾看见无灯商船逆潮驶入浓雾。']
      },
      {
        name: '罗恩', role: '酒馆老板', summary: '消息灵通却隐藏秘密的酒馆老板。', goal: '在走私账册曝光前找回它', mood: '焦虑',
        startingLocation: '雾鸥酒馆', activities: ['招待水手', '暗中打听失踪船员'], dialogue: ['那艘船从没来过这里。', '雾里怪事多，别追问。'], memories: ['失踪船长把封蜡账本藏进酒窖后墙。']
      }
    ],
    openingEvents: ['一艘没有船员的商船在黎明漂入北雾码头。'],
    rules: ['浓雾会在夜间改变近海航道。', '居民只依据亲历或听闻的信息行动。']
  };
}
