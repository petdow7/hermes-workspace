import { describe, expect, it } from 'vitest'
import { mergeModelEntries, normalizeDashboardModelOptions, normalizeCustomProviderModels } from './models'

describe('custom provider models', () => {
  it('qualifies configured chat models and excludes non-chat or unconfigured models', () => {
    expect(normalizeCustomProviderModels([
      { name: 'fun-codex', models: ['gpt-5.5', 'gpt-image-2', 'text-embedding-3-large', 'gpt-5.5'] },
      { name: 'empty', models: [] },
      { name: 'ollama', models: ['gemma4:e4b'] },
    ]).map(({ id, provider }) => ({ id, provider }))).toEqual([
      { id: 'custom:fun-codex/gpt-5.5', provider: 'custom:fun-codex' },
    ])
  })
})

describe('authenticated dashboard model options', () => {
  it('retains provider identity and excludes virtual and non-chat models', () => {
    expect(normalizeDashboardModelOptions({ providers: [
      { slug: 'openai-codex', authenticated: true, models: ['gpt-6-sol', 'gpt-6-sol', 'image-1', 'text-embedding-3-large'] },
      { slug: 'openai-api', authenticated: true, models: ['gpt-6-sol', 'tts-1'] },
      { slug: 'openrouter', authenticated: true, models: ['anthropic/claude-opus-5.5'] },
      { slug: 'custom:ollama', authenticated: true, models: ['gemma4:e4b'] },
      { slug: 'moa', authenticated: true, models: ['default'] },
      { slug: 'other', authenticated: false, models: ['not-usable'] },
    ] }).map(({ id, provider }) => ({ id, provider }))).toEqual([
      { id: 'openai-codex/gpt-6-sol', provider: 'openai-codex' },
      { id: 'openai-api/gpt-6-sol', provider: 'openai-api' },
      { id: 'openrouter/anthropic/claude-opus-5.5', provider: 'openrouter' },
    ])
  })
})

describe('mergeModelEntries', () => {
  it('keeps local catalog entries and appends Hermes backend models without duplicates', () => {
    const merged = mergeModelEntries(
      [
        { id: 'workspace/default', name: 'Workspace default', provider: 'workspace' },
        { id: 'openai/gpt-4.1', name: 'GPT-4.1 from local catalog', provider: 'openai' },
      ],
      [
        { id: 'openai/gpt-4.1', name: 'GPT-4.1 from Hermes', provider: 'openai' },
        { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet', provider: 'anthropic' },
      ],
    )

    expect(merged.map((model) => model.id)).toEqual([
      'workspace/default',
      'openai/gpt-4.1',
      'anthropic/claude-sonnet-4.5',
    ])
    expect(merged[1]?.name).toBe('GPT-4.1 from local catalog')
  })

  it('normalizes string model ids from Hermes-compatible /v1/models responses', () => {
    expect(mergeModelEntries(['openrouter/qwen/qwen3-coder'])).toEqual([
      {
        id: 'openrouter/qwen/qwen3-coder',
        name: 'openrouter/qwen/qwen3-coder',
        provider: 'openrouter',
      },
    ])
  })
})
