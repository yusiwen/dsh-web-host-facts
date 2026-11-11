import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findOnPath, parseNixVersion, collectHostFacts } from '../src/facts.js'

test('parseNixVersion extracts the bare version', () => {
  assert.equal(parseNixVersion('nix (Nix) 2.34.9'), '2.34.9')
  assert.equal(parseNixVersion('nix (Nix) 2.34.9\nextra line'), '2.34.9')
  assert.equal(parseNixVersion('2.34.9'), '2.34.9')
  assert.equal(parseNixVersion(''), '')
})

test('findOnPath finds an executable and ignores a missing command', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'host-facts-'))
  try {
    const binary = path.join(
      directory,
      process.platform === 'win32' ? 'probe.EXE' : 'probe',
    )
    fs.writeFileSync(binary, '')
    fs.chmodSync(binary, 0o755)

    assert.equal(findOnPath('probe', directory), binary)
    assert.equal(findOnPath('definitely-not-a-command', directory), '')
    assert.equal(findOnPath('probe', ''), '')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('collectHostFacts returns four stable, parseable lines', () => {
  const text = collectHostFacts()
  const lines = text.split('\n')

  assert.equal(lines.length, 4)
  assert.match(lines[0], /^Host: \S+ \S+, .+\.$/)
  assert.match(lines[1], /^nix: /)
  assert.match(lines[2], /^git signing: commit\.gpgsign=/)
  assert.match(lines[3], /^gpg: keyring /)

  // An unchanged host must render identically, or the prompt prefix would churn.
  assert.equal(collectHostFacts(), text)
})
