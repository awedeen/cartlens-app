# CartLens Contributing Guidelines

## ⚠️ BRANCH PROTECTION — READ BEFORE TOUCHING CODE ⚠️

**NEVER commit directly to `main`.**

`main` is production. It deploys to Railway and serves live merchants.

### Workflow
1. All changes → `dev` branch only
2. Test on dev
3. Open a PR from `dev` → `main`
4. Get explicit approval from Alex before merging

### This applies to:
- Knox (AI assistant)
- Sub-agents / ACP coding agents
- Any human contributors

Bypassing this = breaking production for live merchants.
