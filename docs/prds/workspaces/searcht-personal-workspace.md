# SearchT-UI Personal Workspace Design

**Status:** In implementation; local workspace, long-term memory, skill consolidation, and workflow automation delivered
**Date:** 2026-08-16
**Product name:** SearchT-UI (SearchT-UI)  
**Research baseline:** upstream 2.1.52, repository commit `b678d83`, AionCore v0.1.62

## 1. Summary

SearchT-UI is a local-first personal AI workspace built as a controlled hard fork of SearchT-UI. The fork retains SearchT-UI's existing application shell, navigation patterns, conversation experience, workspace, themes, assistants, Skills Hub, MCP management, Cron scheduling, model providers, channels, and component system.

SearchT-UI adds first-class personal information management and automation domains:

- Today
- Unified Inbox
- Calendar
- Tasks
- Notes
- Knowledge
- Long-term memory
- Skill consolidation
- Workflow templates
- Connectors
- Encrypted synchronization
- Permission and audit management

The product targets general users rather than developers. It is usable without an account or network connection. Technical concepts such as MCP, IMAP, CalDAV, OAuth, embeddings, and provider routing are hidden behind task-oriented language.

## 2. Confirmed Product Decisions

1. SearchT-UI is a controlled hard fork with its own brand, application identifiers, data directories, release channel, and update lifecycle.
2. SearchT-UI upstream updates do not automatically enter SearchT-UI. Security fixes and useful changes are selectively reviewed and backported.
3. The user interface remains recognizably SearchT-UI. SearchT-UI adds pages and settings using the existing component library and semantic design tokens.
4. The product is local-first. Core features work offline and without registration.
5. Synchronization is optional. Users may choose official end-to-end encrypted sync, WebDAV, S3-compatible storage, or no sync.
6. AI access uses a mixed model: included cloud allowance, user-provided API keys, and optional local models.
7. The first market is Chinese users. International connectors remain compatible with the same connector contract.
8. Permissions use a combined model: risk-based confirmation by default, plus explicit persistent authorization per workflow.
9. SearchT-UI's built-in Agent remains the default runtime. Hermes is not a runtime dependency.
10. Long-term memory and skill consolidation are implemented inside SearchT-UI Personal Core while reusing SearchT-UI skills, conversations, tools, and approval surfaces.

## 3. Goals

- Give users one desktop place for daily planning, capture, reference material, and AI-assisted action.
- Make the first useful workflow understandable without prompts, API terminology, or manual MCP configuration.
- Preserve source provenance across files, emails, notes, tasks, calendar events, knowledge results, and memories.
- Let the Agent learn reusable methods without silently changing permanent behavior.
- Keep user data available offline and portable between sync providers.
- Make every external write, deletion, and persistent authorization inspectable and revocable.
- Allow future scenario packs for office work, creators, study, and personal life without changing the core data model.

## 4. Non-Goals

- Reimplementing SearchT-UI's conversation, Agent, Skills, MCP, Cron, theme, or workspace systems.
- Copying Codex branding, proprietary assets, or exact interface styling.
- Supporting multi-user real-time collaborative document editing in the first release.
- Replacing full-featured office suites, mail clients, or cloud drives.
- Automatically sending email, deleting files, or publishing generated skills without permission.
- Uploading local content to a cloud model when the user selected a local-only privacy boundary.
- Using unofficial simulated login flows for services whose official APIs are unavailable.

## 5. Incremental UI Strategy

### 5.1 Retained SearchT-UI Surfaces

SearchT-UI retains the existing:

- Electron window and application layout
- Sider and sortable entries
- Conversation and conversation history pages
- Assistant selection and assistant settings
- Workspace file browsing and preview
- Settings layout and SettingsSider
- AppearanceSettings and CSS theme presets
- SkillsSettings and Skills Hub
- MCP ToolsSettings
- ScheduledTasksPage and Cron services
- Provider configuration
- Channel configuration
- GuidPage onboarding style
- Arco Design components, Icon Park icons, UnoCSS, CSS Modules, and semantic color tokens

### 5.2 New Sider Entries

The existing sortable Sider gains these entries:

- Today
- Inbox
- Calendar
- Tasks
- Notes
- Knowledge

Entries use `SiderItem`, `SortableSiderEntry`, `siderOrder`, and `useStoredSiderOrder`. Users can reorder and hide optional modules. Conversation and assistant entries remain available.

