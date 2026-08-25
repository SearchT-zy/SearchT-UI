import React from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { useTranslation } from 'react-i18next';

type Props = { disabled: boolean; loading: boolean; onConfirm: () => void };

const TrashActions: React.FC<Props> = ({ disabled, loading, onConfirm }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = React.useState(false);
  return (
    <>
      <Button
        status='danger'
        disabled={disabled}
        icon={<Delete theme='outline' size='16' />}
        onClick={() => setVisible(true)}
      >
        {t('personal.tasks.trash.emptyAction')}
      </Button>
      <Modal
        visible={visible}
        title={t('personal.tasks.trash.emptyTitle')}
        onCancel={() => setVisible(false)}
        onOk={() => {
          onConfirm();
          setVisible(false);
        }}
        okText={t('personal.tasks.trash.confirmEmpty')}
        cancelText={t('common.cancel')}
        okButtonProps={{ status: 'danger', loading }}
      >
        <p className='m-0 text-13px leading-20px text-t-secondary'>{t('personal.tasks.trash.emptyDescription')}</p>
      </Modal>
    </>
  );
};

export default TrashActions;
