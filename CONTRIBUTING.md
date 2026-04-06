# CartLens Contributing Guidelines

## ⚠️ BRANCH PROTECTION — READ BEFORE TOUCHING CODE ⚠️

**NEVER commit directly to `main`.**

`main` is production. It deploys to Railway and serves live merchants.

### Workflow
1. All changes → `dev` branch only
2. Test on staging (`cartlens-app-staging.up.railway.app`) using CartLens Dev app on `cartlens-test2`
3. Open a PR from `dev` → `main`
4. Get explicit approval from Alex before merging

### This applies to:
- Knox (AI assistant)
- Sub-agents / ACP coding agents
- Any human contributors

Bypassing this = breaking production for live merchants.

---

## Deployment Surfaces (IMPORTANT)

CartLens has **three separate deployment surfaces**. They do NOT update together automatically.

| Surface | Triggers on | Command |
|---|---|---|
| **Backend app** | Git push to branch | Automatic via Railway |
| **Database migrations** | App startup | Runs `prisma migrate deploy` automatically |
| **Pixel extension** | Manual only | `shopify app deploy` |

### The pixel is the easy one to forget

Any change to `extensions/cartlens-pixel/src/index.ts` requires a manual deploy:

```bash
# For CartLens Dev (staging testing):
SHOPIFY_API_KEY=<cartlens-dev-client-id> \
SHOPIFY_API_SECRET=<cartlens-dev-secret> \
npx shopify app deploy --config shopify.app.dev.toml --force

# For CartLens (production — only after merging to main):
npx shopify app deploy --force
```

**Signs the pixel wasn't deployed:** new pixel features show no data even after reinstalling the app.

---

## PR Checklist (before opening PR to main)

Before merging `dev` → `main`, verify:

- [ ] Tested on staging with CartLens Dev on `cartlens-test2`
- [ ] If pixel changed: redeployed via `shopify app deploy --config shopify.app.dev.toml` and confirmed working
- [ ] If schema changed: migration exists in `prisma/migrations/` and ran on staging DB
- [ ] No regressions in existing features (cart tracking, checkout, orders still work)
- [ ] PR description notes if pixel deploy is required after merge

## Post-Merge Checklist (after merging to main)

- [ ] Railway auto-deploys production — verify green in Railway dashboard
- [ ] Check `/health` endpoint: `curl https://cartlens-app-production.up.railway.app/health`
- [ ] If pixel changed: run `npx shopify app deploy --force` for live CartLens app
- [ ] Smoke test on a real store: add to cart, check session appears in dashboard
