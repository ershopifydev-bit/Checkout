import { contractSchemas } from '@checkout/contracts';

export const openapiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Checkout foundation API',
    version: '0.1.0',
    description: 'Process health only. Merchant and checkout operations are not implemented.',
  },
  paths: {
    '/health/live': {
      get: {
        operationId: 'getLiveness',
        responses: {
          '200': {
            description: 'Process is alive.',
            content: { 'application/json': { schema: contractSchemas.HealthResponse } },
          },
        },
      },
    },
    '/health/ready': {
      get: {
        operationId: 'getReadiness',
        responses: {
          '200': {
            description: 'Foundation process is ready; no commerce dependencies are configured.',
            content: { 'application/json': { schema: contractSchemas.HealthResponse } },
          },
        },
      },
    },
  },
  components: { schemas: contractSchemas },
};
