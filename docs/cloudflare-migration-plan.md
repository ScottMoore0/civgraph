# Cloudflare Migration Plan

Migrate the Boundaries Website from Neocities to Cloudflare Pages + Workers.

**Current state:** Static site on Neocities, deployed via GitHub Actions custom curl workflow.
**Target state:** Cloudflare Pages (static hosting) + Workers ($5/month paid tier) + R2 (object storage), served from `civgraph.net` with `boundaries.scottmoore.xyz` as a 301 redirect.

---

## Prerequisites

- [x] Cloudflare account created
- [x] Domain `civgraph.net` purchased (Namecheap)
- [ ] Cloudflare Workers Paid plan activated ($5/month)
- [ ] Namecheap DNS pointed to Cloudflare (change nameservers)
- [ ] `boundaries.scottmoore.xyz` added to Cloudflare (for redirect)

### DNS setup (do this first)

1. Log into Cloudflare, add `civgraph.net` as a site
2. Cloudflare will provide two nameservers (e.g., `ada.ns.cloudflare.com`, `bob.ns.cloudflare.com`)
3. Log into Namecheap, go to Domain List > civgraph.net > Nameservers > Custom DNS
4. Replace Namecheap's default nameservers with the two Cloudflare nameservers
5. Wait for propagation (usually 5-30 minutes, can take up to 24 hours)
6. Cloudflare dashboard will show the domain as "Active" once propagation completes

---

## Phase 1: Static hosting on Cloudflare Pages

**Goal:** Site running on Cloudflare CDN, auto-deploying from GitHub.
**Risk:** Low. The existing Neocities site remains live until DNS is switched.
**Rollback:** Point DNS back to Neocities.

### Step 1.1: Connect GitHub repo to Cloudflare Pages

1. Cloudflare Dashboard > Pages > Create a project > Connect to Git
2. Select the `ScottMoore0/civgraph` repository
3. Configure build settings:
   - **Production branch:** `main`
   - **Build command:** `npm install --ignore-scripts && npm run build && python3 scripts/gzip_fgb_files.py && python3 scripts/restructure_election_bundles.py`
   - **Build output directory:** `/` (the entire repo is the site root)
   - **Environment variables:**
     - `NODE_VERSION` = `20`
     - `PYTHON_VERSION` = `3.12`
4. Deploy — Cloudflare builds and hosts the site at `civgraph.pages.dev`

### Step 1.2: Verify on pages.dev

Before touching DNS, verify everything works on the `.pages.dev` URL:

- [ ] Map loads and tiles render
- [ ] Election cards appear, clicking one loads results
- [ ] Search works (type "Belfast", results appear)
- [ ] Fonts render correctly (Inter, Plus Jakarta Sans)
- [ ] Dark mode toggle works
- [ ] Mobile layout works
- [ ] FGB files load (check Network tab for 200 responses on `.fgb` / `.fgb.gz`)
- [ ] About page loads with correct styling

### Step 1.3: Add custom domain

1. Cloudflare Pages > your project > Custom domains > Add domain
2. Enter `civgraph.net`
3. Cloudflare auto-creates the DNS CNAME record
4. SSL certificate provisions automatically (takes ~2-5 minutes)
5. Also add `www.civgraph.net` and configure as redirect to `civgraph.net`

### Step 1.4: Set up redirect from old domain

1. Add `boundaries.scottmoore.xyz` to Cloudflare (change its DNS to Cloudflare nameservers in the existing DNS provider)
2. Cloudflare Dashboard > Rules > Redirect Rules > Create rule:
   - **When:** Hostname equals `boundaries.scottmoore.xyz`
   - **Then:** Dynamic redirect to `https://civgraph.net${http.request.uri.path}` with status 301
   - This preserves URL paths — e.g., `boundaries.scottmoore.xyz/#election=...` redirects to `civgraph.net/#election=...`
3. Alternatively, create a simple Worker:
   ```js
   export default {
     fetch(request) {
       const url = new URL(request.url);
       url.hostname = 'civgraph.net';
       return Response.redirect(url.toString(), 301);
     }
   };
   ```

### Step 1.5: Update site references

After DNS is live on `civgraph.net`:

- Update `index.html` OG URL: `https://boundaries.scottmoore.xyz` → `https://civgraph.net`
- Update `index.html` OG image URL
- Update `pages/about.html` if it references the old domain
- Update `README.md` live site link

### Step 1.6: Remove Neocities deploy workflow

- Delete `.github/workflows/deploy.yml`
- Cloudflare Pages auto-deploys on every push to `main` — no custom workflow needed
- Remove `NEOCITIES_API_TOKEN` from GitHub repo secrets

### Step 1.7: Remove service worker

