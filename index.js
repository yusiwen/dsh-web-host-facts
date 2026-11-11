/**
 * dsh-web-host-facts — inject host facts into the model's runtime context.
 *
 * The plugin registers one dynamic runtime-context contribution. DSH assembles it before each
 * model step and materializes a durable snapshot when the text changes; the probes behind it are
 * cached, so a session pays for them at most once per TTL.
 */
import { collectHostFacts } from './src/facts.js'

export const name = 'web-host-facts'
export const inject = ['systemPrompt']

/** Default probe-cache lifetime: ten minutes. */
export const DEFAULT_TTL_MS = 10 * 60 * 1000

/** Runtime-context order: after harness source (200), before the web surface (210). */
export const CONTEXT_ORDER = 205

/**
 * Build the runtime-context contribution. Exported so tests can drive the clock and the collector.
 *
 * @param {object} [options]
 * @param {number} [options.ttlMs] - Probe-cache lifetime in milliseconds.
 * @param {() => string} [options.collect] - Fact collector, called when the cache expires.
 * @param {() => number} [options.now] - Clock, injectable for tests.
 * @param {number} [options.order] - Context order in the assembled prompt.
 * @returns {{ name: string, order: number, interpolate: boolean, text: () => string }}
 */
export function createHostFactsContext({
  ttlMs = DEFAULT_TTL_MS,
  collect = collectHostFacts,
  now = Date.now,
  order = CONTEXT_ORDER,
} = {}) {
  let collectedAt = Number.NEGATIVE_INFINITY
  let text = ''

  return {
    name: 'host-facts',
    order,
    // The text is already rendered; `{{...}}` sequences inside a host path must survive verbatim.
    interpolate: false,
    text: () => {
      try {
        const timestamp = now()
        if (timestamp - collectedAt > ttlMs) {
          text = collect()
          collectedAt = timestamp
        }
        return text
      } catch {
        // A broken probe must never fail prompt assembly; retry on the next step.
        return ''
      }
    },
  }
}

/**
 * Register the context with a DSH composition.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context; `systemPrompt` is injected.
 * @param {{ ttlMs?: number }} [config] - Optional plugin configuration.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const ttlMs =
    Number.isFinite(config?.ttlMs) && config.ttlMs >= 1000 ? config.ttlMs : DEFAULT_TTL_MS
  ctx.systemPrompt.context(createHostFactsContext({ ttlMs }))
}
