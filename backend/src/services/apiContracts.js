import { appConfig } from '../config.js';

const DEPRECATED_ROUTES = new Map([
  ['GET /api/provider', '/api/settings/provider'],
  ['PUT /api/provider', '/api/settings/provider'],
  ['GET /api/health', '/api/health/ready']
]);
const compatibilityCounters = new Map();

export function compatibilityAliasMiddleware(request, response, next) {
  const routeKey = `${request.method} ${request.path}`;
  const replacement = DEPRECATED_ROUTES.get(routeKey);
  if (replacement) {
    const current = compatibilityCounters.get(routeKey) || { count: 0, lastUsedAt: '' };
    current.count += 1;
    current.lastUsedAt = new Date().toISOString();
    compatibilityCounters.set(routeKey, current);
    response.setHeader('Deprecation', 'true');
    response.setHeader('Sunset', 'Wed, 31 Dec 2027 23:59:59 GMT');
    response.setHeader('Link', `<${replacement}>; rel="successor-version"`);
  }
  next();
}

export function listCompatibilityAliasUsage() {
  const rows = [];
  for (const [route, state] of compatibilityCounters) {
    rows.push({
      route,
      replacement: DEPRECATED_ROUTES.get(route),
      count: state.count,
      lastUsedAt: state.lastUsedAt
    });
  }
  rows.sort((left, right) => left.route.localeCompare(right.route));
  return rows;
}

