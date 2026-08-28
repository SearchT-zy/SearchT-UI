# SearchT（SearchT）发布运行手册

本手册覆盖从源码构建到正式发布的完整链路：构建矩阵、安装包实测、aioncore 打包校验、自动更新服务、签名与卸载验证。

## 1. 构建矩阵

| 平台    | 架构        | 命令                                     |
| ------- | ----------- | ---------------------------------------- |
| Windows | x64         | `npm run dist:win`（或 `build-win:x64`） |
| Windows | arm64       | `npm run build-win:arm64`                |
| macOS   | arm64 / x64 | `npm run dist:mac`（双架构 `build-mac`） |
| Linux   | x64 / arm64 | `npm run dist:linux`                     |

- 所有构建通过 `scripts/build-with-builder.js` 编排，始终 `--publish=never`（发布上传是显式步骤）。
- aioncore 二进制由 `packages/shared-scripts/src/prepare-aioncore.js` 解析：
  1. `SEARCHT_BACKEND_RUN_ID`（GitHub Actions artifact）
  2. GitHub Release（`iOfficeAI/AionCore`）
  3. `SEARCHT_BACKEND_LOCAL_BUNDLE_DIR`（本地完整 bundle）
  4. `SEARCHT_BACKEND_LOCAL_BINARY`（本地裸二进制）
- 产物输出在 `out/`（unpacked 目录）与项目根 `out/` 构建目录中的安装包。

## 2. 打包后校验（必做）

```bash
# 校验 unpacked 目录：主程序、app.asar、bundled-aioncore/<plat-arch>/aioncore[.exe]、manifest.json
node scripts/release/verify-packaged-app.mjs out/win-unpacked win32-x64
```

脚本逐项检查并输出 PASS/FAIL；任何 FAIL 都阻断发布。

## 3. Windows 安装包实测（在有 GUI 会话的 Windows 机器/VM 上）

```powershell
# 静默安装 → 校验安装目录/卸载注册表 → 启动 12 秒冒烟 → 静默卸载 → 校验清理
node scripts/release/verify-win-installer.mjs ".\SearchT Setup 2.1.53.exe"

# 附加旗标
#   --per-user  按 currentuser 安装（默认 allusers）
#   --keep      保留安装（跳过卸载阶段，便于人工继续测试）
```

人工补充项（脚本无法覆盖）：

- 安装/卸载 UAC 提示与开始菜单、桌面快捷方式。
- 覆盖安装（升级）保留用户数据：`%APPDATA%\SearchT` 下的 `searcht/`、`config/` 目录不变。
- 卸载后重装可正常启动（数据目录不随卸载删除）。
- 崩溃恢复：手动结束进程后再次启动，会话列表与SearchT个人库（`searcht-personal.db`）完好。

## 4. 自动更新服务

桌面端更新走通用 CDN feed（`packages/desktop/src/process/services/updateFeed.ts`）：

- 客户端通过环境变量 `SEARCHT_UPDATE_BASE_URL` 指向 feed 根（必须 HTTPS，禁止 aionui.com 域）。
- feed 根目录需要包含 `latest.yml` 与安装包（可选 `.blockmap` 增量）。

发布流程：

```bash
# 1. 暂存安装包并生成 latest.yml（含 sha512/size）
node scripts/release/publish-update.mjs ./release-stage "out/SearchT Setup 2.1.53.exe" "out/SearchT Setup 2.1.53.exe.blockmap"

# 2. 本地/内网验证 feed（另一台机器装旧版，指向该地址检查更新）
node scripts/release/update-server.mjs 8787 ./release-stage
#   客户端设置 SEARCHT_UPDATE_BASE_URL=http://<host>:8787 后触发检查更新

# 3. 验证通过后将 release-stage 目录整体上传到静态托管（对象存储/CDN），
#    生产环境只允许 HTTPS 地址。
```

回滚：把 `latest.yml` 指回旧版本文件（保留旧安装包于 feed 目录）。

## 5. 签名与公证（正式发布前）

- Windows：配置 `CSC_LINK`/`CSC_KEY_PASSWORD` 使用代码签名证书；electron-builder 会对 exe 与卸载程序签名。未签名构建会触发 SmartScreen 警告，仅限内测。
- macOS：`CSC_LINK` + `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` 走 notarization；`entitlements.plist` 已就位。
- Linux：AppImage 无签名要求，可选 `.sig` 文件。

## 6. 静默安装/卸载调用规范（2026-08-24 实测验证）

安装器与卸载器全生命周期均已实测通过（全新安装、升级覆盖安装、启动、静默卸载、注册表清理）。此前记录的"静默卸载失效 / `/D=` 反斜杠被吞 / E1002 升级阻塞"均为**测试脚本转义问题**（heredoc 吞掉一层反斜杠，`D:\searcht` 变成 `D:searcht`），不是产品缺陷。正确调用方式：

1. **静默安装到指定目录**（Node 脚本内，JS 字符串中 `\\` 才是一个反斜杠）：`spawnSync(installerExe, ['/S', '/D=D:\\searcht'])` — `/D=` 必须是最后一个参数、不加引号。
2. **静默卸载**（与注册表 QuietUninstallString 一致）：`spawnSync('D:\\searcht\\Uninstall SearchT.exe', ['/currentuser', '/S'])` — 原进程立即返回 0，实际删除由其 %TEMP% 副本异步完成（约 10-40 秒），完成后安装目录与卸载注册表键全部清除。以安装目录消失为完成信号。
3. **`_?=目录` 原地模式**仅用于需要同步退出码的场合：卸载器无法删除自身，会残留 `Uninstall SearchT.exe` 并因残留检查以退出码 2 结束——预期行为，不要当作失败。
4. **升级覆盖安装**：对同作用域已有安装直接再次运行新安装器即可，内部先静默卸载旧版再装新版（实测完整成功）。同作用域共享同一卸载键（electron-builder 默认行为）。
5. **防御加固**：安装器 `customInit` 会把盘符相对的 `INSTDIR`（如 `D:searcht`）规整为 `D:\searcht`，即使调用方转义出错也能保证注册表与文件布局确定。

## 7. better-sqlite3 双 ABI 说明

仓库内有两份 `better-sqlite3`：

- `node_modules/.bun/better-sqlite3@*/` —— **Electron ABI**，桌面应用与打包使用；由 `just rebuild-native`（`bunx electron-rebuild -f -w better-sqlite3`）构建。
- `node_modules/better-sqlite3/` —— **Node ABI**，单测使用；由 `npm rebuild better-sqlite3` 构建，`vitest.config.ts` 已配置别名固定指向它。

因此重打 Electron 原生模块后**不需要**再为跑测试来回切换 ABI；若顶层副本被误重建为 Electron ABI，执行 `npm rebuild better-sqlite3` 即可恢复测试能力。

## 8. 发布前检查清单

- [ ] `npm run lint` / `npm run format:check` / `tsc --noEmit` 全绿
- [ ] `npm test`（单测）与 `tests/integration` 通过
- [ ] `verify-packaged-app.mjs` 每个平台架构通过
- [ ] Windows 安装包冒烟（`verify-win-installer.mjs`）通过
- [ ] 覆盖安装升级路径实测（旧版本 → 新版本，数据保留）
- [ ] 更新 feed 在 staging 验证一次升级
- [ ] `docs/prds/workspaces/searcht-personal-workspace.md` 的验收条目复核
