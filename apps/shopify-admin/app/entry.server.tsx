import { PassThrough } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { ServerRouter } from 'react-router';
import type { EntryContext } from 'react-router';
import { createReadableStreamFromReadable } from '@react-router/node';
import { isbot } from 'isbot';
import { addDocumentResponseHeaders } from './shopify.server';

export const streamTimeout = 5000;
export function handleError() {
  console.error('Shopify app request failed.');
}
export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  context: EntryContext,
): Promise<Response> {
  addDocumentResponseHeaders(request, responseHeaders);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  const callback = isbot(request.headers.get('user-agent') ?? '') ? 'onAllReady' : 'onShellReady';
  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={context} url={request.url} />,
      {
        [callback]: () => {
          const body = new PassThrough();
          body.on('close', () => clearTimeout(timeout));
          responseHeaders.set('Content-Type', 'text/html');
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError: () => {
          clearTimeout(timeout);
          reject(new Error('Unable to render the application.'));
        },
        onError: () => {
          responseStatusCode = 500;
          handleError();
        },
      },
    );
    const timeout = setTimeout(abort, streamTimeout + 1000);
  });
}
