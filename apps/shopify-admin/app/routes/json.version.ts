/** Shopify CLI / tooling probes this path; keep it quiet. */
export async function loader() {
  return Response.json({ status: 'ok' });
}
