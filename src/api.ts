let token = '';
export async function bootstrap() {
  const response = await fetch('/api/bootstrap');
  if (!response.ok) throw new Error('Cannot connect to the local server');
  token = (await response.json()).token;
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  if (!token) await bootstrap();
  const response = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Request failed');
  return result;
}
