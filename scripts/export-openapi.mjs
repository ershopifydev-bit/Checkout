import { writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { openapiDocument } from '../apps/api/dist/openapi.js';

const destination = new URL('../docs/api/openapi.json', import.meta.url);
const config = await resolveConfig(destination.pathname);
await writeFile(
  destination,
  await format(JSON.stringify(openapiDocument), { ...config, parser: 'json' }),
);
