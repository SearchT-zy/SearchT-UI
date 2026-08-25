import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import { loadWorkspacePreferences } from './workspacePreferencesClient';

const PersonalStartRedirect: React.FC = () => {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadWorkspacePreferences()
      .then((preferences) => {
        if (active) {
          setTarget(
            preferences.onboardingCompleted
              ? preferences.startPage === 'guid'
                ? '/guid'
                : `/${preferences.startPage}`
              : '/onboarding'
          );
        }
      })
      .catch(() => {
        if (active) setTarget('/today');
      });
    return () => {
      active = false;
    };
  }, []);

  return target ? <Navigate to={target} replace /> : <AppLoader />;
};

export default PersonalStartRedirect;
