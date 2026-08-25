import React from 'react';
import { Tooltip } from '@arco-design/web-react';
import { BookOpen, Branch, Calendar, CheckOne, Dashboard, Earth, Inbox, Notes } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { PersonalModuleId, WorkspacePreferences } from '@/common/types/searcht/workspace';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

type SiderPersonalEntriesProps = {
  collapsed: boolean;
  isMobile: boolean;
  pathname: string;
  preferences: WorkspacePreferences;
  siderTooltipProps: SiderTooltipProps;
  onNavigate: (path: string) => void;
};

const MODULES: Record<
  PersonalModuleId,
  { defaultLabel: string; icon: React.ComponentType<{ theme: 'outline'; size: string; fill: string }> }
> = {
  workflows: { defaultLabel: 'Workflows', icon: Branch },
  today: { defaultLabel: '今日', icon: Dashboard },
  inbox: { defaultLabel: '收件箱', icon: Inbox },
  calendar: { defaultLabel: '日程', icon: Calendar },
  tasks: { defaultLabel: '待办', icon: CheckOne },
  notes: { defaultLabel: '笔记', icon: Notes },
  knowledge: { defaultLabel: '知识库', icon: BookOpen },
};

export const SiderPersonalEntries: React.FC<SiderPersonalEntriesProps> = ({
  collapsed,
  isMobile,
  pathname,
  preferences,
  siderTooltipProps,
  onNavigate,
}) => {
  const { t } = useTranslation();
  const moduleEntries = preferences.navigationOrder
    .filter((moduleId) => preferences.visibleModules[moduleId])
    .map((moduleId) => {
      const path = `/${moduleId}`;
      const label = t(`personal.${moduleId}.title`, { defaultValue: MODULES[moduleId].defaultLabel });
      const Icon = MODULES[moduleId].icon;
      return (
        <Tooltip key={moduleId} {...siderTooltipProps} content={label} position='right'>
          <a
            href={`#${path}`}
            aria-current={pathname === path ? 'page' : undefined}
            className={classNames(
              'box-border h-34px w-full flex items-center no-underline shrink-0 transition-colors rd-8px text-t-primary',
              collapsed ? 'justify-center' : 'justify-start gap-8px pl-10px pr-8px',
              isMobile && 'sider-action-btn-mobile',
              pathname === path ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
            )}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(path);
            }}
          >
            <span className='size-22px flex items-center justify-center shrink-0 text-t-primary'>
              <Icon theme='outline' size={collapsed ? '20' : '16'} fill='currentColor' />
            </span>
            {!collapsed ? <span className='text-14px font-500 leading-24px'>{label}</span> : null}
          </a>
        </Tooltip>
      );
    });

  // The embedded browser is a standalone capability, always available.
  const browserEntry = (
    <Tooltip
      key='browser'
      {...siderTooltipProps}
      content={t('personal.browser.title', { defaultValue: '浏览器' })}
      position='right'
    >
      <a
        href='#/browser'
        aria-current={pathname === '/browser' ? 'page' : undefined}
        className={classNames(
          'box-border h-34px w-full flex items-center no-underline shrink-0 transition-colors rd-8px text-t-primary',
          collapsed ? 'justify-center' : 'justify-start gap-8px pl-10px pr-8px',
          isMobile && 'sider-action-btn-mobile',
          pathname === '/browser' ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
        )}
        onClick={(event) => {
          event.preventDefault();
          onNavigate('/browser');
        }}
      >
        <span className='size-22px flex items-center justify-center shrink-0 text-t-primary'>
          <Earth theme='outline' size={collapsed ? '20' : '16'} fill='currentColor' />
        </span>
        {!collapsed ? (
          <span className='text-14px font-500 leading-24px'>
            {t('personal.browser.title', { defaultValue: '浏览器' })}
          </span>
        ) : null}
      </a>
    </Tooltip>
  );

  return [...moduleEntries, browserEntry];
};

export default SiderPersonalEntries;