Cloudflare's CDN + cache headers (Phase 2) replace the service worker entirely.

- Delete `sw.js`
- Simplify `registerServiceWorker()` in `js/app.js` to only unregister stale workers:
  ```js
  registerServiceWorker() {
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.getRegistrations().then(regs => {
          for (const reg of regs) reg.unregister();
      });
  }
  ```
- This ensures returning users who have the old SW cached get it cleaned up

---

## Phase 2: Cache headers

**Goal:** Proper HTTP caching for all asset types. Eliminates unnecessary revalidation requests.
**Risk:** None. Purely additive configuration.
**Rollback:** Delete the `_headers` file.

Create `_headers` in the repo root:

```
# HTML — always revalidate (ensures users get latest version)
/index.html
  Cache-Control: public, max-age=0, must-revalidate

/pages/*
  Cache-Control: public, max-age=0, must-revalidate

# JS/CSS bundles — fingerprinted filenames, cache forever
/build/*
  Cache-Control: public, max-age=31536000, immutable

# Fonts — never change, cache forever
/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable

# Leaflet CSS + images — versioned in filename, cache forever
/assets/css/leaflet-*
  Cache-Control: public, max-age=31536000, immutable

/assets/css/images/*
  Cache-Control: public, max-age=31536000, immutable

# Map data (FGB files) — immutable once deployed
/data/maps/*
  Cache-Control: public, max-age=31536000, immutable

# Spatial index chunks — cache for 1 week (regenerated on data changes)
/data/database/spatial-index/*
  Cache-Control: public, max-age=604800

# Maps database — short cache, revalidate in background
/data/database/maps.json
  Cache-Control: public, max-age=300, stale-while-revalidate=86400

# Spatial index monolithic — fallback file, cache for 1 day
/data/database/spatial-index.json
  Cache-Control: public, max-age=86400

# Election data — rarely changes
/election-viewer-package/data/*
  Cache-Control: public, max-age=604800
```

### Impact

| Asset type | Neocities (current) | Cloudflare (after) |
|---|---|---|
| FGB map data | ETag revalidation every visit | Cached for 1 year, zero requests |
| Fonts | ETag revalidation | Cached for 1 year |
| JS/CSS bundles | ETag revalidation | Cached for 1 year (fingerprinted) |
| HTML | No cache header | Always fresh (must-revalidate) |
| maps.json | ETag revalidation | Fresh within 5 min, background revalidation |

This alone eliminates the mobile crash issue — the browser's native HTTP cache handles eviction correctly (unlike the unbounded service worker cache).

---

## Phase 3: Cloudflare Worker for edge spatial queries

**Goal:** Replace client-side spatial index loading with server-side queries at the edge. Eliminates all spatial index memory usage on the client.
**Risk:** Low-medium. New server-side code. Client code has fallback to chunked mode.
**Rollback:** Revert client code to chunked index mode (set `useChunkedIndex` flag).

### Step 3.1: Create Worker project

```bash
npm create cloudflare@latest -- boundaries-api
cd boundaries-api
```

### Step 3.2: Upload spatial index to KV

Cloudflare KV (key-value store) is included in the $5/month plan.

```bash
# Create KV namespace
wrangler kv namespace create SPATIAL_INDEX

# Upload the names index for search
wrangler kv key put --binding SPATIAL_INDEX "names" --path ../data/database/spatial-index/_names.json

# Upload per-map chunks for spatial queries
for f in ../data/database/spatial-index/*.json; do
  mapId=$(basename "$f" .json)
  [ "$mapId" = "_manifest" ] || [ "$mapId" = "_names" ] && continue
  wrangler kv key put --binding SPATIAL_INDEX "map:$mapId" --path "$f"
done
```

### Step 3.3: Implement Worker

Two endpoints:

**`GET /_api/spatial?mapId=lgd-2012&bbox=minLng,minLat,maxLng,maxLat`**
- Reads the map chunk from KV
- Filters features by bounding box intersection
- Returns matching features as JSON array
- Typical response: 5-50 features, ~2-10 KB

**`GET /_api/search?q=Belfast&limit=25`**
- Reads the names index from KV
- Filters by case-insensitive substring match
- Returns matching features sorted by relevance
- Typical response: 5-25 results, ~1-3 KB

### Step 3.4: Wire into Pages

Use Cloudflare Pages Functions (built-in Workers integration):

Create `functions/_api/spatial.js` and `functions/_api/search.js` in the repo. Pages automatically routes `/_api/*` requests to these functions.

Alternatively, use `_routes.json` to route API paths to a standalone Worker.

### Step 3.5: Update client code

