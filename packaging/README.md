# Windows 安装模板

installer.nsi 基于 Tauri 官方模板快照，采用 MIT 许可（LICENSE-tauri.txt）。上游来源：
https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi

本地冻结副本，不在构建时拉取 dev。原始快照 SHA-256：d00089d3b1a2c4a30d7b6e098079100cb8f25e980f84d4515aca4597b95e967d

与原始模板的修改：移除“删除应用数据”复选框及递归数据清理；移除未使用的自动启动值清理；交互升级调用旧卸载器时传 /UPDATE；保留已有非本安装快捷方式。hooks.nsh 替换原模板的强制结束进程宏为文件可写检查，卸载前调用当前 EXE 的所有权清理，失败中止；卸载后仅清理匹配本安装路径的安装位置元数据。

Tauri CLI 2.12.3 提供编译／校验下载的 NSIS 3.13 与 nsis_tauri_utils 0.5.3；无新增 JS／Rust 第三方依赖。升级这些工具时须比较上游模板并重跑 installer.test.mjs，不能直接覆盖冻结模板。NSIS 以及插件的许可随其工具缓存提供，不属于用户文档缓存。

npm run package:installer 构建正式安装包和 ZIP。tests/installer.test.mjs 要求当前用户尚无 MDMD 安装器登记；已有安装时直接拒绝运行，不能拿日常安装替代隔离测试。它使用实际正式安装器、临时中文路径、/NS 禁止创建测试快捷方式；系统集成操作仅进入固定 UUID 测试命名空间。旧版本安装器是用上一版本真实 EXE 和当前安装策略生成的迁移夹具，不是历史已发布安装器。
