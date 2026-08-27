# SearchT-UI

**English** | [简体中文](README.md)

**A local-first AI personal workspace.** SearchT-UI brings your calendar, tasks, notes, knowledge base, inbox, long-term memory, skills, workflows and on-device agent collaboration into one offline-capable desktop app — your data stays on your machine, with AI working right beside you.

![License](https://img.shields.io/badge/license-Apache--2.0-blue)

## Screenshots

Real app captures (v2.1.53, Chinese UI).

| Today Workspace                                                                                       | Embedded Browser                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ![Today workspace](docs/screenshots/today.png)                                                        | ![Embedded browser: browse + content extraction](docs/screenshots/browser.png)                           |
| Current focus, schedule, tasks and inbox in one view                                                  | Browse the web inside the app; extract page content into the inbox in one click; drive pages via CSS selectors |

| Tasks & Calendar                                                                                      | Knowledge & Inbox                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ![Tasks](docs/screenshots/tasks.png)                                                                  | ![Knowledge base](docs/screenshots/knowledge.png)                                                        |
| ![Calendar](docs/screenshots/calendar.png)                                                            | ![Inbox](docs/screenshots/inbox.png)                                                                     |
| Recurrence rules, reminders, calendar views                                                           | Full-text-searchable knowledge base; a multi-source triage inbox                                         |

| Connector Settings                                                                                    | Personal Workspace Settings                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ![Connectors](docs/screenshots/settings-connections.png)                                              | ![Workspace](docs/screenshots/settings-workspace.png)                                                    |
| WebDAV / S3 / mailboxes / iCal subscriptions                                                          | Data directory, end-to-end-encrypted cloud sync and more                                                |

> Screenshot capture script: `node scripts/e2e/capture-screenshots.cjs` (launch the app with `--remote-debugging-port=9222`).

## Feature Overview

| Area            | Capabilities                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Personal hub    | Today view, tasks (with recurrence), calendar (reminders), notes (version history), knowledge base (full-text search), inbox, trash & restore |
| Embedded browser| Browse and search the web in-app; extract page content into the inbox; click / fill / scroll programmatically via CSS selectors            |
| Agent teams     | Local agent group chats (task split, @mentions, result summary, failure recovery); invite codes and human members                          |
| Long-term memory| Memory candidates review, confirmation, expiry & forgetting, semantic retrieval                                                            |
| Skill building  | Candidate review, immutable versioned releases, rollback, enable/disable                                                                   |
| Workflows       | Template installation, scheduled runs, approvals and permission (grant) management                                                          |
| Connectors      | Local folders, QQ/163 mailboxes, Jianguoyun/WebDAV (read-only), S3-compatible storage, iCal subscriptions (Feishu/Outlook/DingTalk/WeCom)  |
| Cloud sync      | End-to-end encryption (AES-256-GCM + scrypt), WebDAV/S3 transports, per-record 3-way merge, tombstones, conflict copies, offline queue     |
| Data ownership  | Standalone data directory, E2E-encrypted backups, one-click migration from legacy AionUi (plan → import → report → rollback)               |

## Getting Started

```bash
# Prerequisite: Node.js >= 22
bun install           # or npm install
npm run dev           # start the desktop app in dev mode
npm test              # full unit test suite (4,600+ cases)
npm run dist:win      # build the Windows installer (dist:mac / dist:linux likewise)
```

On first launch a six-step setup walks you through: working style → workspace → models & privacy boundaries → connector intents → permission confirmation → on-device agent detection.

## Data Locations

| Platform | Path                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| Windows  | `%APPDATA%\SearchT-UI\searcht\` (personal database `searcht-personal.db`)                 |
| macOS    | `~/Library/Application Support/SearchT-UI/searcht/`                                      |
| Linux    | `~/.config/SearchT-UI/searcht/`                                                           |

Auto-update is disabled by default; operators can point `SEARCHT_UPDATE_BASE_URL` at a self-hosted HTTPS update feed (see `docs/release/searcht-release-runbook.md`).

## Developer Docs

- Release process & installer conventions: `docs/release/searcht-release-runbook.md`
- Product requirement baseline: `docs/prds/workspaces/searcht-personal-workspace.md`
- Local feature-level E2E: `scripts/e2e/local-machine-e2e.ts` (requires the Electron runtime)
- UI walkthrough: `scripts/e2e/ui-walkthrough.cjs` (drives the real window over CDP)

## License

Apache-2.0. SearchT-UI is derived from AionUi (Apache-2.0) with substantial modification; per Section 4 of Apache-2.0, please retain the upstream copyright notices when redistributing (SPDX headers in each source file).
