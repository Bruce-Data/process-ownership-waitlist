/**
 * Process Ownership waitlist API
 * POST /signup  { email, turnstileToken?, source? }
 * OPTIONS /*   CORS preflight
 *
 * Env: DB (D1), TURNSTILE_SECRET_KEY (secret), ALLOWED_ORIGINS (var)
 */

export interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  ALLOWED_ORIGINS: string;
}

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (allowed.length === 0) {
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
  allowed: string[]
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin, allowed),
    },
  });
}

async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string | null
): Promise<boolean> {
  if (!secret) {
    // Dev / misconfig: reject if secret missing in production paths
    console.error('TURNSTILE_SECRET_KEY is not set');
    return false;
  }
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const res = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body: form }
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, allowed),
      });
    }

    if (request.method === 'GET' && url.pathname === '/') {
      return json(
        {
          ok: true,
          service: 'process-ownership-waitlist-api',
          endpoints: ['POST /signup'],
        },
        200,
        origin,
        allowed
      );
    }

    if (request.method !== 'POST' || url.pathname !== '/signup') {
      return json({ ok: false, error: 'Not found' }, 404, origin, allowed);
    }

    // CORS: if allowlist is set and origin is not in it, reject
    if (allowed.length > 0 && origin && !allowed.includes(origin)) {
      return json({ ok: false, error: 'Origin not allowed' }, 403, origin, allowed);
    }

    let payload: {
      email?: string;
      turnstileToken?: string;
      source?: string;
    };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return json({ ok: false, error: 'Invalid JSON body' }, 400, origin, allowed);
    }

    const email = (payload.email ?? '').trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      return json(
        { ok: false, error: 'Please enter a valid work email.' },
        400,
        origin,
        allowed
      );
    }

    const token = (payload.turnstileToken ?? '').trim();
    if (!token) {
      return json(
        { ok: false, error: 'Please complete the bot check.' },
        400,
        origin,
        allowed
      );
    }

    const ip =
      request.headers.get('CF-Connecting-IP') ??
      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
      null;

    const turnstileOk = await verifyTurnstile(
      token,
      env.TURNSTILE_SECRET_KEY,
      ip
    );
    if (!turnstileOk) {
      return json(
        { ok: false, error: 'Bot check failed. Please try again.' },
        403,
        origin,
        allowed
      );
    }

    const source =
      typeof payload.source === 'string'
        ? payload.source.slice(0, 64)
        : 'landing';
    const userAgent = (request.headers.get('User-Agent') ?? '').slice(0, 512);

    try {
      await env.DB.prepare(
        `INSERT INTO waitlist (email, source, user_agent) VALUES (?, ?, ?)`
      )
        .bind(email, source, userAgent)
        .run();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // D1 unique constraint
      if (
        message.includes('UNIQUE') ||
        message.includes('unique') ||
        message.includes('constraint')
      ) {
        // Idempotent success — already on the list
        return json(
          { ok: true, alreadyJoined: true, message: 'You are already on the waitlist.' },
          200,
          origin,
          allowed
        );
      }
      console.error('D1 insert failed', message);
      return json(
        { ok: false, error: 'Could not save signup. Please try again.' },
        500,
        origin,
        allowed
      );
    }

    return json(
      {
        ok: true,
        alreadyJoined: false,
        message: 'You are on the waitlist. We will reach out when the pilot opens.',
      },
      201,
      origin,
      allowed
    );
  },
};