### 5.3 Existing Surfaces Extended

- `GuidPage`: adds local data directory, scenario packs, model setup, optional connectors, and permission defaults.
- `AppearanceSettings`: adds density, default page, module visibility, and module order while retaining existing themes and custom CSS.
- `ScheduledTasksPage`: adds workflow templates, run history, step checkpoints, and persistent authorization display.
- `SkillsSettings`: adds draft, validation, version, and rollback states for consolidated skills.
- Settings: adds Memory, Connections, Data and Sync, and Permissions and Audit sections using existing setting components.

### 5.4 Explicit UI Constraints

- No second application shell or parallel design system.
- No permanent right-hand assistant panel added globally.
- No hardcoded colors or raw interactive HTML.
- New pages must look native to SearchT-UI and use its established density and interaction patterns.
- Technical configuration is available under advanced settings, not shown during ordinary workflows.

## 6. Core User Experience

### 6.1 Today

Today is an optional start page that aggregates:

- Upcoming calendar events
- Due and scheduled tasks
- Inbox items needing attention
- Pending permission approvals
- Workflow results and failures
- A generated daily summary

Today is a projection of other domains, not an independent source of data.

### 6.2 Unified Inbox

Inbox accepts:

- Dragged files
- Global quick capture
- Watched local folders
- Email
- Calendar invitations
- Browser captures
- Screenshots
- Voice notes
- Connector events

Local enrichment may perform OCR, transcription, deduplication, classification, date extraction, entity extraction, and summarization. The original source remains linked and unchanged.

An Inbox item can become or link to:

- A task
- A calendar event or time block
- A note
- A knowledge source
- An archived file

Conversion preserves provenance. A task created from email links back to the email; a note created from a file links back to that file.

### 6.3 Calendar and Tasks

Calendar events, tasks, and schedule blocks are distinct entities:

- A task represents work and lifecycle state.
- A calendar event represents a time-bound commitment and may be externally synchronized.
- A schedule block reserves time for a task without converting the task into an external event.

Users can drag unscheduled tasks onto the calendar. The Agent may suggest schedules based on deadlines, duration, working hours, and conflicts, but does not modify external calendars without permission.

### 6.4 Notes, Knowledge, Files, and Memory

- **Source:** an original file, email, webpage, image, audio item, or external record.
- **Note:** user-authored and editable content with links, attachments, and references.
- **Knowledge index:** full-text, semantic, and entity indexes derived from sources and notes. It is rebuildable and is not the sole copy of data.
- **Memory:** a scoped fact, preference, relationship, project context, or operating rule used to personalize Agent behavior.

Knowledge does not automatically become long-term memory. Memory never replaces its source. Removing a source initiates a review of derived index entries and memories.

## 7. Desktop Architecture

SearchT-UI follows SearchT-UI's existing Electron process boundaries.

### 7.1 Renderer

New page modules live under `packages/desktop/src/renderer/pages/` and use page-private components and hooks until they have a second consumer.

Suggested page domains:

- `today/`
- `inbox/`
- `calendar/`
- `tasks/`
- `notes/`
- `knowledge/`

Renderer pages contain no Node.js or filesystem access. All IO crosses typed preload APIs.

### 7.2 Main Process

Personal business logic lives in focused main-process service domains under `packages/desktop/src/process/services/`. Each domain separates pure transformations from IO and accepts repositories and external clients through dependency injection.

Domains:

- personal database and migrations
- inbox ingestion and enrichment
- calendar and task planning
- notes and knowledge indexing
- memory lifecycle
- skill lifecycle
- workflow runtime extensions
- connectors
- permission policy and audit
- sync

### 7.3 IPC and Shared Contracts

- One bridge file per domain under `packages/desktop/src/process/bridge/`.
- Bridges validate all renderer input and expose narrow commands and queries.
- Shared request, response, entity, and event types live under `packages/desktop/src/common/`.
- Preload exposes explicit methods; it does not expose raw IPC channels.

### 7.4 Existing Agent Integration

The Agent uses Personal Core through registered tools and typed domain commands. It does not access SQLite directly. Tool responses include permission requirements, source references, and idempotency identifiers.

## 8. Local Storage

### 8.1 Database Separation

SearchT-UI's existing conversation database remains intact. SearchT-UI creates `searcht-personal.db` for personal domains. This separation limits migration risk and keeps SearchT-UI conversation recovery behavior independent.