export function buildOpenApiDocument(config = appConfig) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'FLAI TavernAI Backend API',
      version: config.version
    },
    servers: [{ url: '/api' }],
    paths: {
      '/health/live': { get: operation('Process liveness', false, 'HealthResponse') },
      '/health/ready': { get: operation('Cached database readiness', false, 'HealthResponse') },
      '/csrf-token': { get: operation('Issue a signed CSRF token', false, 'CsrfToken') },
      '/auth/register': { post: operation('Register an account', false, 'UserResponse') },
      '/auth/login': { post: operation('Create and rotate a session', false, 'UserResponse') },
      '/auth/logout': { post: operation('Destroy the current session', true, 'OkResponse') },
      '/characters': {
        get: operation('List characters', true, 'CharacterList'),
        post: operation('Create a character', true, 'Character')
      },
      '/conversations': {
        get: operation('List conversations', true, 'ConversationList'),
        post: operation('Create a conversation', true, 'Conversation')
      },
      '/conversations/{id}/messages': {
        get: operation('List conversation messages with optional cursor pagination', true, 'MessageList')
      },
      '/conversations/{id}/economy/history': {
        get: operation('List economy transactions with offset compatibility and cursor pagination', true, 'EconomyHistory')
      },
      '/conversations/{id}/context/preview': {
        post: operation('Preview prompt context budgets and retrieval evidence', true, 'ContextPreview')
      },
      '/world-books': {
        get: operation('List world books', true, 'WorldBookList'),
        post: operation('Create a world book', true, 'WorldBook')
      },
      '/towns': {
        get: operation('List simulation towns', true, 'TownList'),
        post: operation('Create a simulation town', true, 'Town')
      },
      '/jobs': {
        get: operation('List durable jobs', true, 'JobList'),
        post: operation('Submit an idempotent durable job', true, 'Job')
      },
      '/jobs/{jobId}': { get: operation('Read a durable job and its events', true, 'Job') },
      '/jobs/{jobId}/events': { get: operation('Resume durable job events from a cursor', true, 'JobEventList') },
      '/search': { get: operation('Search messages, memories, and world books', true, 'SearchResults') },
      '/envelopes/{kind}': { get: operation('Export a versioned data envelope', true, 'ExportEnvelope') },
      '/envelopes/{kind}/import': { post: operation('Dry-run or import a versioned data envelope', true, 'ImportReport') },
      '/admin/overview': { get: operation('Read root administrator overview', true, 'AdminOverview') },
      '/admin/users': { get: operation('List users and quota state', true, 'AdminUserList') },
      '/admin/sessions': { get: operation('List revocable sessions', true, 'AdminSessionList') },
      '/admin/jobs': { get: operation('List jobs across users', true, 'JobList') },
      '/admin/audit': { get: operation('List shared automation audit events', true, 'AutomationAuditList') },
      '/admin/providers': { get: operation('Read redacted provider state', true, 'AdminProviderState') },
      '/admin/diagnostics/performance': { get: operation('Read latency and row-count histograms', true, 'PerformanceMetrics') },
      '/admin/backups/{filename}/preflight': { get: operation('Preflight an offline backup restore', true, 'BackupPreflight') },
      '/admin/diagnostics/health': { get: operation('Read detailed runtime diagnostics', true, 'RuntimeHealth') },
      '/admin/compatibility-aliases': { get: operation('Read deprecated alias usage', true, 'CompatibilityUsage') }
    },
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'flai_session' },
        csrfHeader: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error', 'code', 'requestId'],
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            requestId: { type: 'string', format: 'uuid' }
          }
        },
        HealthResponse: objectSchema({ ok: { type: 'boolean' } }),
        CsrfToken: objectSchema({ csrfToken: { type: 'string' } }),
        OkResponse: objectSchema({ ok: { type: 'boolean' } }),
        UserResponse: objectSchema({ user: { type: 'object' } }),
        Character: { type: 'object' },
        CursorPage: objectSchema({
          items: { type: 'array', items: { type: 'object' } },
          nextCursor: { type: 'string' }
        }),
        CharacterList: {
          oneOf: [
            { type: 'array', items: { $ref: '#/components/schemas/Character' } },
            { $ref: '#/components/schemas/CursorPage' }
          ]
        },
        Conversation: { type: 'object' },
        ConversationList: {
          oneOf: [
            { type: 'array', items: { $ref: '#/components/schemas/Conversation' } },
            { $ref: '#/components/schemas/CursorPage' }
          ]
        },
        MessageList: objectSchema({
          conversation: { $ref: '#/components/schemas/Conversation' },
          messages: { type: 'array', items: { type: 'object' } },
          nextCursor: { type: 'string' }
        }),
        EconomyHistory: objectSchema({
          transactions: { type: 'array', items: { type: 'object' } },
          total: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          nextCursor: { type: 'string' }
        }),
        ContextPreview: { type: 'object' },
        WorldBook: { type: 'object' },
        WorldBookList: objectSchema({ worldBooks: { type: 'array', items: { type: 'object' } } }),
        Town: { type: 'object' },
        TownList: objectSchema({ towns: { type: 'array', items: { type: 'object' } } }),
        Job: { type: 'object' },
        JobList: objectSchema({ jobs: { type: 'array', items: { type: 'object' } } }),
        JobEventList: objectSchema({
          events: { type: 'array', items: { type: 'object' } },
          nextCursor: { oneOf: [{ type: 'integer' }, { type: 'string' }] }
        }),
        SearchResults: objectSchema({ results: { type: 'array', items: { type: 'object' } } }),
        ExportEnvelope: { type: 'object' },
        ImportReport: { type: 'object' },
        AdminOverview: { type: 'object' },
        AdminUserList: objectSchema({ users: { type: 'array', items: { type: 'object' } } }),
        AdminSessionList: objectSchema({ sessions: { type: 'array', items: { type: 'object' } } }),
        AutomationAuditList: objectSchema({ events: { type: 'array', items: { type: 'object' } } }),
        AdminProviderState: { type: 'object' },
        PerformanceMetrics: objectSchema({ operations: { type: 'array', items: { type: 'object' } } }),
        BackupPreflight: { type: 'object' },
        RuntimeHealth: { type: 'object' },
        CompatibilityUsage: objectSchema({ aliases: { type: 'array', items: { type: 'object' } } })
      }
    }
  };
}

function operation(summary, authenticated, schemaName) {
  return {
    summary,
    security: authenticated ? [{ sessionCookie: [] }] : [],
    responses: {
      200: {
        description: 'Success',
        content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } }
      },
      default: {
        description: 'Error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  };
}

function objectSchema(properties) {
  return { type: 'object', properties };
}
