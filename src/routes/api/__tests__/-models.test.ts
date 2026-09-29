import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

const { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn().mockImplementation(() => {}),
  mkdirSync: vi.fn().mockImplementation(() => {}),
  statSync: vi.fn().mockReturnValue({ isFile: () => false, mtimeMs: 0 }),
  readdirSync: vi.fn().mockReturnValue([]),
}))

const { dashboardFetch } = vi.hoisted(() => ({ dashboardFetch: vi.fn() }))

vi.mock('node:fs', () => ({
  default: { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync },
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  readdirSync,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: any) => opts,
}))

vi.mock('@tanstack/react-start', () => ({
  json: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...(init || {}),
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    }),
}))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../../server/gateway-capabilities', () => ({
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://127.0.0.1:8642',
  dashboardFetch,
}))

vi.mock('../../../server/claude-api', () => ({
  ensureGatewayProbed: vi.fn(),
  getGatewayCapabilities: () => ({ models: false }),
}))

vi.mock('../../../server/local-provider-discovery', () => ({
  ensureDiscovery: vi.fn(),
  getDiscoveredModels: () => [],
  ensureProviderInConfig: () => false,
}))

beforeEach(() => {
  vi.clearAllMocks()
  dashboardFetch.mockResolvedValue(new Response('{}', { status: 503 }))
  delete process.env.HERMES_HOME
  delete process.env.CLAUDE_HOME
})

describe('models route', () => {
  it('serves authenticated Dashboard choices plus configured custom chat models', async () => {
    process.env.HERMES_HOME = '/mock/hermes'
    existsSync.mockImplementation((p: string) => p.replaceAll('\\', '/') === '/mock/hermes/config.yaml')
    readFileSync.mockImplementation((p: string) => p.replaceAll('\\', '/') === '/mock/hermes/config.yaml'
      ? 'custom_providers:\n  - name: fun-codex\n    models: [gpt-5.5, gpt-image-2]\n'
      : '')
    dashboardFetch.mockResolvedValue(new Response(JSON.stringify({ providers: [
      { slug: 'openai-codex', authenticated: true, models: ['gpt-6-sol'] },
      { slug: 'moa', authenticated: true, models: ['default'] },
    ] }), { status: 200 }))
    const get = await getHandler()
    const res = await get({ request: new Request('http://localhost/api/models') })
    const body = await res.json()
    expect(dashboardFetch).toHaveBeenCalledWith('/api/model/options', expect.any(Object))
    expect(body.models.map((m: { id: string }) => m.id)).toEqual([
      'openai-codex/gpt-6-sol', 'custom:fun-codex/gpt-5.5',
    ])
    expect(body.source).toContain('dashboard')
  })
  async function importModels() {
    vi.resetModules()
    const mod = await import('../models')
    return mod
  }

  async function getHandler() {
    const mod = await importModels()
    const get = (mod as any).Route.server.handlers.GET
    return get
  }

  it('GET returns ok:true and empty models without config', async () => {
    const get = await getHandler()
    expect(typeof get).toBe('function')
    const request = new Request('http://localhost/api/models')
    const res = await get({ request })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.data).toEqual([])
  })

  it('reads default model from CLAUDE_HOME config using YAML.parse', async () => {
    const envHome = '/mock/profiles/jarvis'
    process.env.CLAUDE_HOME = envHome

    const configYaml = 'model: jarvis-model\nprovider: nous\n'
    const modelsJson = '[{"model":"x","provider":"y"}]'
    existsSync.mockImplementation((p: string) => {
      return p.replaceAll('\\', '/') === `${envHome}/models.json` || p.replaceAll('\\', '/') === `${envHome}/config.yaml`
    })
    readFileSync.mockImplementation((p: string) => {
      if (p.replaceAll('\\', '/') === `${envHome}/config.yaml`) return configYaml
      if (p.replaceAll('\\', '/') === `${envHome}/models.json`) return modelsJson
      return ''
    })

    const get = await getHandler()
    const request = new Request('http://localhost/api/models')
    const res = await get({ request })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.models[0].id).toBe('jarvis-model')
    expect(json.models[0].provider).toBe('nous')
  })

  it('reads nested model object syntax from config using YAML.parse', async () => {
    const envHome = '/mock/profiles/jarvis'
    process.env.CLAUDE_HOME = envHome

    const configYaml = 'model:\n  default: nest-model\n  provider: anthropic\n'
    existsSync.mockImplementation((p: string) => p.replaceAll('\\', '/') === `${envHome}/config.yaml`)
    readFileSync.mockImplementation((p: string) => {
      if (p.replaceAll('\\', '/') === `${envHome}/config.yaml`) return configYaml
      return ''
    })

    const get = await getHandler()
    const request = new Request('http://localhost/api/models')
    const res = await get({ request })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.models[0].id).toBe('nest-model')
    expect(json.models[0].provider).toBe('anthropic')
  })
})