The personal database uses:

- SQLite foreign keys
- WAL mode
- Busy timeout
- Versioned migrations
- Startup integrity checks
- Pre-upgrade snapshots
- Repository interfaces per domain

### 8.2 Attachments

Attachments use content-addressed storage keyed by a cryptographic hash. Metadata records logical names, sources, media types, and references. Identical content is stored once. Source files outside the managed store are referenced without modification unless a user-approved workflow imports them.

### 8.3 Core Entities

All synchronizable entities contain:

- `id`
- `revision`
- `device_id`
- `created_at`
- `updated_at`
- `deleted_at`
- `sync_state`

Primary domain entities include:

- workspace
- inbox item
- source
- attachment
- task
- task recurrence
- calendar account
- calendar event
- schedule block
- reminder
- note
- note revision
- knowledge document
- knowledge chunk
- entity reference
- memory candidate
- memory item
- skill draft
- skill version
- workflow definition
- workflow version
- workflow run
- workflow step run
- connector account
- permission grant
- approval request
- audit event
- sync operation

## 9. Long-Term Memory

### 9.1 Memory Types

- Preference
- Stable personal fact
- Relationship
- Project context
- Operating rule
- Temporary context with expiry

Each memory includes:

- Source references
- Confidence
- Scope: global, workspace, project, or assistant
- Sensitivity classification
- Creation reason
- Expiry or review date
- User confirmation state
- Last retrieval time

### 9.2 Memory Lifecycle

1. Conversation and successful task activity produces a candidate.
2. The extractor removes unrelated content and records evidence.
3. Low-risk temporary context may be saved under conservative policy.
4. Stable, sensitive, or behavior-changing memory requires confirmation.
5. Retrieval is scoped to the current workspace and task.
6. Users can inspect, edit, expire, export, or forget any memory.
7. Deleting a source triggers derived-memory review.

The Agent cannot grant a memory broader scope than the evidence and user approval allow.

## 10. Skill Consolidation

### 10.1 Skill and Workflow Boundary

- A skill is a reusable method invoked by a user, assistant, or workflow. It has no independent trigger or persistent permission.
- A workflow has an explicit trigger, steps, authorization, retry policy, and output destination. A workflow may call skills.

### 10.2 Consolidation Lifecycle

1. Detect a repeated successful task pattern.
2. Extract generalized steps, inputs, outputs, and tool requirements.
3. Remove paths, credentials, client names, and private content.
4. Create an inactive skill draft.
5. Replay against copies, fixtures, or simulated tools.
6. Present behavior and permission requirements to the user.
7. Publish only after approval.
8. Create a new immutable version for later improvements.
9. Allow disable, rollback, export, and deletion.

Skills that fail validation remain drafts and cannot be invoked by unattended workflows.

## 11. Workflows and Permissions

### 11.1 Workflow Model

A workflow contains:

- Trigger
- Conditions
- Ordered or branching steps
- Required skills and tools
- Input scope
- Output destination
- Retry policy
- Approval checkpoints
- Version
- Enablement state

Each run records immutable input references, step results, tool calls, approvals, errors, and final outcome.

### 11.2 Permission Model

Default policy:

- Read and local analysis may run automatically inside authorized scopes.
- Draft creation and reversible local writes show the result before commitment when risk is material.
- Email sending, external publishing, file deletion, overwrite, credential use, and financial actions require confirmation.
- A user may explicitly grant persistent permission to one workflow with resource, action, constraint, and expiry limits.

The Agent cannot create, expand, or renew a permission grant. Persistent grants are visible in Settings and revocable immediately.

### 11.3 Retry Safety

- Read and analysis steps may retry automatically.
- Externally visible writes use idempotency keys.
- Ambiguous email send, file move, deletion, or external mutation results do not retry automatically.
- Workflow version updates affect new runs only; active runs retain their starting version.

## 12. Connectors

### 12.1 Connector Contract

Every connector implements:

- Authentication and token refresh
- Capability discovery
- User-selectable sync scope
- Incremental cursor or checkpoint
- External identifier mapping
- Idempotent read and write operations
- Rate-limit state
- Retry policy
- Reauthorization state
- Disconnect and local-data disposition
- Diagnostics without secret exposure

Secrets are stored through operating-system secure storage. They are excluded from regular configuration exports and synchronization.

### 12.2 Rollout

**P0:**

