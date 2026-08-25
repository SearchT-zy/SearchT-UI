import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

export const PERSONAL_SCHEMA_VERSION = 13;

export function migratePersonalSchema(driver: ISqliteDriver, fromVersion: number): void {
  if (fromVersion > PERSONAL_SCHEMA_VERSION) {
    throw new Error(`Personal Core schema ${fromVersion} is newer than supported schema ${PERSONAL_SCHEMA_VERSION}`);
  }
  if (fromVersion === PERSONAL_SCHEMA_VERSION) return;

  driver.transaction(() => {
    driver.exec(`CREATE TABLE IF NOT EXISTS workspace_preferences (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS personal_audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS task_series (
      id TEXT PRIMARY KEY,
      rule_json TEXT NOT NULL,
      end_json TEXT NOT NULL,
      timezone TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      stopped_at TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_at TEXT,
      due_local_date TEXT,
      estimated_minutes INTEGER,
      status TEXT NOT NULL,
      completed_at INTEGER,
      series_id TEXT REFERENCES task_series(id) ON DELETE SET NULL,
      occurrence_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      UNIQUE(series_id, occurrence_key)
    )`);
    driver.exec('CREATE INDEX IF NOT EXISTS idx_tasks_view ON tasks (deleted_at, status, due_local_date)');
    driver.exec('CREATE INDEX IF NOT EXISTS idx_tasks_series ON tasks (series_id, occurrence_key)');
    driver.exec(`CREATE TABLE IF NOT EXISTS calendar_series (
      id TEXT PRIMARY KEY,
      rule_json TEXT NOT NULL,
      end_json TEXT NOT NULL,
      timezone TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      stopped_at TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
      starts_at TEXT,
      ends_at TEXT,
      start_local_date TEXT NOT NULL,
      end_local_date TEXT NOT NULL,
      timezone TEXT NOT NULL,
      series_id TEXT REFERENCES calendar_series(id) ON DELETE SET NULL,
      occurrence_key TEXT,
      reminder_minutes INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      UNIQUE(series_id, occurrence_key)
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS schedule_blocks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      local_date TEXT NOT NULL,
      timezone TEXT NOT NULL,
      reminder_minutes INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL CHECK (owner_type IN ('event', 'schedule-block')),
      owner_id TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      claimed_at INTEGER,
      delivered_at INTEGER,
      cancelled_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(owner_type, owner_id)
    )`);
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events (deleted_at, start_local_date, end_local_date)'
    );
    driver.exec('CREATE INDEX IF NOT EXISTS idx_calendar_events_series ON calendar_events (series_id, occurrence_key)');
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_schedule_blocks_range ON schedule_blocks (deleted_at, local_date, starts_at)'
    );
    driver.exec('CREATE INDEX IF NOT EXISTS idx_schedule_blocks_task ON schedule_blocks (task_id)');
    driver.exec('CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (status, scheduled_at)');
    driver.exec(`CREATE TABLE IF NOT EXISTS inbox_assets (
      id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL UNIQUE,
      managed_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      created_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS inbox_asset_origins (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES inbox_assets(id) ON DELETE RESTRICT,
      original_name TEXT NOT NULL,
      original_path TEXT,
      imported_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS inbox_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('text', 'link', 'file')),
      state TEXT NOT NULL CHECK (state IN ('pending', 'organized', 'archived')),
      title TEXT NOT NULL,
      text_content TEXT,
      url TEXT,
      origin_id TEXT REFERENCES inbox_asset_origins(id) ON DELETE RESTRICT,
      captured_at INTEGER NOT NULL,
      organized_at INTEGER,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      CHECK (
        (kind = 'text' AND text_content IS NOT NULL AND url IS NULL AND origin_id IS NULL) OR
        (kind = 'link' AND text_content IS NULL AND url IS NOT NULL AND origin_id IS NULL) OR
        (kind = 'file' AND text_content IS NULL AND url IS NULL AND origin_id IS NOT NULL)
      )
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS source_links (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK (source_type = 'inbox-item'),
      source_id TEXT NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('task', 'calendar-event', 'note', 'knowledge-source')),
      target_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(source_type, source_id, target_type, target_id)
    )`);
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_inbox_items_view ON inbox_items (deleted_at, state, captured_at DESC, id)'
    );
    driver.exec('CREATE INDEX IF NOT EXISTS idx_inbox_items_kind ON inbox_items (kind, deleted_at, captured_at DESC)');
    driver.exec('CREATE INDEX IF NOT EXISTS idx_inbox_items_title ON inbox_items (title)');
    driver.exec('CREATE INDEX IF NOT EXISTS idx_inbox_origins_asset ON inbox_asset_origins (asset_id)');
    driver.exec('CREATE INDEX IF NOT EXISTS idx_source_links_source ON source_links (source_type, source_id)');
    driver.exec('CREATE INDEX IF NOT EXISTS idx_source_links_target ON source_links (target_type, target_id)');
    driver.exec(`CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      body TEXT NOT NULL,
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS note_revisions (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(note_id, revision_number)
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS knowledge_sources (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK (source_type IN ('note', 'inbox-item')),
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(source_type, source_id)
    )`);
    driver.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      source_id UNINDEXED,
      title,
      content_text,
      tokenize = 'unicode61'
    )`);
    driver.exec('CREATE INDEX IF NOT EXISTS idx_notes_view ON notes (deleted_at, archived_at, updated_at DESC, id)');
    driver.exec('CREATE INDEX IF NOT EXISTS idx_notes_title ON notes (title)');
    driver.exec('CREATE INDEX IF NOT EXISTS idx_note_revisions_note ON note_revisions (note_id, revision_number DESC)');
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_knowledge_sources_kind ON knowledge_sources (source_type, updated_at DESC, id)'
    );
    driver.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_sources_recent ON knowledge_sources (updated_at DESC, id)');
    driver.exec(`CREATE TABLE IF NOT EXISTS memory_candidates (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      memory_type TEXT NOT NULL CHECK (memory_type IN (
        'preference', 'personal-fact', 'relationship', 'project-context', 'operating-rule', 'temporary-context'
      )),
      proposed_scope_kind TEXT NOT NULL CHECK (proposed_scope_kind IN ('global', 'workspace', 'project', 'assistant')),
      proposed_scope_id TEXT,
      sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'sensitive')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
      source_refs_json TEXT NOT NULL,
      suggested_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (
        (proposed_scope_kind = 'global' AND proposed_scope_id IS NULL) OR
        (proposed_scope_kind <> 'global' AND proposed_scope_id IS NOT NULL AND length(trim(proposed_scope_id)) > 0)
      )
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      memory_type TEXT NOT NULL CHECK (memory_type IN (
        'preference', 'personal-fact', 'relationship', 'project-context', 'operating-rule', 'temporary-context'
      )),
      scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'workspace', 'project', 'assistant')),
      scope_id TEXT,
      sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'sensitive')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
      source_refs_json TEXT NOT NULL,
      confirmed_at INTEGER NOT NULL,
      expires_at INTEGER,
      review_at INTEGER,
      last_retrieved_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (
        (scope_kind = 'global' AND scope_id IS NULL) OR
        (scope_kind <> 'global' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)
      )
    )`);
    driver.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      memory_id UNINDEXED,
      content,
      tokenize = 'unicode61'
    )`);
    driver.exec(`CREATE TRIGGER IF NOT EXISTS trg_memory_items_insert
      AFTER INSERT ON memory_items BEGIN
        INSERT INTO memory_fts (memory_id, content) VALUES (new.id, new.content);
      END`);
    driver.exec(`CREATE TRIGGER IF NOT EXISTS trg_memory_items_update
      AFTER UPDATE OF content ON memory_items BEGIN
        DELETE FROM memory_fts WHERE memory_id = old.id;
        INSERT INTO memory_fts (memory_id, content) VALUES (new.id, new.content);
      END`);
    driver.exec(`CREATE TRIGGER IF NOT EXISTS trg_memory_items_delete
      AFTER DELETE ON memory_items BEGIN
        DELETE FROM memory_fts WHERE memory_id = old.id;
      END`);
    driver.exec('CREATE INDEX IF NOT EXISTS idx_memory_candidates_recent ON memory_candidates (updated_at DESC, id)');
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_memory_items_scope ON memory_items (scope_kind, scope_id, updated_at DESC, id)'
    );
    driver.exec('CREATE INDEX IF NOT EXISTS idx_memory_items_expiry ON memory_items (expires_at, updated_at DESC, id)');
    driver.exec(`CREATE TABLE IF NOT EXISTS skill_candidates (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE CHECK (length(trim(operation_id)) > 0),
      proposed_name TEXT NOT NULL CHECK (
        length(proposed_name) BETWEEN 1 AND 64 AND
        proposed_name = lower(proposed_name) AND
        proposed_name NOT GLOB '*[^a-z0-9-]*' AND
        proposed_name NOT LIKE '-%' AND
        proposed_name NOT LIKE '%-' AND
        proposed_name NOT LIKE '%--%'
      ),
      description TEXT NOT NULL,
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      required_tools_json TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status = 'pending'),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS managed_skills (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE CHECK (
        length(slug) BETWEEN 1 AND 64 AND
        slug = lower(slug) AND
        slug NOT GLOB '*[^a-z0-9-]*' AND
        slug NOT LIKE '-%' AND
        slug NOT LIKE '%-' AND
        slug NOT LIKE '%--%'
      ),
      description TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('active', 'disabled')),
      active_version_id TEXT REFERENCES skill_versions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS skill_versions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES managed_skills(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK (version_number >= 1),
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      content_hash TEXT NOT NULL CHECK (length(trim(content_hash)) > 0),
      required_tools_json TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      change_summary TEXT NOT NULL,
      candidate_id TEXT,
      created_at INTEGER NOT NULL,
      published_at INTEGER NOT NULL,
      UNIQUE(skill_id, version_number)
    )`);
    driver.exec('CREATE INDEX IF NOT EXISTS idx_skill_candidates_recent ON skill_candidates (updated_at DESC, id)');
    driver.exec('CREATE INDEX IF NOT EXISTS idx_managed_skills_state ON managed_skills (state, updated_at DESC, id)');
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_skill_versions_skill ON skill_versions (skill_id, version_number DESC, id)'
    );
    driver.exec(`CREATE TABLE IF NOT EXISTS workflow_instances (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE CHECK (length(trim(operation_id)) > 0),
      template_id TEXT,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      description TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('active', 'disabled', 'needs-repair', 'deleted')),
      runtime_job_id TEXT NOT NULL UNIQUE CHECK (length(trim(runtime_job_id)) > 0),
      active_version_id TEXT REFERENCES workflow_versions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS workflow_versions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK (version_number >= 1),
      definition_json TEXT NOT NULL,
      compiled_prompt TEXT NOT NULL CHECK (length(trim(compiled_prompt)) > 0),
      change_summary TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(workflow_id, version_number)
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
      runtime_run_key TEXT NOT NULL CHECK (length(trim(runtime_run_key)) > 0),
      state TEXT NOT NULL CHECK (state IN (
        'pending', 'waiting-approval', 'running', 'succeeded', 'failed', 'skipped', 'missed'
      )),
      input_json TEXT NOT NULL,
      conversation_id TEXT,
      error_code TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      UNIQUE(workflow_id, runtime_run_key)
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS workflow_approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      resource TEXT NOT NULL CHECK (length(trim(resource)) > 0),
      action TEXT NOT NULL CHECK (length(trim(action)) > 0),
      state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'rejected')),
      decided_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE(run_id, resource, action)
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS workflow_grants (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      resource TEXT NOT NULL CHECK (length(trim(resource)) > 0),
      action TEXT NOT NULL CHECK (length(trim(action)) > 0),
      constraints_json TEXT NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    )`);
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_workflow_instances_state ON workflow_instances (state, updated_at DESC, id)'
    );
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow ON workflow_versions (workflow_id, version_number DESC, id)'
    );
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_workflow_runs_recent ON workflow_runs (workflow_id, created_at DESC, id)'
    );
    driver.exec('CREATE INDEX IF NOT EXISTS idx_workflow_approvals_run ON workflow_approvals (run_id, state, id)');
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_workflow_grants_workflow ON workflow_grants (workflow_id, revoked_at, expires_at, id)'
    );
    driver.exec(`CREATE TABLE IF NOT EXISTS collaboration_messages (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      sender_kind TEXT NOT NULL CHECK (sender_kind IN ('user', 'agent', 'system')),
      sender_slot_id TEXT,
      target_mode TEXT NOT NULL CHECK (target_mode IN ('coordinator', 'members', 'all')),
      target_slot_ids_json TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('instruction', 'progress', 'handoff', 'result', 'approval', 'error')),
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      file_refs_json TEXT NOT NULL,
      source_event_id TEXT UNIQUE,
      conversation_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS collaboration_deliveries (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES collaboration_messages(id) ON DELETE CASCADE,
      target_slot_id TEXT NOT NULL,
      team_run_id TEXT,
      status TEXT NOT NULL CHECK (status IN (
        'pending', 'accepted', 'running', 'completed', 'failed', 'cancelled', 'unknown'
      )),
      error_code TEXT,
      error_detail TEXT,
      attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
      last_attempt_at INTEGER,
      UNIQUE(message_id, target_slot_id)
    )`);
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_collaboration_messages_team ON collaboration_messages (team_id, created_at, id)'
    );
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_collaboration_deliveries_message ON collaboration_deliveries (message_id, target_slot_id)'
    );
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_collaboration_deliveries_run ON collaboration_deliveries (team_run_id, target_slot_id)'
    );
    driver.exec(`CREATE TABLE IF NOT EXISTS collaboration_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 32),
      member_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
      joined_via TEXT NOT NULL CHECK (joined_via IN ('creator', 'invite-code')),
      joined_at INTEGER NOT NULL,
      UNIQUE (team_id, member_key)
    )`);
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_collaboration_members_team ON collaboration_members (team_id, joined_at, id)'
    );
    driver.exec(`CREATE TABLE IF NOT EXISTS collaboration_invite_codes (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE CHECK (
        length(code) = 14 AND
        code = upper(code) AND
        code NOT GLOB '*[^A-Z0-9-]*' AND
        code LIKE 'ZX-%'
      ),
      max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
      use_count INTEGER NOT NULL CHECK (use_count >= 0 AND use_count <= max_uses),
      expires_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    )`);
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_collaboration_invite_codes_team ON collaboration_invite_codes (team_id, created_at, id)'
    );
    driver.exec(`CREATE TABLE IF NOT EXISTS searcht_import_reports (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'rolled-back')),
      report_json TEXT NOT NULL,
      rollback_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_searcht_import_reports_recent ON searcht_import_reports (created_at DESC, id)'
    );
    driver.exec(`CREATE TABLE IF NOT EXISTS cloud_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL CHECK (mode IN ('disabled', 'webdav', 's3')),
      device_id TEXT NOT NULL,
      connection_json TEXT,
      remote_manifest_json TEXT,
      last_sync_at INTEGER,
      last_success_at INTEGER,
      last_error_code TEXT,
      updated_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS cloud_sync_base (
      record_key TEXT PRIMARY KEY,
      base_updated_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS cloud_sync_outbox (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL CHECK (operation IN ('push-snapshot', 'key-rotation')),
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL CHECK (attempts >= 0),
      next_attempt_at INTEGER NOT NULL,
      last_error_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    driver.exec(`CREATE TABLE IF NOT EXISTS connector_accounts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('local-folder', 'email-imap', 'webdav', 's3', 'calendar-ics')),
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
      state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'error')),
      config_json TEXT NOT NULL,
      cursor_json TEXT NOT NULL,
      last_sync_at INTEGER,
      last_success_at INTEGER,
      last_error_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`);
    if (fromVersion === 10 || fromVersion === 11) {
      driver.exec(`CREATE TABLE connector_accounts_v12 (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('local-folder', 'email-imap', 'webdav', 's3', 'calendar-ics')),
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'error')),
        config_json TEXT NOT NULL,
        cursor_json TEXT NOT NULL,
        last_sync_at INTEGER,
        last_success_at INTEGER,
        last_error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`);
      driver.exec(`INSERT INTO connector_accounts_v12 (
        id, kind, display_name, state, config_json, cursor_json, last_sync_at,
        last_success_at, last_error_code, created_at, updated_at, deleted_at
      ) SELECT id, kind, display_name, state, config_json, cursor_json, last_sync_at,
        last_success_at, last_error_code, created_at, updated_at, deleted_at
      FROM connector_accounts`);
      driver.exec('DROP TABLE connector_accounts');
      driver.exec('ALTER TABLE connector_accounts_v12 RENAME TO connector_accounts');
    }
    driver.exec(
      'CREATE INDEX IF NOT EXISTS idx_connector_accounts_state ON connector_accounts (deleted_at, state, updated_at DESC, id)'
    );
    driver.exec(`CREATE TABLE IF NOT EXISTS connector_ingest_records (
      connector_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('importing', 'complete')),
      inbox_item_ids_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (connector_id, external_id)
    )`);
    driver.pragma(`user_version = ${PERSONAL_SCHEMA_VERSION}`);
  })();
}
