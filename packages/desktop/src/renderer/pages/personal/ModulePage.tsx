import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PersonalModuleId } from '@/common/types/searcht/workspace';
import PersonalPageShell from './PersonalPageShell';

type ModulePageId = Exclude<PersonalModuleId, 'today' | 'workflows'>;

const COPY: Record<ModulePageId, { title: string; empty: string }> = {
  inbox: { title: '收件箱', empty: '没有等待整理的内容' },
  calendar: { title: '日程', empty: '暂无日程' },
  tasks: { title: '待办', empty: '暂无待办' },
  notes: { title: '笔记', empty: '还没有笔记' },
  knowledge: { title: '知识库', empty: '还没有已索引的知识' },
};

const ModulePage: React.FC<{ moduleId: ModulePageId }> = ({ moduleId }) => {
  const { t } = useTranslation();
  const copy = COPY[moduleId];
  return (
    <PersonalPageShell
      title={t(`personal.${moduleId}.title`, { defaultValue: copy.title })}
      emptyDescription={t(`personal.${moduleId}.empty`, { defaultValue: copy.empty })}
    />
  );
};

export default ModulePage;
