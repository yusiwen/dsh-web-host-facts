# dsh-web-host-facts

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that injects a short,
stable snapshot of the host into the model's runtime context — so `AGENTS.md` does not have to
hardcode facts that differ between machines.

```text
Host: darwin arm64, 27.2.0.
nix: 2.34.9 at /nix/var/nix/profiles/default/bin/nix (not on PATH).
git signing: commit.gpgsign=true, tag.gpgsign=true, user.signingkey=E53900D266386F9D161DDBDCC23D832C2796C997, gpg.program=default.
gpg: keyring /Users/yusiwen/.gnupg with 2 secret-key file(s).
```

## Why

Agent instructions drift the moment they are shared across machines: one host has Nix on `PATH`,
another only in `/nix/var/nix/profiles/default/bin`; one signs commits by default, another does not;
one has a macOS keyring, another a Linux one. Writing those facts into an always-loaded instruction
file guarantees that some of them are wrong somewhere.

This plugin probes the machine once per cache window and contributes the result as dynamic runtime
context. DSH materializes it as a durable snapshot next to the working directory and sandbox policy,
so the model reads current facts instead of stale prose. The output is deliberately stable for an
unchanged host, so it does not churn the prompt prefix or the KV cache.

## Install

```bash
dsh plugin --profile web add dsh-web-host-facts
```

To install from a checkout instead of the registry:

```bash
dsh plugin --profile web add file:/path/to/dsh-web-host-facts
```

The command records the dependency and appends `dsh-web-host-facts` to `dsh.profile.bundles` in the
profile's `package.json`. The running profile recomposes through its watcher; a session that is
already open sees the context on its next step.

The plugin works in any profile that mounts `dsh-system-prompt` (`web`, `headless`, `acp`, `sdk`, …);
the `web-` name follows the DSH Web profile plugin family, not a browser-side requirement. Install it
into every profile where the facts should be visible.

> If you previously used the bundled `dsh-host-facts` package from a personal config repository,
> choose one: both register a runtime context named `host-facts`, and mounting both fails. Remove the
> old one before adding this package (`dsh plugin --profile web remove dsh-host-facts`).

## Verify

```bash
dsh --profile web --dump-config | grep -A2 web-host-facts
```

A successful boot then shows the four lines in the session's runtime context. If the profile is
already running, start a new session (or wait for the next step) after the reload.

## Configuration

The only option is the probe cache lifetime, in milliseconds. The default is ten minutes.

```yaml
- id: web-host-facts
  config:
    ttlMs: 600000
```

Values below 1000 ms are rejected in favor of the default. Raising `ttlMs` reduces process spawns;
lowering it makes a changed host configuration visible sooner.

## What is probed

| Context line | Source | When unavailable |
| --- | --- | --- |
| `Host:` | `process.platform`, `process.arch`, `os.release()` | never |
| `nix:` | `nix` on `PATH`, else `/nix/var/nix/profiles/default/bin/nix`; version from `nix --version` | `nix: not found.` |
| `git signing:` | `git config --global --get {commit.gpgsign,tag.gpgsign,user.signingkey,gpg.program}` | value rendered as `unset` |
| `gpg:` | `gpgconf --list-dirs homedir`, fallback `~/.gnupg`; counts `private-keys-v1.d/*.key` | `0 secret-key file(s)` |

Every probe is synchronous, bounded to 500 ms, and failure-tolerant: a missing command omits its fact
rather than failing prompt assembly. The plugin runs no shell, opens no network connection, and reads
no secret-key material — the `gpg:` line counts key files by name only.

## Behavior and cost

- The contribution is registered at context order 205: after the harness source (200) and before the
  web surface (210).
- `text()` is called during prompt assembly for each model step. Probes run on the first call and again
  only after `ttlMs`; a failed collection returns an empty string and retries on the next step.
- The rendered text is stable while the host is unchanged, so the runtime-context snapshot usually
  appears once per session rather than once per step.
- The whole contribution is roughly 100 tokens. It occupies no tool slot and has no model-facing tool.

## Privacy

The plugin reports what the local machine already exposes to any process running as the same user:
the OS release, whether Nix is installed, the global git signing configuration, and the path of the gpg
keyring with a count of key files. It does not read key contents, passphrases, credentials, or
environment variables. Remove the plugin to stop the contribution.

## Compatibility

| Requirement | Range |
| --- | --- |
| DeepSeek Harness | `>=0.2.1-rc.2 <0.3.0-0` |
| Node.js | `^22.19.0 || >=24.0.0` |
| Operating systems | macOS, Linux, Windows (Nix is reported as not found where it does not exist) |

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No `host-facts` section in the runtime context | `dsh --profile <name> --dump-config` contains the row; the profile was reloaded; start a new session |
| `nix: not found.` on a machine that has Nix | Run `command -v nix` and `ls /nix/var/nix/profiles/default/bin/nix`; the probe searches `PATH` and that default profile only |
| `gpg: keyring … with 0 secret-key file(s)` | `gpgconf --list-dirs homedir` and `ls ~/.gnupg/private-keys-v1.d`; keys stored with a custom `GNUPGHOME` are reported through `gpgconf` |
| Prompt assembly fails after mounting | Check for a second plugin registering the context name `host-facts`; the registry rejects duplicate names |

## Development

```bash
npm test          # node:test, no dependencies
npm run check     # syntax checks plus tests
npm run pack:check
```

The plugin has no runtime dependencies and no build step. `index.js` owns registration and caching;
`src/facts.js` owns the probes and is covered by unit tests for the pure helpers and the line shape.

## Publishing

```bash
npm login
npm publish          # publishConfig.access is public
git tag v0.1.0 && git push --tags
```

## License

MIT © 2026 Siwen Yu
