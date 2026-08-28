import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Checkbox, Empty, Message, Radio, Spin, Tag } from '@arco-design/web-react';
import { ArrowLeft, ArrowRight, Check, Robot } from '@icon-park/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  PERSONAL_MODULE_IDS,
  SEARCHT_CONNECTOR_INTERESTS,
  type PersonalModuleId,
  type PersonalScenePack,
  type WorkspacePreferences,
  type SearchtConnectorInterest,
  type SearchtModelBoundary,
} from '@/common/types/searcht/workspace';
import { useManagedAgents } from '@renderer/hooks/agent/useManagedAgents';
import {
  loadWorkspacePreferences,
  saveWorkspacePreferences,
} from '@renderer/pages/personal/workspacePreferencesClient';

type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5;

const MODULE_COPY: Record<PersonalModuleId, string> = {
  today: '今天',
  inbox: '收件箱',
  calendar: '日程',
  tasks: '待办',
  notes: '笔记',
  knowledge: '知识库',
  workflows: '工作流',
};

const SCENE_COPY: Record<PersonalScenePack, { label: string; description: string }> = {
  general: { label: '通用', description: '把每天的事情集中在一个清晰的工作台里。' },
  creator: { label: '创作者', description: '更适合写作、内容整理和灵感积累。' },
  manager: { label: '管理者', description: '更关注进度、日程和团队协作。' },
  researcher: { label: '研究者', description: '更适合资料收集、笔记和知识沉淀。' },
};

const BOUNDARY_COPY: Record<SearchtModelBoundary, { label: string; description: string }> = {
  'included-cloud': { label: '使用内置云额度', description: '开箱即用；内容会发送到云端模型处理。' },
  'own-key': { label: '使用自己的 API Key', description: '连接你自己的模型服务，额度与计费由服务商管理。' },
  'local-only': { label: '仅本地模型', description: '内容不出本机；需要本机已安装的模型服务。' },
  undecided: { label: '稍后决定', description: '先完成本机设置，之后在设置中再选择。' },
};

const CONNECTOR_COPY: Record<SearchtConnectorInterest, { label: string; description: string }> = {
  email: { label: '邮箱', description: 'QQ 邮箱 / 163 邮箱，新邮件自动进入收件箱。' },
  calendar: { label: '日历订阅', description: '飞书、Outlook、钉钉或企业微信日历只读同步。' },
  webdav: { label: '网盘（WebDAV）', description: '坚果云或 HTTPS WebDAV 目录只读接收。' },
  s3: { label: '对象存储（S3）', description: 'S3 兼容存储指定前缀下的文件只读接收。' },
  folder: { label: '本地文件夹', description: '监控本机文件夹中的新建和变更文件。' },
};

const PERMISSION_SUMMARY = [
  { title: '本地数据目录', detail: '所有日程、待办、笔记和知识库保存在本机独立目录，不注册账号。' },
  { title: '连接器只读', detail: '邮箱、网盘、对象存储和日历订阅均为只读接收，不会修改远程内容。' },
  { title: 'Agent 本地运行', detail: '本机 Agent 在你的电脑上执行任务；云模型仅在你明确选择时使用。' },
  { title: '权限审批', detail: '工作流与 Agent 的敏感操作需要你逐项授权，可随时撤销。' },
];

const STEP_COPY = [
  { title: '工作方式', description: '先选一个最接近你的工作场景，之后也可以随时修改。' },
  { title: '工作台', description: '选择打开应用时先看到的页面，以及你常用的模块。' },
  { title: '模型与隐私', description: '决定内容在哪里处理。选择云端意味着内容会离开本机，需要你的确认。' },
  { title: '连接服务', description: '选择你想连接的服务，稍后在设置中输入账号完成连接。' },
  { title: '权限确认', description: '了解SearchT的默认权限边界，然后开始使用。' },
  { title: '本机 Agent', description: 'SearchT会读取本机已安装的 Agent；检测失败不会影响使用。' },
];

const destinationFor = (startPage: WorkspacePreferences['startPage']) =>
  startPage === 'guid' ? '/guid' : `/${startPage}`;

const OnboardingPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, isLoading: agentsLoading, error: agentsError } = useManagedAgents();
  const [step, setStep] = useState<OnboardingStep>(0);
  const [preferences, setPreferences] = useState<WorkspacePreferences>(DEFAULT_WORKSPACE_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void loadWorkspacePreferences()
      .then((value) => {
        if (active) setPreferences(value);
      })
      .catch(() => {
        if (active) setPreferences(DEFAULT_WORKSPACE_PREFERENCES);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const installedAgents = useMemo(() => agents.filter((agent) => agent.installed && agent.enabled !== false), [agents]);
  const onlineAgents = useMemo(() => installedAgents.filter((agent) => agent.status === 'online'), [installedAgents]);

  const finish = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await saveWorkspacePreferences({
        ...preferences,
        onboardingCompleted: true,
        onboardingVersion: 2,
      });
      navigate(destinationFor(saved.startPage), { replace: true });
    } catch {
      Message.error(
        t('personal.onboarding.saveFailed', {
          defaultValue: '设置没有保存成功，请重试。',
        })
      );
    } finally {
      setSaving(false);
    }
  };

  const skip = (): void => {
    void finish();
  };

  const toggleModule = (moduleId: PersonalModuleId, checked: boolean) => {
    setPreferences((current) => ({
      ...current,
      visibleModules: { ...current.visibleModules, [moduleId]: checked },
    }));
  };

  const toggleConnectorInterest = (interest: SearchtConnectorInterest, checked: boolean) => {
    setPreferences((current) => ({
      ...current,
      connectorInterests: checked
        ? [...current.connectorInterests, interest]
        : current.connectorInterests.filter((value) => value !== interest),
    }));
  };

  if (loading) {
    return (
      <main className='size-full overflow-y-auto bg-bg-1'>
        <div className='flex min-h-full items-center justify-center'>
          <Spin />
        </div>
      </main>
    );
  }

  const currentStep = STEP_COPY[step];

  return (
    <main className='size-full overflow-y-auto bg-bg-1 text-t-primary'>
      <div className='box-border mx-auto flex min-h-full w-full max-w-960px flex-col px-20px py-28px md:px-48px md:py-48px'>
        <header className='mb-28px flex items-start justify-between gap-16px'>
          <div>
            <p className='mb-8px text-12px font-600 tracking-[0.08em] text-primary-6'>SearchT · SEARCHT</p>
            <h1 className='m-0 text-26px font-600 leading-34px'>
              {t('personal.onboarding.title', { defaultValue: '设置你的工作台' })}
            </h1>
            <p className='mb-0 mt-8px max-w-640px text-14px leading-22px text-t-secondary'>
              {t('personal.onboarding.description', {
                defaultValue: '用一分钟整理好你的工作方式，之后所有内容都会保存在本机。',
              })}
            </p>
          </div>
          <Button type='text' size='small' onClick={skip} disabled={saving}>
            {t('personal.onboarding.skip', { defaultValue: '跳过，稍后设置' })}
          </Button>
        </header>

        <div className='mb-26px flex items-center gap-8px' aria-label='设置进度'>
          {STEP_COPY.map((item, index) => (
            <React.Fragment key={item.title}>
              <div className='flex items-center gap-7px'>
                <span
                  className={`flex h-24px w-24px items-center justify-center rounded-999px text-12px font-600 ${
                    index <= step ? 'bg-primary-6 text-white' : 'bg-fill-2 text-t-tertiary'
                  }`}
                >
                  {index < step ? <Check theme='outline' size='13' /> : index + 1}
                </span>
                <span className={`hidden text-12px sm:inline ${index === step ? 'text-t-primary' : 'text-t-tertiary'}`}>
                  {item.title}
                </span>
              </div>
              {index < STEP_COPY.length - 1 ? <span className='h-1px min-w-24px flex-1 bg-border-2' /> : null}
            </React.Fragment>
          ))}
        </div>

        <Card className='flex-1 !rounded-12px !border-border-2 !bg-1' bordered>
          <div className='mb-22px'>
            <h2 className='m-0 text-18px font-600'>{currentStep.title}</h2>
            <p className='mb-0 mt-5px text-13px leading-20px text-t-secondary'>{currentStep.description}</p>
          </div>

          {step === 0 ? (
            <Radio.Group
              value={preferences.scenePack}
              onChange={(value) => setPreferences((current) => ({ ...current, scenePack: value as PersonalScenePack }))}
              className='grid grid-cols-1 gap-10px md:grid-cols-2'
            >
              {(Object.keys(SCENE_COPY) as PersonalScenePack[]).map((scene) => (
                <Radio key={scene} value={scene} className='!m-0'>
                  {({ checked }) => (
                    <div
                      className={`h-full rounded-8px border px-14px py-13px transition-colors ${checked ? 'border-primary-6 bg-primary-1' : 'border-border-2'}`}
                    >
                      <div className='text-14px font-600'>{SCENE_COPY[scene].label}</div>
                      <div className='mt-4px text-12px leading-18px text-t-secondary'>
                        {SCENE_COPY[scene].description}
                      </div>
                    </div>
                  )}
                </Radio>
              ))}
            </Radio.Group>
          ) : null}

          {step === 1 ? (
            <div className='flex flex-col gap-22px'>
              <div>
                <div className='mb-9px text-13px font-600'>
                  {t('personal.onboarding.startPage', { defaultValue: '打开应用时先看什么' })}
                </div>
                <Radio.Group
                  value={preferences.startPage}
                  onChange={(value) =>
                    setPreferences((current) => ({ ...current, startPage: value as WorkspacePreferences['startPage'] }))
                  }
                  className='flex flex-wrap gap-x-18px gap-y-10px'
                >
                  {PERSONAL_MODULE_IDS.map((moduleId) => (
                    <Radio key={moduleId} value={moduleId}>
                      {MODULE_COPY[moduleId]}
                    </Radio>
                  ))}
                  <Radio value='guid'>{t('personal.chat.title', { defaultValue: '聊天' })}</Radio>
                </Radio.Group>
              </div>
              <div>
                <div className='mb-9px text-13px font-600'>
                  {t('personal.onboarding.modules', { defaultValue: '保留哪些模块' })}
                </div>
                <div className='grid grid-cols-2 gap-y-10px md:grid-cols-3'>
                  {PERSONAL_MODULE_IDS.map((moduleId) => (
                    <Checkbox
                      key={moduleId}
                      checked={preferences.visibleModules[moduleId]}
                      onChange={(checked) => toggleModule(moduleId, checked)}
                    >
                      {MODULE_COPY[moduleId]}
                    </Checkbox>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className='flex flex-col gap-16px'>
              <Radio.Group
                value={preferences.modelBoundary}
                onChange={(value) =>
                  setPreferences((current) => ({
                    ...current,
                    modelBoundary: value as SearchtModelBoundary,
                    cloudConsentGranted: value === 'included-cloud' ? current.cloudConsentGranted : false,
                  }))
                }
                className='grid grid-cols-1 gap-10px md:grid-cols-2'
              >
                {(Object.keys(BOUNDARY_COPY) as SearchtModelBoundary[]).map((boundary) => (
                  <Radio key={boundary} value={boundary} className='!m-0'>
                    {({ checked }) => (
                      <div
                        className={`h-full rounded-8px border px-14px py-13px transition-colors ${checked ? 'border-primary-6 bg-primary-1' : 'border-border-2'}`}
                      >
                        <div className='text-14px font-600'>{BOUNDARY_COPY[boundary].label}</div>
                        <div className='mt-4px text-12px leading-18px text-t-secondary'>
                          {BOUNDARY_COPY[boundary].description}
                        </div>
                      </div>
                    )}
                  </Radio>
                ))}
              </Radio.Group>
              <Checkbox
                checked={preferences.cloudConsentGranted}
                disabled={preferences.modelBoundary !== 'included-cloud'}
                onChange={(checked) =>
                  setPreferences((current) => ({ ...current, cloudConsentGranted: Boolean(checked) }))
                }
              >
                我了解并同意：选择云端模型时，相关内容会加密传输到模型服务商处理。
              </Checkbox>
            </div>
          ) : null}

          {step === 3 ? (
            <div className='flex flex-col gap-16px'>
              <p className='m-0 text-13px text-t-secondary'>
                这里只记录你的意向，不会发起任何连接。完成后可在「设置 → 连接」中输入账号完成实际连接。
              </p>
              <div className='grid grid-cols-1 gap-10px md:grid-cols-2'>
                {SEARCHT_CONNECTOR_INTERESTS.map((interest) => {
                  const checked = preferences.connectorInterests.includes(interest);
                  return (
                    <button
                      key={interest}
                      type='button'
                      data-testid={`onboarding-connector-${interest}`}
                      className={`rounded-8px border px-14px py-13px text-left transition-colors ${
                        checked ? 'border-primary-6 bg-primary-1' : 'border-border-2'
                      }`}
                      onClick={() => toggleConnectorInterest(interest, !checked)}
                    >
                      <div className='flex items-center justify-between gap-8px'>
                        <span className='text-14px font-600'>{CONNECTOR_COPY[interest].label}</span>
                        {checked ? <Check theme='outline' size='14' className='text-primary-6' /> : null}
                      </div>
                      <div className='mt-4px text-12px leading-18px text-t-secondary'>
                        {CONNECTOR_COPY[interest].description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className='flex flex-col gap-14px'>
              {PERMISSION_SUMMARY.map((item) => (
                <div key={item.title} className='rounded-8px border border-border-2 px-14px py-12px'>
                  <div className='text-14px font-600'>{item.title}</div>
                  <div className='mt-3px text-12px leading-18px text-t-secondary'>{item.detail}</div>
                </div>
              ))}
              <Checkbox
                checked={preferences.permissionsReviewed}
                onChange={(checked) =>
                  setPreferences((current) => ({ ...current, permissionsReviewed: Boolean(checked) }))
                }
              >
                我已了解以上默认权限边界。
              </Checkbox>
            </div>
          ) : null}

          {step === 5 ? (
            <div className='flex flex-col gap-16px'>
              <div className='flex items-center gap-12px rounded-8px border border-border-2 bg-fill-1 px-14px py-13px'>
                <Robot theme='outline' size='22' className='text-primary-6' />
                <div className='min-w-0 flex-1'>
                  <div className='text-14px font-600'>本机 Agent 检测</div>
                  <div className='mt-3px text-12px text-t-secondary'>
                    检测只读取本机信息，不会自动安装、登录或连接外部服务。
                  </div>
                </div>
                {agentsLoading ? (
                  <Spin size={18} />
                ) : (
                  <Tag color={onlineAgents.length > 0 ? 'green' : 'gray'}>
                    {onlineAgents.length > 0 ? `${onlineAgents.length} 个可用` : '稍后配置'}
                  </Tag>
                )}
              </div>
              {agentsError ? (
                <div className='text-12px text-t-secondary'>暂时无法读取 Agent 状态，你可以在设置中重新检测。</div>
              ) : null}
              {!agentsLoading && installedAgents.length > 0 ? (
                <div className='grid grid-cols-1 gap-8px md:grid-cols-2'>
                  {installedAgents.slice(0, 6).map((agent) => (
                    <div
                      key={agent.id}
                      className='flex items-center gap-9px rounded-6px border border-border-1 px-11px py-9px'
                    >
                      <span
                        className='h-7px w-7px rounded-999px'
                        style={{ backgroundColor: agent.status === 'online' ? 'var(--success-6)' : 'var(--fill-4)' }}
                      />
                      <span className='min-w-0 flex-1 truncate text-13px'>{agent.name}</span>
                      <span className='text-11px text-t-tertiary'>{agent.status === 'online' ? '在线' : '待检查'}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {!agentsLoading && installedAgents.length === 0 && !agentsError ? (
                <Empty className='py-10px' description='暂未发现已安装的 Agent' />
              ) : null}
            </div>
          ) : null}
        </Card>

        <footer className='mt-20px flex items-center justify-between gap-12px'>
          <Button
            type='text'
            icon={<ArrowLeft />}
            disabled={step === 0 || saving}
            onClick={() => setStep((current) => (current - 1) as OnboardingStep)}
          >
            {t('personal.onboarding.back', { defaultValue: '上一步' })}
          </Button>
          {step < 5 ? (
            <Button
              type='primary'
              icon={<ArrowRight />}
              onClick={() => setStep((current) => (current + 1) as OnboardingStep)}
            >
              {t('personal.onboarding.next', { defaultValue: '下一步' })}
            </Button>
          ) : (
            <Button type='primary' loading={saving} icon={<Check />} onClick={() => void finish()}>
              {t('personal.onboarding.finish', { defaultValue: '开始使用' })}
            </Button>
          )}
        </footer>
      </div>
    </main>
  );
};

export default OnboardingPage;
