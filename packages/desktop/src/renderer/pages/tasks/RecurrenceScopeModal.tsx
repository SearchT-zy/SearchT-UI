import React from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { TaskScope } from '@/common/types/searcht/tasks';

type Props = {
  visible: boolean;
  action: 'edit' | 'remove';
  onCancel: () => void;
  onSelect: (scope: TaskScope) => void;
};

const RecurrenceScopeModal: React.FC<Props> = ({ visible, action, onCancel, onSelect }) => {
  const { t } = useTranslation();
  return (
    <Modal
      visible={visible}
      title={t(action === 'edit' ? 'personal.tasks.recurrence.editTitle' : 'personal.tasks.recurrence.removeTitle')}
      footer={null}
      onCancel={onCancel}
    >
      <p className='mt-0 text-13px leading-20px text-t-secondary'>{t('personal.tasks.recurrence.scopeDescription')}</p>
      <div className='mt-18px flex flex-col gap-8px sm:flex-row sm:justify-end'>
        <Button onClick={() => onSelect('single')}>{t('personal.tasks.recurrence.single')}</Button>
        <Button
          type='primary'
          status={action === 'remove' ? 'danger' : undefined}
          onClick={() => onSelect('this-and-future')}
        >
          {t('personal.tasks.recurrence.thisAndFuture')}
        </Button>
      </div>
    </Modal>
  );
};

export default RecurrenceScopeModal;
