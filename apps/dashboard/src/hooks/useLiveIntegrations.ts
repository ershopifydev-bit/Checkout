import { useState, useEffect, useCallback } from 'react';

export interface IntegrationConfigRecord {
  name: string;
  connected: boolean;
  config: Record<string, string>;
  updatedAt?: string;
}

export function useLiveIntegrations() {
  const [integrations, setIntegrations] = useState<Record<string, IntegrationConfigRecord>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations', {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        setError(`Failed to load integrations (${res.status})`);
        return;
      }
      const json = await res.json();
      const map: Record<string, IntegrationConfigRecord> = {};
      if (Array.isArray(json.integrations)) {
        for (const item of json.integrations) {
          if (item.name) {
            map[item.name] = {
              name: item.name,
              connected: Boolean(item.connected),
              config: item.config || {},
              updatedAt: item.updatedAt,
            };
          }
        }
      }
      setIntegrations(map);
      setError('');
    } catch {
      setError('Integrations service offline');
    } finally {
      setLoading(false);
    }
  }, []);

  const saveIntegration = useCallback(
    async (name: string, config: Record<string, string>, connected = true) => {
      const res = await fetch(`/api/integrations/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          connected,
          config,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to save ${name} integration`);
      }

      setIntegrations((prev) => ({
        ...prev,
        [name]: {
          name,
          connected,
          config,
          updatedAt: new Date().toISOString(),
        },
      }));
    },
    [],
  );

  const disconnectIntegration = useCallback(async (name: string) => {
    const res = await fetch(`/api/integrations/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Failed to disconnect ${name}`);
    }

    setIntegrations((prev) => ({
      ...prev,
      [name]: {
        name,
        connected: false,
        config: {},
        updatedAt: new Date().toISOString(),
      },
    }));
  }, []);

  useEffect(() => {
    void fetchIntegrations();
  }, [fetchIntegrations]);

  return {
    integrations,
    loading,
    error,
    saveIntegration,
    disconnectIntegration,
    refresh: fetchIntegrations,
  };
}
