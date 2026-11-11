/**
 * Host probes.
 *
 * Every probe is synchronous, time-bounded and failure-tolerant: a missing command omits its fact
 * instead of failing prompt assembly. Nothing here reads credentials, key material, or the network.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** Timeout for one probe, in milliseconds. */
export const PROBE_TIMEOUT_MS = 500

/**
 * Resolve a command on PATH without spawning a shell, so the probe works on Windows too.
 *
 * @param {string} command - Command name without extension.
 * @param {string} [envPath] - PATH value to search.
 * @param {NodeJS.Platform} [platform] - Target platform, injectable for tests.
 * @returns {string} Absolute path, or '' when the command is not found.
 */
export function findOnPath(command, envPath = process.env.PATH, platform = process.platform) {
  if (!envPath) return ''
  const extensions =
    platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : ['']

  for (const directory of envPath.split(path.delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`)
      try {
        if (!fs.statSync(candidate).isFile()) continue
        fs.accessSync(candidate, fs.constants.X_OK)
        return candidate
      } catch {
        // Not this one; keep looking.
      }
    }
  }
  return ''
}

/**
 * Normalize `nix --version` output to the bare version string.
 *
 * @param {string} output - Raw stdout of `nix --version`.
 * @returns {string} For example '2.34.9'; the first line when it is not the expected shape.
 */
export function parseNixVersion(output) {
  const firstLine = String(output).split('\n')[0].trim()
  const match = /^nix \(Nix\)\s+(.+)$/.exec(firstLine)
  return (match ? match[1] : firstLine).trim()
}

function firstLine(output) {
  return String(output).split('\n')[0].trim()
}

function run(command, args) {
  try {
    return firstLine(
      execFileSync(command, args, {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }),
    )
  } catch {
    return ''
  }
}

function countSecretKeyFiles(directory) {
  try {
    return fs.readdirSync(directory).filter((entry) => entry.endsWith('.key')).length
  } catch {
    return 0
  }
}

/**
 * Collect the host facts as stable, newline-joined lines.
 *
 * The output is intentionally deterministic for an unchanged host so it does not churn the prompt
 * prefix or the KV cache.
 *
 * @returns {string} Four lines: Host, nix, git signing, gpg. Never empty, never throws.
 */
export function collectHostFacts() {
  const platform = process.platform
  const lines = [`Host: ${platform} ${process.arch}, ${os.release()}.`]

  const nixOnPath = findOnPath('nix')
  const defaultNix =
    platform === 'win32' ? '' : '/nix/var/nix/profiles/default/bin/nix'
  const nixBinary =
    nixOnPath || (defaultNix && fs.existsSync(defaultNix) ? defaultNix : '')

  if (nixBinary) {
    const version = parseNixVersion(run(nixBinary, ['--version']))
    lines.push(
      version
        ? `nix: ${version} at ${nixBinary}${nixOnPath ? '' : ' (not on PATH)'}.`
        : `nix: present at ${nixBinary} (version unknown).`,
    )
  } else {
    lines.push('nix: not found.')
  }

  const git = (key) => run('git', ['config', '--global', '--get', key]) || 'unset'
  lines.push(
    `git signing: commit.gpgsign=${git('commit.gpgsign')}, tag.gpgsign=${git('tag.gpgsign')}, ` +
      `user.signingkey=${git('user.signingkey')}, gpg.program=${git('gpg.program')}.`,
  )

  const gpgHome = run('gpgconf', ['--list-dirs', 'homedir']) || path.join(os.homedir(), '.gnupg')
  const keyCount = countSecretKeyFiles(path.join(gpgHome, 'private-keys-v1.d'))
  lines.push(`gpg: keyring ${gpgHome} with ${keyCount} secret-key file(s).`)

  return lines.join('\n')
}
