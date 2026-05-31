# Venice Deno Proxy

Port dari `venice-cf-worker` ke **Deno Deploy**. Alasan pindah: Cloudflare
Workers semua egress dari pool IP yang sama → Venice nge-flag bot/fraud (kode
1015). Deno Deploy pakai range IP berbeda.

OpenAI-compatible proxy ke Venice AI dengan:

- Multi-API-key (auth client pakai key sendiri, bukan key Venice asli)
- Admin endpoint buat create/revoke/delete key
- Disable/enable model on-the-fly
- Usage counter per key

## Endpoint

Public (butuh client key via `Authorization: Bearer sk-venice-...`):

- `GET  /v1/models`
- `POST /v1/chat/completions`
- `/v1/*` (fallback, di-proxy mentah)

Admin (butuh `Authorization: Bearer $PROXY_ADMIN_TOKEN`):

- `POST /admin/keys/create`     `{"name":"..."}`
- `GET  /admin/keys`
- `POST /admin/keys/revoke`     `{"key":"sk-venice-..."}`
- `POST /admin/keys/delete`     `{"key":"sk-venice-..."}`
- `GET  /admin/models`
- `POST /admin/models/disable`  `{"model":"..."}`
- `POST /admin/models/enable`   `{"model":"..."}`

## Jalanin lokal

```bash
export VENICE_API_KEY="vn-..."
export PROXY_ADMIN_TOKEN="random-string-panjang"
deno task dev
# → http://localhost:8000
```

## Deploy ke Deno Deploy

### Opsi A — via deployctl (CLI)

```bash
deno install -gArf jsr:@deno/deployctl
deployctl deploy --project=venice-deno --prod main.ts
```

Set env var di dashboard Deno Deploy (https://dash.deno.com → project →
Settings → Environment Variables):

- `VENICE_API_KEY` — API key Venice asli
- `PROXY_ADMIN_TOKEN` — bebas, generate panjang random

### Opsi B — via GitHub

Push folder ini ke repo GitHub → di dashboard Deno Deploy: New Project → Link
GitHub repo → entrypoint `main.ts` → set env var di atas.

## Admin helper

```bash
export VENICE_DENO_URL="https://venice-deno.deno.dev"
export VENICE_DENO_ADMIN="<PROXY_ADMIN_TOKEN>"

./venice-deno-admin.sh health
./venice-deno-admin.sh create-key laptop
./venice-deno-admin.sh keys
./venice-deno-admin.sh models-ids
./venice-deno-admin.sh disable-model dolphin-2.9.3-mistral-7b
./venice-deno-admin.sh test sk-venice-xxx llama-3.3-70b "halo"
```

## Catatan

- Deno KV gratis di Deno Deploy (region replication otomatis).
- Kalau Deno Deploy nantinya juga kena IP fraud, alternatif: VPS 9router yang
  sudah ada di `198.105.113.190:20128`.