In `feature-loader.js`:
- `loadMapIndex(mapId)` → `fetch('/_api/spatial?mapId=${mapId}')`
- `searchFeaturesByName(query)` → `fetch('/_api/search?q=${query}')`
- Remove chunk fetching, manifest loading, `_ensureFullIndex()`
- Keep `useChunkedIndex` flag as fallback (reads local chunk files if Worker is unavailable)

### Impact

| Metric | Before (chunked) | After (Worker) |
|---|---|---|
| Client spatial index memory | 50-200 KB per map + 2.9 MB for search | 0 bytes |
| Network for map load | Fetch chunk file (~50-200 KB) | Fetch query result (~2-10 KB) |
| Network for search | Fetch names index (2.9 MB) on first search | Fetch query result (~1-3 KB) per keystroke |
| Latency | Download full chunk, filter client-side | Edge query, ~5-20ms |

---

## Phase 4: R2 for map data

**Goal:** Move 9.4 GB of FGB files out of the Git repo and into Cloudflare R2 object storage.
**Risk:** Medium. Changes how map data is served. Requires Worker to proxy R2 requests.
**Rollback:** Re-add FGB files to repo, revert Worker routing.

### Step 4.1: Create R2 bucket

```bash
wrangler r2 bucket create boundaries-maps
```

### Step 4.2: Upload FGB files

```bash
# Upload all FGB files preserving directory structure
find data/maps -name "*.fgb" -o -name "*.fgb.gz" | while read f; do
  key="${f#data/maps/}"
  wrangler r2 object put "boundaries-maps/$key" --file "$f"
done
```

### Step 4.3: Worker serves FGB from R2

Create a Worker (or Pages Function) that handles `/data/maps/*`:

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.replace('/data/maps/', '');
    const object = await env.MAPS_BUCKET.get(key);
    if (!object) return new Response('Not found', { status: 404 });

    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      }
    });
  }
};
```

### Step 4.4: Remove FGB files from Git

```bash
# Remove from repo (keep in R2)
git rm -r --cached data/maps/
echo "data/maps/" >> .gitignore
git commit -m "Move FGB map data to Cloudflare R2"
```

### Impact

- Git repo shrinks from ~10 GB to ~500 MB
- Clone/pull times drop dramatically
- Deploy times drop from ~40 minutes to seconds
- FGB files served from CDN with proper caching and Brotli compression

---

## Phase 5: Optional enhancements

### 5.1: Cloudflare Web Analytics
- Dashboard > Web Analytics > Add site
- No JS tag needed — analytics run at the edge
- Privacy-respecting, no cookies, GDPR compliant

### 5.2: Early Hints (103)
- Dashboard > Speed > Optimization > Early Hints > Enable
- Cloudflare learns which resources pages request and sends 103 hints
- Browser starts fetching fonts/CSS before HTML finishes transferring

### 5.3: Brotli pre-compression for FGB
- Compress FGB files with Brotli at upload time: `brotli -9 file.fgb -o file.fgb.br`
- Worker serves `.fgb.br` with `Content-Encoding: br` header
- ~30-50% smaller than gzip for binary data

### 5.4: Rate limiting
- Dashboard > Security > WAF > Rate limiting rules
- Protect Worker API from abuse (e.g., max 100 requests/minute per IP)
- Free tier includes basic rules

---

## Cost summary

| Component | Cost |
|---|---|
| Cloudflare Pages | Free (unlimited bandwidth, unlimited requests) |
| Workers Paid | $5/month (10M requests, 30s CPU) |
| R2 storage (10 GB) | Free tier (10 GB included) |
| R2 reads | Free tier (10M reads/month included) |
| KV storage | Included in Workers Paid |
| civgraph.net domain | Namecheap renewal (~$10/year) |
| **Total** | **$5/month + ~$10/year domain** |

---

## Rollback plan

Every phase is independently reversible:

| Phase | Rollback |
|---|---|
| 1 (Pages) | Point DNS back to Neocities, re-enable deploy.yml |
| 2 (Headers) | Delete `_headers` file |
| 3 (Worker API) | Revert feature-loader.js to chunked mode |
| 4 (R2) | Re-add FGB files to repo, remove Worker routing |
| 5 (Enhancements) | Toggle off in Cloudflare dashboard |

---

## Migration timeline

| Day | Phase | Effort |
|---|---|---|
| 1 | DNS setup + Phase 1 (Pages) + Phase 2 (Headers) | 2-3 hours |
| 1 | Verify on civgraph.net, set up redirect from old domain | 30 min |
| 2-3 | Phase 3 (Worker spatial API) | 4-6 hours |
| 3-4 | Phase 4 (R2 for FGB files) | 2-3 hours |
| 4 | Phase 5 (optional enhancements) | 1 hour |
| **Total** | | **~2 days of work** |
