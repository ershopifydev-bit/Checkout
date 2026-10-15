import { describe, expect, it } from 'vitest';
import { readConfig } from '../../apps/api/src/config.js';

describe('API configuration', () => {
  it('defaults to a local listener and strips unrelated environment values', () => {
    expect(readConfig({ UNRELATED_SECRET: 'never-return-me' })).toEqual({
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it.each(['', '0', '-1', '65536', '1.5', 'Infinity', '3000abc', ' 3000'])(
    'rejects invalid port %j',
    (PORT) => {
      expect(() => readConfig({ PORT })).toThrow('Invalid API configuration');
    },
  );

  it('accepts a valid configured listener', () => {
    expect(readConfig({ HOST: '0.0.0.0', PORT: '8080', LOG_LEVEL: 'warn' }).PORT).toBe(8080);
  });

  it('reports invalid field names without echoing configuration values', () => {
    expect(() => readConfig({ HOST: 'private-value', LOG_LEVEL: 'private-value' })).toThrow(
      'Invalid API configuration: HOST, LOG_LEVEL',
    );
  });
});
