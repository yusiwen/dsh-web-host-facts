import test from 'node:test'
import assert from 'node:assert/strict'
import {
  apply,
  createHostFactsContext,
  CONTEXT_ORDER,
  DEFAULT_TTL_MS,
} from '../index.js'

test('the context caches until the TTL expires', () => {
  let now = 1000
  let calls = 0
  const context = createHostFactsContext({
    ttlMs: 1000,
    now: () => now,
    collect: () => `facts-${++calls}`,
  })

  assert.equal(context.text(), 'facts-1')
  assert.equal(context.text(), 'facts-1')
  assert.equal(calls, 1)

  now = 2501
  assert.equal(context.text(), 'facts-2')
  assert.equal(calls, 2)
})

test('a failing collector returns empty text and retries on the next call', () => {
  let calls = 0
  const context = createHostFactsContext({
    ttlMs: 0,
    collect: () => {
      calls += 1
      throw new Error('probe failed')
    },
  })

  assert.equal(context.text(), '')
  assert.equal(context.text(), '')
  assert.equal(calls, 2)
})

test('apply registers the runtime-context contribution', () => {
  let registered
  apply(
    {
      systemPrompt: {
        context: (entry) => {
          registered = entry
        },
      },
    },
    { ttlMs: 2500 },
  )

  assert.equal(registered.name, 'host-facts')
  assert.equal(registered.order, CONTEXT_ORDER)
  assert.equal(registered.interpolate, false)
  assert.equal(typeof registered.text, 'function')
  assert.equal(DEFAULT_TTL_MS, 600000)
})

test('apply falls back to the default TTL for invalid configuration', () => {
  let registered
  const ctx = {
    systemPrompt: {
      context: (entry) => {
        registered = entry
      },
    },
  }

  apply(ctx, { ttlMs: 1 })
  assert.equal(typeof registered.text, 'function')
  assert.equal(registered.order, CONTEXT_ORDER)
})
