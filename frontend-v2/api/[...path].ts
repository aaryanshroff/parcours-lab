export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = `${process.env.HF_SPACE_URL}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.set('Authorization', `Bearer ${process.env.HF_TOKEN}`);

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
    duplex: 'half',
  };

  const upstream = await fetch(target, init);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
}