- Local folders
- QQ Mail
- 163 Mail
- Outlook
- Feishu Calendar
- WebDAV and Jianguoyun
- S3-compatible storage

**P1:**

- DingTalk Calendar
- WeCom
- Aliyun Drive
- Baidu Netdisk

**P2:**

- Google Workspace
- Microsoft 365 expansion
- Dropbox
- Notion
- Slack

P1 drive connectors ship only when official API access and distribution terms permit reliable integration.

## 13. Model Gateway

The provider gateway supports:

- Included cloud allowance
- User API keys
- SearchT-UI-supported cloud providers
- Local OpenAI-compatible endpoints and Ollama-style local providers
- Capability detection
- Cost and quota status
- Explicit privacy-boundary transitions

Fallback from local to cloud requires user consent when content would leave the device. Drafts and intermediate task state survive provider errors.

## 14. Synchronization

### 14.1 Modes

- Disabled
- Official end-to-end encrypted sync
- WebDAV
- S3-compatible storage

The local database remains the primary working copy in every mode.

### 14.2 Data Format

Synchronization transfers encrypted operation records and encrypted attachment blocks. Official servers store ciphertext and minimal routing metadata. Key recovery design must not give the server access to user plaintext.

### 14.3 Conflict Rules

- Simple task fields use deterministic field-level merge.
- Calendar synchronization respects external version identifiers and sync cursors.
- Concurrent note edits create explicit conflict versions for user merge.
- Deletes use tombstones to prevent resurrection.
- Attachment blocks deduplicate by encrypted content identifier within the user's account.
- First release does not support real-time multi-user co-editing.

## 15. Onboarding

The existing GuidPage style is extended with five skippable steps:

1. Choose a local data directory; no registration required.
2. Select one or more scenario packs: office, creator, study, personal life.
3. Select included cloud allowance, personal API key, or local model.
4. Optionally connect email, calendar, drive, and messaging services.
5. Review default permissions and enter the existing SearchT-UI home experience.

Ordinary UI uses user-facing actions such as "Connect QQ Mail" and "Choose a folder." Protocol and provider terminology appears only under advanced settings.

## 16. Personalization

SearchT-UI extends existing SearchT-UI personalization rather than replacing it:

- Existing CSS themes and custom CSS
- Light, dark, and system appearance behavior
- Interface density
- Default start page
- Sider module visibility
- Sider module order
- Scenario pack enablement
- Daily summary enablement
- Default assistant and model preferences

Presets provide useful defaults. Personalization does not become a general low-code page builder in the first release.

## 17. Failure and Recovery

### 17.1 Database

- Integrity check at startup
- Existing SearchT-UI corruption recovery remains unchanged for conversation data
- Personal database snapshots before migration
- Failed migrations roll back without opening a partially migrated schema
- Rebuildable search indexes are recreated from primary data

### 17.2 Connectors

- Network failures use bounded exponential backoff
- Expired authorization becomes `reauthorization_required`
- Rate limits show the next retry time without repeated notifications
- External IDs and idempotency keys prevent duplicates
- Disconnecting stops new synchronization and asks whether local derived data should remain

### 17.3 Agent and Models

- Drafts and workflow checkpoints persist before model calls
- Provider failure does not discard user input
- Local-to-cloud fallback is never silent
- Memory or skill extraction failure does not fail the original user task

## 18. SearchT-UI Data Import

SearchT-UI uses its own application ID, product name, data directory, signing identity, and update server. On first start it may offer a one-time, non-destructive import from an existing SearchT-UI installation:

- Model configuration
- Assistants
- Skills
- MCP configuration
- Conversation history
- Workspaces
- Appearance themes

The importer creates a backup and never modifies the original SearchT-UI data directory.

## 19. Delivery Decomposition

Implementation is split into independently mergeable work streams:

1. Fork identity, package metadata, data directory, updater, and SearchT-UI import contract.
2. Personal database foundation, migrations, repository contracts, and IPC conventions.
3. Sider registration, module visibility, module ordering, and route shells.
4. Tasks domain.
5. Calendar and schedule-block domain.
6. Unified Inbox and local folder ingestion.
7. Notes and knowledge indexing.
8. Long-term memory candidates, review, retrieval, and deletion.
9. Skill draft lifecycle and Skills Hub integration.
10. Workflow templates, run history, checkpoints, and grants.
11. P0 connectors, each delivered independently.
12. Official encrypted sync.
13. WebDAV and S3 sync.
14. Extended GuidPage onboarding and scenario packs.
15. Packaging, migration, recovery, and release hardening.

