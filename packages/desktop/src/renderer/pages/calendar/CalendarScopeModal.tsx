import React from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CalendarScope } from '@/common/types/searcht/calendar';
type Props = { visible: boolean; onCancel(): void; onSelect(scope: CalendarScope): void };
const CalendarScopeModal: React.FC<Props> = ({ visible, onCancel, onSelect }) => {
  const { t } = useTranslation();
  return (
    <Modal title={t('personal.tasks.recurrence.editTitle')} visible={visible} footer={null} onCancel={onCancel}>
      <div className='flex flex-col gap-8px'>
        <Button onClick={() => onSelect('single')}>{t('personal.tasks.recurrence.single')}</Button>
        <Button type='primary' onClick={() => onSelect('this-and-future')}>
          {t('personal.tasks.recurrence.thisAndFuture')}
        </Button>
      </div>
    </Modal>
  );
};
export default CalendarScopeModal;
