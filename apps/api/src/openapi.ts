import { contractSchemas } from '@checkout/contracts';

export const openapiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Checkout API',
    version: '0.1.0',
    description:
      'Foundation health plus fixture demo routes for standalone COD checkout. Live Shopify order sync is not implemented.',
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
    '/v1/demo/checkout': {
      get: {
        operationId: 'getDemoCheckout',
        summary: 'Create a fixture COD checkout session',
        responses: {
          '200': {
            description: 'Fixture session with demo line items.',
            content: { 'application/json': { schema: contractSchemas.DemoCheckoutSession } },
          },
        },
      },
    },
    '/v1/demo/cod-orders': {
      post: {
        operationId: 'placeDemoCodOrder',
        summary: 'Accept a demo COD order (no Shopify write)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: contractSchemas.PlaceCodOrderRequest } },
        },
        responses: {
          '200': {
            description: 'Demo order accepted locally.',
            content: { 'application/json': { schema: contractSchemas.PlaceCodOrderResponse } },
          },
        },
      },
    },
  },
  components: { schemas: contractSchemas },
};
