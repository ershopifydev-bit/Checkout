import { resolveTemplateId, type DashboardTemplateId } from './registry';

export const TEMPLATE_STORAGE_KEY = 'tezvix.dashboard.template.v1';

export function readTemplatePreference(storage: Pick<Storage, 'getItem'>): DashboardTemplateId {
  try {
    return resolveTemplateId(storage.getItem(TEMPLATE_STORAGE_KEY));
  } catch {
    return 'classic';
  }
}

export function saveTemplatePreference(
  storage: Pick<Storage, 'setItem'>,
  id: DashboardTemplateId,
): boolean {
  try {
    storage.setItem(TEMPLATE_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
