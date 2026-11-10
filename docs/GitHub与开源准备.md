# GitHub 与开源准备

更新日期：2026-11-10。项目仓库为 [abandon748/MDMD](https://github.com/abandon748/MDMD)。维护者已选择 GNU GPL v3，本项目以 **GPL-3.0-only** 授权，完整条款见根目录 [LICENSE](../LICENSE)。仓库可见性由 GitHub 单独管理；上传源码或发布 Release 不会自动将私有仓库改为公开。

## 1. 仓库边界

仅将包含 `package.json` 的当前 MDMD 工程作为仓库根目录，不能把外层整个 MD 资料目录直接上传。

| 内容 | 处理 |
| --- | --- |
| `src/`、`src-tauri/src/`、图标、capabilities、Tauri 配置 | 进入源码仓库 |
| `scripts/`、`tests/`、`packaging/` | 保留构建与验证入口，保留第三方模板来源及许可 |
| `package.json`、两个依赖锁文件、`tsconfig.json`、`config/` | 保留，支持恢复依赖及校验可选资源 |
| 根目录 README、本目录指南、`examples/` | 作为公开文档与示例；文档不得放真实个人数据 |
| `node_modules/`、`dist/`、`src-tauri/target/`、`src-tauri/gen/` | 由工具生成，Git 忽略 |
| `test-results/`、日志、编辑器配置、文档备份、密钥文件 | 本地保留，Git 忽略 |
| `docs/首版验收.md` | 当前 MDMD 的 Windows 验收入口与基础检查记录，随源码纳入仓库 |
| 外层版本归档、参考解析对象、work、管理资料与 release | 不在本仓库内；成品将来通过 GitHub Releases 分发 |

`.gitignore` 只能防止未跟踪文件被误加入，不会删除已经提交的敏感信息。即使扩展名没有被排除，文件内容也可能含隐私，首次提交前仍需逐项审阅。

`package.json` 中的 `private: true` 用来防止误发布到 npm，不影响 GitHub 仓库是否公开。它不是 GitHub 权限设置。

## 2. 发布前仍需决定和核对

- **项目许可证已选择 GPL-3.0-only。** 根目录 `LICENSE` 提供完整条款，npm、Cargo 与安装包元数据保持一致。第三方代码及素材继续适用各自的许可。
- 确认项目名称、GitHub 账号、仓库名称和维护者公开联系方式；不填虚构地址或失效徽章。
- 核对自有代码、图标、字体、示例和其他素材的来源及分发权利。参考软件样本、截图和分析证据不默认公开。
- 核对直接及传递依赖的许可义务，保留需要随源码或二进制分发的声明。`THIRD_PARTY_NOTICES.txt` 汇集锁定版本的 npm 生产依赖及 Windows Cargo 依赖（包括构建和测试依赖）许可原文；更新依赖锁时应同步更新。另有 `config/engine-licenses.txt` 与 `packaging/LICENSE-tauri.txt`，分别覆盖可选渲染资源和安装模板。这些材料不代表已完成全面法律审查。
- 检查拟提交文件与之后的提交历史，确认无密码、Token、私钥、个人数据和内部地址。基础文本扫描不能替代完整审阅。
- 在新目录或新电脑从待发布源码恢复依赖、构建并验证；发布安装包前再做对应的 UI 和安装器验收。

GPL v3 条款以根目录 LICENSE 为准。发行二进制时须提供对应版本的源码与构建脚本，并保留许可证及第三方声明；本项目通过同一仓库的版本标签和 Release 源码下载提供对应源码。私有仓库内的源码只对获授权的用户可见，不应把只有私有访问权限的链接作为面向公众分发二进制时的源码获取方式。名称与素材来源仍需在转为公开前核对。

## 3. 本地首次提交

现有工程已经初始化本地 `main` 仓库，不必再次 `git init`。首次提交前可在仓库根目录执行：

```powershell
git config user.name "YOUR_NAME"
git config user.email "YOUR_COMMIT_EMAIL"
git status --short
git add .
git diff --cached --stat
git diff --cached
```

审阅暂存内容后，再执行：

```powershell
git commit -m "Prepare MDMD source repository"
```

本地提交不上传文件。若暂存了不该提交的新文件，在首次提交前可以用 `git rm --cached -- "文件路径"` 从索引移除而保留磁盘文件，再补充忽略规则。不要使用 `git clean` 清理尚未备份的文件。

## 4. 上传 GitHub 与发布成品

目标仓库为 `abandon748/MDMD`。尚未设置远程地址时执行下列命令；若已有 `origin`，先用 `git remote -v` 核对地址，再直接推送：

```powershell
git remote add origin https://github.com/abandon748/MDMD.git
git remote -v
git push -u origin main
```

推送使用 Git Credential Manager 登录或已配置的 SSH 身份验证，不把 Token 放进 URL 或脚本。若以后已存在 origin，先核对地址，不要盲目重复添加或覆盖。

首次推送流程参考 [GitHub 官方说明](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)。只有确认许可证、来源与拟公开内容后才切换 Public。正式版本可以创建对应标签并在 Releases 上传安装包、ZIP 和校验文件；无需把编译缓存或成品二进制提交进源码历史。

发布前执行 `npm run package:installer` 及 `powershell.exe -NoProfile -File tests/release-artifacts.ps1`。将用于构建的源码提交标记为对应版本（例如 `v0.2.0`），再向该版本的 Release 上传 `../../release` 中的安装 EXE、便携 ZIP、原始 `MDMD.exe`、配套说明与许可证、`SHA256.txt`。安装包和便携 ZIP 均携带项目 LICENSE。GitHub 会为标签提供源码 ZIP 与 tar.gz 下载。

## 5. 本地资料与公开文档

本仓库的 [开发与换机指南](开发与换机指南.md) 是可独立使用的环境与操作说明。外层管理文档记录个人开发历史和参考证据，仍在原位置维护；克隆本仓库不会自动获取它们。后续需要公开某项架构决策或开发计划时，先整理成不依赖本机证据路径的说明，再放入 `docs/`，避免批量复制整套内部资料。

## 6. 本次整理验证（2026-10-28）

- 首次整理按 `git ls-files --others --exclude-standard` 导出 191 个候选源码文件，约 1.8 MiB；未包含依赖目录、编译产物或测试数据。同日按维护者要求将首版验收文档重写为当前 MDMD 的验收入口并纳入仓库，候选文件增至 192 个。
- 在独立副本执行 `npm.cmd ci`、`npm.cmd run typecheck`、`npm.cmd run build`，均成功；npm 当次审计报告 0 个漏洞，不代表持续安全保证。
- 在原工作区执行 `npm.cmd test -- --locked --offline`，31 项 Rust 测试通过。
- 候选 Markdown 的本地链接可解析，本次修改的文档保持 CRLF；原有欢迎示例使用一致 LF，保留其原字节，Git 检出时按属性规则处理。
- 基础凭据扫描未发现待处理命中。两处含用户名和密码的 URL 是已人工确认的 `example.com` 拒绝输入测试，不是真实凭据。扫描不等于完整安全或许可审计。
- 本轮仅改忽略规则、Git 属性和文档；未改应用代码、依赖锁、安装脚本或成品输出规则。未执行完整 UI、安装器回归或全新 Windows 环境验收，未重打现有发布包。

以上为 2026-10-28 的历史整理记录，不代表后续版本的验证结果。2026-11-10 维护者授权上传源码与成品，并确定 GPL v3；后续发布以实际源码标签、Release 和对应校验文件为准。
