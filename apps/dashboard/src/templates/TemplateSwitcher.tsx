import { dashboardTemplates, type DashboardTemplateId } from './registry';

export function TemplateSwitcher({
  selected,
  onSelect,
}: {
  selected: DashboardTemplateId;
  onSelect: (id: DashboardTemplateId) => void;
}) {
  return (
    <div className="template-toolbar">
      <div className="template-toolbar-label">
        <span className="template-toolbar-dot" />
        Dashboard style
      </div>
      <div className="template-switcher" role="group" aria-label="Dashboard style">
        {dashboardTemplates.map((template) => (
          <button
            type="button"
            key={template.id}
            aria-pressed={selected === template.id}
            title={template.description}
            onClick={() => onSelect(template.id)}
            data-template-option={template.id}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="2" y="3" width="16" height="14" rx="2" />
              {template.id === 'classic' ? <path d="M2 7h16" /> : <path d="M7 3v14" />}
            </svg>
            {template.label}
          </button>
        ))}
      </div>
    </div>
  );
}
