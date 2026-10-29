import { useEffect, useState } from 'react';
import { readTemplatePreference, saveTemplatePreference } from './preferences';
import type { DashboardTemplateId } from './registry';

export function useDashboardTemplate(active: boolean) {
  const [template, setTemplate] = useState<DashboardTemplateId>(() => {
    try {
      return readTemplatePreference(window.localStorage);
    } catch {
      return 'classic';
    }
  });

  useEffect(() => {
    document.documentElement.dataset['dashboardTemplate'] = active ? template : 'classic';
    return () => {
      delete document.documentElement.dataset['dashboardTemplate'];
    };
  }, [active, template]);

  function selectTemplate(id: DashboardTemplateId): boolean {
    setTemplate(id);
    try {
      return saveTemplatePreference(window.localStorage, id);
    } catch {
      return false;
    }
  }

  return { template, selectTemplate };
}
