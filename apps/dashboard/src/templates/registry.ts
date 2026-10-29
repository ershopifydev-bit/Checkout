import { classicTemplate } from './classic/template';
import { workspaceTemplate } from './workspace/template';

export const dashboardTemplates = [classicTemplate, workspaceTemplate] as const;
export type DashboardTemplateId = (typeof dashboardTemplates)[number]['id'];

export function resolveTemplateId(value: unknown): DashboardTemplateId {
  return dashboardTemplates.find((template) => template.id === value)?.id ?? 'classic';
}
