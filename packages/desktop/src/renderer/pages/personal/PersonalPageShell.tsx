import React from 'react';
import { Empty } from '@arco-design/web-react';

type PersonalPageShellProps = {
  title: string;
  description?: string;
  emptyDescription?: string;
  children?: React.ReactNode;
};

const PersonalPageShell: React.FC<PersonalPageShellProps> = ({ title, description, emptyDescription, children }) => (
  <main className='size-full overflow-y-auto bg-bg-1 text-t-primary'>
    <div className='box-border mx-auto w-full max-w-1120px px-24px py-22px md:px-32px md:py-28px'>
      <header className='mb-22px border-b border-border-2 pb-16px'>
        <h1 className='m-0 text-22px font-600 leading-30px'>{title}</h1>
        {description ? <p className='mb-0 mt-5px text-13px leading-20px text-t-secondary'>{description}</p> : null}
      </header>
      {children ?? <Empty className='py-64px' description={emptyDescription} />}
    </div>
  </main>
);

export default PersonalPageShell;