Each code change follows SearchT-UI's atomic PR requirement. Cross-domain foundation is introduced only when the next independently useful feature needs it.

### 19.1 Current Delivery Status (2026-08-16)

Delivered in the current local build:

- Personal Core schema v8 with task, calendar, Inbox, notes, knowledge, memory, managed-skill, and workflow storage.
- Task creation, editing, completion, reopening, recoverable deletion, restore, permanent deletion, and trash emptying.
- Daily, weekday, weekly, monthly, and interval recurrence with retained history and this-only / this-and-future scope controls.
- Browser IndexedDB compatibility through schema v5 with desktop-equivalent lifecycle behavior.
- Today projection for overdue and due-today tasks, limited to eight actionable items.
- Local calendar, unified Inbox, file capture, notes with revision history, and knowledge indexing.
- Long-term memory candidates, review, scoped retrieval, expiry, reactivation, and permanent forgetting.
- Skill candidates, local validation, explicit review, SearchT-UI publication, immutable versions, disable/enable, and rollback.
- Conversation skill suggestions can enter the review queue without gaining publication or filesystem authority.
- Four Chinese-first workflow templates with AionCore Cron materialization, immediate runs, enable/disable, and missing-job repair.
- Immutable workflow versions, version-pinned run history, soft deletion, recoverable workflow trash, and disabled-on-restore safety.
- External-write approval checkpoints, one-time approval, 7/30-day constrained grants, same-run resume, rejection, and immediate revocation in Settings.
- Typed domain bridges, Chinese-first UI, and localized product keys for every configured locale.

Not delivered in this phase:

- External calendar synchronization and schedule-block synchronization.
- Email, drive, calendar, and messaging connectors.
- Cloud synchronization and multi-device conflict handling.
- Extended onboarding, scenario packs, release migration, and production signing hardening.

## 20. Verification and Acceptance

### 20.1 Automated Coverage

- Unit tests for pure domain logic and permission policy
- Repository and migration tests with real SQLite fixtures
- IPC contract tests for every bridge
- Connector contract tests with mock services
- Synchronization tests for offline, duplicate, out-of-order, delete, and concurrent-edit scenarios
- Negative tests proving the Agent cannot expand authorization
- Workflow restart, retry, idempotency, and ambiguous-write tests
- Packaged-build tests on Windows, macOS, and Linux

### 20.2 End-to-End Flows

- Inbox item to task with preserved source link
- Task scheduled as a time block without mutating the task
- Note referencing a local file and displaying citation provenance
- Knowledge answer with source citations
- Memory candidate confirmation, scope change, expiry, and deletion
- Skill draft generation, sanitization, validation, publication, and rollback
- Workflow waiting for approval and resuming after confirmation
- Connector expiration and reauthorization without local data loss
- Offline startup and use without account login
- SearchT-UI data import without modifying source data

### 20.3 Product Acceptance

- Core local features function without network access or registration.
- New pages visually conform to SearchT-UI and use existing components and semantic tokens.
- Ordinary users can complete onboarding without seeing protocol configuration.
- Search over 50,000 local indexed records targets a response within 500 ms on supported baseline hardware.
- No external write occurs outside its explicit permission scope.
- Every memory, skill, workflow run, and external action is inspectable and removable.
- Sync failures never make the local working copy unavailable.

## 21. Risks and Mitigations

- **Fork maintenance:** own dependency, Electron, signing, and OS compatibility updates; selectively backport upstream fixes.
- **Connector policy changes:** use capability contracts and ship only official, testable integrations.
- **Agent overreach:** isolate data access behind tools, approvals, grants, and immutable audit events.
- **Memory pollution:** require provenance, scope, confidence, expiry, and review.
- **Skill drift:** validate drafts, version published skills, and permit rollback.
- **Sync complexity:** avoid real-time collaboration in the first release and preserve conflict versions.
- **Feature overload:** use scenario packs and progressive disclosure while keeping core modules consistent.

## 22. Final Product Statement

The first impression remains SearchT-UI: the same desktop structure, conversation workflow, settings conventions, themes, assistants, and tools. SearchT-UI adds calendar, tasks, notes, knowledge, Inbox, long-term memory, personal automation, and local-first synchronization as native SearchT-UI-style capabilities under the SearchT-UI brand.
