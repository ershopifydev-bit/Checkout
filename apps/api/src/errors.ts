import type { ErrorResponse } from '@checkout/contracts';

const publicErrors: Record<number, ErrorResponse['error']> = {
  400: { code: 'INVALID_REQUEST', message: 'The request is invalid.' },
  401: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' },
  403: { code: 'FORBIDDEN', message: 'Access is denied.' },
  404: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
  409: { code: 'CONFLICT', message: 'The request conflicts with the current state.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'The content type is unsupported.' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests. Retry later.' },
  503: { code: 'NOT_READY', message: 'The service is not ready.' },
};

export function publicError(
  statusCode: number,
  correlationId: string,
): { statusCode: number; body: ErrorResponse } {
  const error = publicErrors[statusCode];
  return {
    statusCode: error ? statusCode : 500,
    body: {
      error: error ?? { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
      correlationId,
    },
  };
}
