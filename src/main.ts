// Venice AI Proxy - Deno Deploy
// OpenAI-compatible endpoint dgn auth multi-key + admin API
// Port dari venice-cf-worker, KV diganti Deno KV

const VENICE_BASE = "https://api.venice.ai/api/v1";
const KEY_PREFIX = ["apikey"];
const MODEL_DISABLED_KEY = ["models", "disabled"];

const VENICE_API_KEY = Deno.env.get("VENICE_API_KEY") ?? "";
const ADMIN_TOKEN = Deno.env.get("PROXY_ADMIN_TOKEN") ?? "";

if (!VENICE_API_KEY) console.warn("[WARN] VENICE_API_KEY not set");
if (!ADMIN_TOKEN) console.warn("[WARN] PROXY_ADMIN_TOKEN not set");

const kv = await Deno.openKv();

// ---- helpers ----
function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extra,
    },
  });
}

function err(message: string, status = 400, code = "error") {
  return json({ error: { message, type: code, code: status } }, status);
}

function genKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return "sk-venice-" + hex;
}

function getClientKey(req: Request): string {
  const auth = req.headers.get("Authorization") || "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

interface KeyData {
  name: string;
  active: boolean;
  created: string;
  requests?: number;
  last_used?: string;
  revoked?: string;
}

async function checkClientKey(key: string): Promise<KeyData | null> {
  if (!key) return null;
  const res = await kv.get<KeyData>([...KEY_PREFIX, key]);
  if (!res.value) return null;
  if (!res.value.active) return null;
  return res.value;
}

function isAdmin(req: Request): boolean {
  const token = getClientKey(req);
  return !!token && token === ADMIN_TOKEN;
}

async function getDisabledModels(): Promise<string[]> {
  const res = await kv.get<string[]>(MODEL_DISABLED_KEY);
  return res.value ?? [];
}

async function setDisabledModels(list: string[]) {
  await kv.set(MODEL_DISABLED_KEY, list);
}

async function listAllKeys() {
  const result: Array<KeyData & { key: string }> = [];
  for await (const entry of kv.list<KeyData>({ prefix: KEY_PREFIX })) {
    result.push({ key: entry.key[1] as string, ...entry.value });
  }
  return result;
}

async function proxyVenice(path: string, req: Request, body?: string) {
  const url = VENICE_BASE + path;
  const init: RequestInit = {
    method: req.method,
    headers: {
      "Authorization": "Bearer " + VENICE_API_KEY,
      "Content-Type": req.headers.get("Content-Type") || "application/json",
    },
  };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = body !== undefined ? body : await req.text();
  }
  const upstream = await fetch(url, init);
  const headers = new Headers(upstream.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(upstream.body, { status: upstream.status, headers });
}

// ---- public handlers ----
async function handleChatCompletions(req: Request) {
  const clientKey = getClientKey(req);
  const keyData = await checkClientKey(clientKey);
  if (!keyData) return err("Invalid or revoked API key", 401, "invalid_api_key");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", 400);
  }

  const disabled = await getDisabledModels();
  if (body.model && disabled.includes(body.model as string)) {
    return err(`Model '${body.model}' is disabled by admin`, 403, "model_disabled");
  }

  const updated: KeyData = {
    ...keyData,
    last_used: new Date().toISOString(),
    requests: (keyData.requests || 0) + 1,
  };
  kv.set([...KEY_PREFIX, clientKey], updated).catch(() => {});

  return proxyVenice("/chat/completions", req, JSON.stringify(body));
}

async function handleListModels(req: Request) {
  const clientKey = getClientKey(req);
  const keyData = await checkClientKey(clientKey);
  if (!keyData) return err("Invalid or revoked API key", 401, "invalid_api_key");

  try {
    const upstream = await fetch(VENICE_BASE + "/models", {
      headers: { "Authorization": "Bearer " + VENICE_API_KEY },
    });
    if (!upstream.ok) return err(`Venice upstream returned ${upstream.status}`, upstream.status);
    const text = await upstream.text();
    let data: { data?: Array<{ id: string }> };
    try {
      data = JSON.parse(text);
    } catch {
      return err("Venice returned non-JSON: " + text.slice(0, 200), 502);
    }
    const disabled = await getDisabledModels();
    if (data && Array.isArray(data.data)) {
      data.data = data.data.filter((m) => !disabled.includes(m.id));
    }
    return json(data);
  } catch (e) {
    return err("handleListModels failed: " + (e instanceof Error ? e.message : String(e)), 500);
  }
}

