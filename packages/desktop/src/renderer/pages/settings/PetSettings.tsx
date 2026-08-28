/**
 * @license
 * Copyright 2025 SearchT Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Radio, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { systemSettings } from '@/common/adapter/ipcBridge';
import { configService } from '@/common/config/configService';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { PET_CHARACTERS } from '@process/pet/petTypes';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import PreferenceRow from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/PreferenceRow';
import SearchtScrollArea from '@/renderer/components/base/SearchtScrollArea';
import { useSettingsViewMode } from '@/renderer/components/settings/SettingsModal/settingsViewContext';

const PetSettings: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [enabledResolved, setEnabledResolved] = useState(false);
  const [size, setSize] = useState(280);
  const [dnd, setDnd] = useState(false);
  const [confirmEnabled, setConfirmEnabled] = useState(true);
  const [character, setCharacter] = useState('classic');
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const isDesktop = isElectronDesktop();

  useEffect(() => {
    let active = true;
    setSize(configService.get('pet.size') ?? 280);
    setDnd(configService.get('pet.dnd') ?? false);
    setConfirmEnabled(configService.get('pet.confirmEnabled') ?? true);
    systemSettings.getPetEnabled
      .invoke()
      .then((value) => {
        if (!active) return;
        setEnabled(value);
        setEnabledResolved(true);
      })
      .catch(() => {
        // IPC failure: fall back to the locked default (OFF); never fall back to ON,
        // which would reintroduce the "UI lies" state this fix eliminates.
        if (!active) return;
        setEnabled(false);
        setEnabledResolved(true);
      });
    systemSettings.getPetCharacter
      .invoke()
      .then((value) => {
        if (active) setCharacter(value);
      })
      .catch((): undefined => undefined);
    return () => {
      active = false;
    };
  }, []);

  const handleCharacterChange = useCallback((id: string): void => {
    const prev = character;
    setCharacter(id);
    configService.setLocal('pet.character', id);
    systemSettings.setPetCharacter.invoke({ character: id }).catch((): void => {
      setCharacter(prev);
      configService.setLocal('pet.character', prev);
    });
  }, [character]);

  const handleEnabledChange = useCallback((checked: boolean) => {
    setEnabled(checked);
    configService.setLocal('pet.enabled', checked);
    systemSettings.setPetEnabled.invoke({ enabled: checked }).catch(() => {
      setEnabled(!checked);
      configService.setLocal('pet.enabled', !checked);
    });
  }, []);

  const handleSizeChange = useCallback(
    (val: number) => {
      const prevSize = size;
      setSize(val);
      configService.setLocal('pet.size', val);
      systemSettings.setPetSize.invoke({ size: val }).catch(() => {
        setSize(prevSize);
        configService.setLocal('pet.size', prevSize);
      });
    },
    [size]
  );

  const handleDndChange = useCallback((checked: boolean) => {
    setDnd(checked);
    configService.setLocal('pet.dnd', checked);
    systemSettings.setPetDnd.invoke({ dnd: checked }).catch(() => {
      setDnd(!checked);
      configService.setLocal('pet.dnd', !checked);
    });
  }, []);

  const handleConfirmEnabledChange = useCallback((checked: boolean) => {
    setConfirmEnabled(checked);
    configService.setLocal('pet.confirmEnabled', checked);
    systemSettings.setPetConfirmEnabled.invoke({ enabled: checked }).catch(() => {
      setConfirmEnabled(!checked);
      configService.setLocal('pet.confirmEnabled', !checked);
    });
  }, []);

  if (!isDesktop) {
    return (
      <SettingsPageWrapper>
        <SearchtScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
          <div className='space-y-16px'>
            <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'>
              <p className='m-0 text-13px text-t-secondary'>{t('pet.desktopOnly')}</p>
            </div>
          </div>
        </SearchtScrollArea>
      </SettingsPageWrapper>
    );
  }

  const preferenceItems = [
    {
      key: 'enabled',
      label: t('pet.enable'),
      component: (
        <Switch
          checked={enabled}
          loading={!enabledResolved}
          disabled={!enabledResolved}
          onChange={handleEnabledChange}
        />
      ),
    },
    {
      key: 'character',
      label: t('pet.character', { defaultValue: '角色' }),
      component: (
        <div className='flex flex-wrap gap-8px'>
          {PET_CHARACTERS.map((c) => (
            <button
              key={c.id}
              type='button'
              aria-label={c.name}
              onClick={() => handleCharacterChange(c.id)}
              className={`flex cursor-pointer items-center gap-6px border border-solid px-10px py-4px rd-8px text-12px transition-colors ${
                character === c.id ? 'border-primary-6 bg-fill-2 text-t-primary' : 'border-border-2 text-t-secondary hover:border-primary-5'
              }`}
            >
              <span
                aria-hidden='true'
                className='inline-block size-12px rd-full'
                style={{ background: `linear-gradient(135deg, ${c.swatch[0]} 50%, ${c.swatch[1]} 50%)` }}
              />
              {c.name}
            </button>
          ))}
        </div>
      ),
    },
    {
      key: 'size',
      label: t('pet.size'),
      component: (
        <Radio.Group value={size} onChange={handleSizeChange} disabled={!enabled}>
          <Radio value={200}>{t('pet.sizeSmall', { px: 200 })}</Radio>
          <Radio value={280}>{t('pet.sizeMedium', { px: 280 })}</Radio>
          <Radio value={360}>{t('pet.sizeLarge', { px: 360 })}</Radio>
        </Radio.Group>
      ),
    },
    {
      key: 'dnd',
      label: t('pet.dnd'),
      description: t('pet.dndDescription'),
      component: <Switch checked={dnd} onChange={handleDndChange} disabled={!enabled} />,
    },
    {
      key: 'confirmBubble',
      label: t('pet.confirmBubble'),
      description: t('pet.confirmBubbleDescription'),
      component: <Switch checked={confirmEnabled} onChange={handleConfirmEnabledChange} disabled={!enabled} />,
    },
  ];

  return (
    <SettingsPageWrapper>
      <SearchtScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px space-y-12px'>
            <div className='w-full flex flex-col divide-y divide-border-2'>
              {preferenceItems.map((item) => (
                <PreferenceRow key={item.key} label={item.label} description={item.description}>
                  {item.component}
                </PreferenceRow>
              ))}
            </div>
          </div>
        </div>
      </SearchtScrollArea>
    </SettingsPageWrapper>
  );
};

export default PetSettings;
