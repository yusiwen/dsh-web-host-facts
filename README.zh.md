# dsh-web-host-facts

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：把当前主机的关键事实注入模型的运行时上下文，让 `AGENTS.md` 不必再硬编码会在不同机器上漂移的假设。

```text
Host: darwin arm64, 27.2.0.
nix: 2.34.9 at /nix/var/nix/profiles/default/bin/nix (not on PATH).
git signing: commit.gpgsign=true, tag.gpgsign=true, user.signingkey=E53900D2…, gpg.program=default.
gpg: keyring /Users/yusiwen/.gnupg with 2 secret-key file(s).
```

## 为什么需要

同一份全局指令往往在多台机器之间同步：一台机器的 Nix 在 `PATH` 里，另一台只在 `/nix/var/nix/profiles/default/bin`；一台默认签名提交，另一台没有；gpg keyring 在 macOS 与 Linux 上也不是同一套。把这些事实写进始终加载的指令文件，必然在某些机器上是错的。

本插件在缓存窗口内探测一次，把结果作为动态运行时上下文贡献出去。DSH 会把它和工作目录、沙箱策略一起物化为快照，模型读到的是当前事实，而不是过时的说明。输出对未变化的主机保持稳定，不会反复改动提示词前缀或 KV 缓存。

## 安装

```bash
dsh plugin --profile web add dsh-web-host-facts
```

从本地目录安装：

```bash
dsh plugin --profile web add file:/path/to/dsh-web-host-facts
```

命令会把依赖写入 profile 的 `package.json`，并把 `dsh-web-host-facts` 追加到 `dsh.profile.bundles`。运行中的 profile 会通过 watcher 重组合；已打开的会话在下一步即可看到。

插件适用于任何挂载了 `dsh-system-prompt` 的 profile（`web`、`headless`、`acp`、`sdk` 等）；名字里的 `web-` 只是沿用 DSH Web profile 插件族的命名，并不要求浏览器端代码。

> 如果此前使用个人配置仓库里的 `dsh-host-facts`，二者只能选其一：它们都注册名为 `host-facts` 的运行时上下文，同时挂载会因重名失败。先移除旧的，再安装本包。

## 验证

```bash
dsh --profile web --dump-config | grep -A2 web-host-facts
```

成功启动后，会话的运行时上下文里会出现这四行。若 profile 已在运行，请在重载后开新会话（或等待下一步）。

## 配置

唯一选项是探测缓存时长（毫秒），默认十分钟。

```yaml
- id: web-host-facts
  config:
    ttlMs: 600000
```

小于 1000 的值会回退到默认值。调大减少进程启动次数；调小让主机配置变化更快可见。

## 探测内容

| 行 | 来源 | 不可用时 |
| --- | --- | --- |
| `Host:` | `process.platform`、`process.arch`、`os.release()` | 不会缺失 |
| `nix:` | `PATH` 中的 `nix`，否则 `/nix/var/nix/profiles/default/bin/nix`；版本来自 `nix --version` | `nix: not found.` |
| `git signing:` | `git config --global --get` 读取四个键 | 显示 `unset` |
| `gpg:` | `gpgconf --list-dirs homedir`，回退 `~/.gnupg`；只统计 `private-keys-v1.d/*.key` 数量 | `0 secret-key file(s)` |

每个探测都是同步、500 ms 上限、失败可容忍的：命令缺失只会省略对应事实，不会让 prompt 组装失败。插件不执行 shell、不联网、不读取密钥内容。

## 行为与开销

- 上下文注册在 order 205：位于 harness source（200）之后、web surface（210）之前。
- 每个模型 step 组装时调用一次 `text()`；首次调用探测，之后仅在超过 `ttlMs` 时重探。采集失败返回空串，并在下一步重试。
- 主机未变化时文本稳定，所以快照通常每个会话只出现一次，而不是每步一次。
- 整体约 100 tokens，不占工具位，也没有模型可见的工具。

## 隐私

插件只报告本机同用户进程本来就能看到的信息：OS 版本、Nix 是否安装、全局 git 签名配置、gpg keyring 路径与密钥文件数量。它不读取密钥内容、passphrase、凭据或环境变量。卸载插件即可停止贡献。

## 兼容性

| 要求 | 范围 |
| --- | --- |
| DeepSeek Harness | `>=0.2.1-rc.2 <0.3.0-0` |
| Node.js | `^22.19.0 || >=24.0.0` |
| 操作系统 | macOS、Linux、Windows（没有 Nix 的平台报告 not found） |

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 上下文里没有 `host-facts` | `dsh --profile <name> --dump-config` 是否含该行；profile 是否重载；开新会话 |
| 有 Nix 却显示 `not found.` | `command -v nix`、`ls /nix/var/nix/profiles/default/bin/nix`；探测只查 `PATH` 与该默认位置 |
| `gpg: … 0 secret-key file(s)` | `gpgconf --list-dirs homedir`、`ls ~/.gnupg/private-keys-v1.d` |
| 挂载后 prompt 组装失败 | 是否有第二个插件注册了同名 `host-facts` 上下文 |

## 开发

```bash
npm test          # node:test，无依赖
npm run check     # 语法检查 + 测试
npm run pack:check
```

插件没有运行时依赖，也没有构建步骤。`index.js` 负责注册与缓存，`src/facts.js` 负责探测。

## 发布

```bash
npm login
npm publish          # publishConfig.access 为 public
git tag v0.1.0 && git push --tags
```

## 许可

MIT © 2026 Siwen Yu
