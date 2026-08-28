# Changelog

SearchT 从 v2.1.53 起作为独立产品线维护。历史变更（衍生自上游 AionUi 的阶段）已随仓库拆分归档；本文件自此记录 SearchT 的演进。

## 2.1.53（SearchT 首个品牌版本）

- 品牌重塑：SearchT 全量标识（appId `cn.searcht.desktop`、协议 `searcht://`、数据目录 `%APPDATA%/SearchT/searcht`、个人库 `searcht-personal.db`、全新图标）。
- 内嵌浏览器：应用内搜索浏览、页面内容识别入收件箱、CSS 选择器点击/填表/滚动。
- 群组协作：邀请码与真人成员加入、时间线系统通知。
- 云同步：端到端加密（AES-256-GCM + scrypt）、WebDAV/S3 通道、三方合并、离线队列。
- 连接器：S3 兼容存储、iCal 日历订阅（飞书/Outlook/钉钉/企业微信）。
- 安装器：`AionUi.exe` → `SearchT.exe` 校验修复、盘符相对 INSTDIR 规整、完整生命周期（装/升级/静默卸载）实测通过。
- 新手引导六步：工作方式/工作台/模型隐私/连接意向/权限确认/本机 Agent。