// ---- admin handlers ----
async function adminCreateKey(req: Request) {
  let body: { name?: string } = {};
  try {
    body = await req.json();
  } catch { /* empty body ok */ }
  const key = genKey();
  const data: KeyData = {
    name: body.name || "unnamed",
    active: true,
    created: new Date().toISOString(),
    requests: 0,
  };
  await kv.set([...KEY_PREFIX, key], data);
  return json({ key, ...data });
}

async function adminListKeys() {
  const keys = await listAllKeys();
  return json({ keys });
}

async function adminRevokeKey(req: Request) {
  const body = await req.json().catch(() => ({} as { key?: string }));
  if (!body.key) return err('Missing "key" field', 400);
  const res = await kv.get<KeyData>([...KEY_PREFIX, body.key]);
  if (!res.value) return err("Key not found", 404);
  const data: KeyData = { ...res.value, active: false, revoked: new Date().toISOString() };
  await kv.set([...KEY_PREFIX, body.key], data);
  return json({ ok: true, key: body.key, active: false });
}

async function adminDeleteKey(req: Request) {
  const body = await req.json().catch(() => ({} as { key?: string }));
  if (!body.key) return err('Missing "key" field', 400);
  await kv.delete([...KEY_PREFIX, body.key]);
  return json({ ok: true, deleted: body.key });
}

async function adminListModels() {
  const upstream = await fetch(VENICE_BASE + "/models", {
    headers: { "Authorization": "Bearer " + VENICE_API_KEY },
  });
  const data = await upstream.json();
  const disabled = await getDisabledModels();
  const all = (data.data || []).map((m: { id: string }) => ({
    id: m.id,
    disabled: disabled.includes(m.id),
  }));
  return json({ models: all, disabled });
}

async function adminDisableModel(req: Request) {
  const body = await req.json().catch(() => ({} as { model?: string }));
  if (!body.model) return err('Missing "model" field', 400);
  const disabled = await getDisabledModels();
  if (!disabled.includes(body.model)) disabled.push(body.model);
  await setDisabledModels(disabled);
  return json({ ok: true, disabled });
}

async function adminEnableModel(req: Request) {
  const body = await req.json().catch(() => ({} as { model?: string }));
  if (!body.model) return err('Missing "model" field', 400);
  const disabled = (await getDisabledModels()).filter((m) => m !== body.model);
  await setDisabledModels(disabled);
  return json({ ok: true, disabled });
}

// ---- router ----
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const p = url.pathname;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (p === "/" || p === "/health") {
    return json({
      ok: true,
      service: "venice-deno",
      endpoints: [
        "GET  /v1/models",
        "POST /v1/chat/completions",
        "POST /admin/keys/create   (admin)",
        "GET  /admin/keys           (admin)",
        "POST /admin/keys/revoke   (admin)",
        "POST /admin/keys/delete   (admin)",
        "GET  /admin/models         (admin)",
        "POST /admin/models/disable (admin)",
        "POST /admin/models/enable  (admin)",
      ],
    });
  }

  if (p === "/v1/chat/completions" && req.method === "POST") return handleChatCompletions(req);
  if (p === "/v1/models" && req.method === "GET") return handleListModels(req);

  if (p.startsWith("/admin/")) {
    if (!isAdmin(req)) return err("Admin token required", 401);
    if (p === "/admin/keys/create" && req.method === "POST") return adminCreateKey(req);
    if (p === "/admin/keys" && req.method === "GET") return adminListKeys();
    if (p === "/admin/keys/revoke" && req.method === "POST") return adminRevokeKey(req);
    if (p === "/admin/keys/delete" && req.method === "POST") return adminDeleteKey(req);
    if (p === "/admin/models" && req.method === "GET") return adminListModels();
    if (p === "/admin/models/disable" && req.method === "POST") return adminDisableModel(req);
    if (p === "/admin/models/enable" && req.method === "POST") return adminEnableModel(req);
  }

  if (p.startsWith("/v1/")) {
    const keyData = await checkClientKey(getClientKey(req));
    if (!keyData) return err("Invalid or revoked API key", 401, "invalid_api_key");
    return proxyVenice(p.replace(/^\/v1/, ""), req);
  }

  return err("Not found", 404);
});
