import { describe, expect, it, vi } from 'vitest';
import {
  readTemplatePreference,
  saveTemplatePreference,
  TEMPLATE_STORAGE_KEY,
} from '../../apps/dashboard/src/templates/preferences';

describe('dashboard template preference', () => {
  it('defaults to Classic for first visits and obsolete template IDs', () => {
    expect(readTemplatePreference({ getItem: () => null })).toBe('classic');
    expect(readTemplatePreference({ getItem: () => 'removed-template' })).toBe('classic');
  });
  it('restores the saved template without changing merchant settings', () => {
    expect(readTemplatePreference({ getItem: () => 'workspace' })).toBe('workspace');
    const setItem = vi.fn();
    expect(saveTemplatePreference({ setItem }, 'workspace')).toBe(true);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(TEMPLATE_STORAGE_KEY, 'workspace');
  });
  it('allows the dashboard to work when browser storage is blocked', () => {
    expect(
      readTemplatePreference({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('classic');
    expect(
      saveTemplatePreference(
        {
          setItem: () => {
            throw new Error('full');
          },
        },
        'workspace',
      ),
    ).toBe(false);
  });
});
