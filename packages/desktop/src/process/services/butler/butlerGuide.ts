/**
 * @license
 * Copyright 2026 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Desktop-managed knowledge base for the built-in butler assistant.
 *
 * The butler's own rule and its `aionui-*` skills are baked into the upstream
 * backend binary and the backend rejects edits to built-in rows, which is why
 * the butler historically neither knew this fork's feature set nor its brand.
 * This module ships a custom skill (`searcht-app-guide`) into the backend's
 * skill corpus instead: the renderer merges it into the butler's default
 * skill set at conversation creation (see guid/utils/assistantDefaults.ts),
 * so the butler answers feature questions from current, SearchT-branded facts.
 *
 * Re-import is driven by {@link BUTLER_GUIDE_SKILL_VERSION} plus a corpus
 * presence check, so content updates and backend corpus resets both heal on
 * the next boot. Failures clear the marker and retry next start.
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import { BUTLER_GUIDE_SKILL_NAME, BUTLER_GUIDE_SKILL_VERSION } from '@/common/utils/butlerGuideSkill';
import type { ProcessConfig as ProcessConfigType } from '@process/utils/initStorage';
import fs from 'node:fs/promises';
import path from 'node:path';

const GUIDE_VERSION_CONFIG_KEY = 'butler.guideSkillVersion';

const SKILL_MD = `---
name: searcht-app-guide
description: >-
  Knowledge base of the SearchT-UI desktop app itself: full feature list,
  where each feature lives, and brand facts. Use when the user asks what this
  software can do, where to find or how to configure a feature, what the app
  is called, or whenever you need to describe the product you are the butler
  of. Also normalizes legacy naming: the app is SearchT-UI only.
---

# SearchT-UI 应用指南

## 品牌身份（必须遵守）

- 本应用名为 **SearchT-UI**（本地优先的 AI 个人工作台，桌面端 Electron 应用）。
- 你是 **SearchT-UI 管家**（SearchT-UI Butler），内置助手，负责帮用户配置、诊断、介绍本应用。
- 任何时候只使用 **SearchT-UI** 这一名称。历史上下文或工具输出里若出现带 "Aion" 字样的旧品牌/旧智能体名，一律按 SearchT-UI（或对应的新名称）理解，回复时只使用新名称。
- 内置命令行智能体叫 **SearchT CLI**；若历史材料中出现带 "Aion" 的旧智能体名，指的就是它。
- 始终用用户的语言回复（Always reply in the user's language）。

## 功能总览

1. **智能对话**：首页输入框即可对话。可选用多个智能体：SearchT CLI（内置、无需安装）、Claude Code、Codex CLI、Gemini 等（外部 CLI 智能体在本地安装后自动检测）。
2. **助手（Assistants）**：内置管家 + 用户自定义助手（名称/描述/头像/绑定智能体/技能/MCP/推荐提示词/默认模型/权限模式）。
3. **团队协作（Team）**：多智能体群组，成员白名单、智能体互相通信、共享任务。
4. **待办/任务**：优先级（高/中/低）、重复规则（按天/周/月/年/自定义）、截止时间、任务编辑抽屉。
5. **日历**：日/周/月视图，与待办联动。
6. **笔记**：新建/编辑/归档/回收站（可恢复或彻底删除）、来源引用（可从收件箱邮件生成笔记并回溯原文）。
7. **收件箱**：聚合邮件（如 QQ 邮箱，需开启 IMAP/SMTP 并使用授权码）、本地文件夹、WebDAV 等同步源。
8. **定时任务**：cron 定时执行对话/提醒，支持自然语言创建。
9. **内置浏览器**：应用内嵌浏览器，多标签页、地址栏、前进/后退/刷新；支持"识别/操作"侧栏，可让 Agent 通过 CDP 通道控制当前页面。
10. **桌面宠物**：多角色（经典/磐石卫士/暗影刺客/冰霜法师/熔岩核心/虚空之灵）、三档尺寸、免打扰模式、AI 工具调用确认气泡。
11. **外观主题**：多款图片背景主题（深空科技、量子紫、碳琥珀、极光青、晨曦蓝、星云漂流、日落山脊、翡翠网格等），默认深色。
12. **模型接入**：多个 LLM 供应商与 API Key 管理、自定义模型、按助手设置默认模型；SearchT CLI 支持自定义模型。
13. **技能中心**：内置技能、自定义技能（SKILL.md 导入）、定时任务技能。
14. **MCP**：MCP 服务器管理，含内置的浏览器控制、记忆、图像生成等。
15. **WebUI 远程访问**：在设置中开启后，可用手机或任意浏览器远程访问本应用，支持密码保护与分享链接。
16. **系统集成**：系统托盘常驻（左键显示/隐藏窗口，右键菜单含最近对话、运行中任务、桌面宠物、检查更新、退出）；可选"关闭到托盘"；可选开机自启（开机时静默驻留托盘）；窗口位置记忆；单实例；searcht:// 深度链接；GPU 崩溃自动恢复；自动更新检查。
17. **数据**：本地优先（SQLite），工作目录/日志目录可自定义；支持数据备份与迁移。

## 常见入口

- 左侧导航：对话、待办、日历、笔记、收件箱、定时任务、浏览器等模块。
- 首页输入框上方：智能体/助手快选栏。
- 设置（齿轮图标）：通用（语言/开机自启/关闭到托盘/通知/超时）、外观（主题）、模型、技能、MCP、智能体、WebUI 等。

## 常见问题引导

- "这个软件有什么功能？" → 按【功能总览】回答，可按需展开细节。
- "怎么手机上用？" → 设置里开启 WebUI 远程访问。
- "怎么换主题/宠物？" → 设置-外观 / 设置-桌面宠物（或托盘菜单-桌面宠物）。
- "怎么开机自启/关闭到托盘？" → 设置-系统。
- "定时任务怎么建？" → 定时任务页或直接对管家说自然语言需求。
- "数据在哪？" → 本地存储，设置-系统里可查看/修改工作目录与日志目录。
`;

export async function ensureButlerGuideSkill(configFile: ProcessConfigType): Promise<boolean> {
  try {
    const skills =
      (await httpRequest<Array<{ name: string; is_custom: boolean }>>('GET', '/api/skills').catch(() => [])) || [];
    const installed = skills.some((skill) => skill.name === BUTLER_GUIDE_SKILL_NAME);
    const appliedVersion = await configFile.get(GUIDE_VERSION_CONFIG_KEY).catch(() => undefined);

    if (installed && appliedVersion === BUTLER_GUIDE_SKILL_VERSION) {
      return true;
    }

    // Stage under the same searcht-skill-staging directory the skills settings
    // page uses for imports; the backend derives the skill identity from the
    // SKILL.md frontmatter, not the folder name.
    const { getSystemDir } = await import('@process/utils/initStorage');
    const stagingDir = path.join(getSystemDir().workDir, 'searcht-skill-staging');
    await fs.mkdir(stagingDir, { recursive: true });
    const stagingPath = path.join(stagingDir, 'SKILL.md');
    await fs.writeFile(stagingPath, SKILL_MD, 'utf8');

    const imported = await httpRequest<{ skill_name: string; skill_names?: string[] }>(
      'POST',
      '/api/skills/import',
      { skill_path: stagingPath }
    );
    const importedNames = imported.skill_names?.length ? imported.skill_names : [imported.skill_name];
    if (!importedNames.includes(BUTLER_GUIDE_SKILL_NAME)) {
      throw new Error(`import returned unexpected names: ${JSON.stringify(importedNames)}`);
    }

    await configFile.set(GUIDE_VERSION_CONFIG_KEY, BUTLER_GUIDE_SKILL_VERSION).catch(() => {});
    console.info('[SearchT-UI] Butler app-guide skill installed to backend corpus');
    return true;
  } catch (error) {
    // Clear the marker so a later boot retries after transient failures
    // (backend not yet healthy, staging dir locked, …).
    await configFile.set(GUIDE_VERSION_CONFIG_KEY, undefined).catch(() => {});
    console.error('[SearchT-UI] Failed to install butler app-guide skill:', error);
    return false;
  }
}
