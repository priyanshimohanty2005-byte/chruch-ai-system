# Church AI MCP — built from scratch in Windows Terminal, deployed on Render

This is tested and working: an MCP server exposing 5 Planning Center tools
to Claude (`list_service_types`, `list_plans`, `get_plan`, `get_plan_items`,
`create_plan_item`), built as a persistent Express server (a better fit for
Render than serverless-style hosting, since Render keeps the process alive
and this lets MCP use proper sessions instead of a stripped-down stateless
mode).

```
Phase 1 (this repo, on Render):   Claude <-> Planning Center
Phase 2 (local-bridge/, on-site):  Claude <-> ProPresenter (local network only)
Phase 3 (later):                   Playback / BoxCast / Resi, once you've
                                    confirmed what their APIs actually expose
```

**Why two folders?** Planning Center's API is a cloud API — `server.js`
deploys straight to Render. ProPresenter's API only runs on the local
network of the machine running ProPresenter, so `local-bridge/` runs there
instead, launched locally by Claude Desktop/Code — it never touches Render.

---

## Part A — Build the project from scratch in Windows Terminal

Open **Windows Terminal** (PowerShell). Run each block in order.

### 1. Create the folder structure

```powershell
mkdir church-ai-mcp
cd church-ai-mcp
mkdir lib
mkdir local-bridge
```

### 2. Create `package.json`

```powershell
@'
{
  "name": "church-ai-mcp",
  "version": "1.0.0",
  "description": "Remote MCP server exposing Planning Center Services to Claude, deployable on Render.",
  "type": "module",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.13.0",
    "express": "^4.21.2",
    "zod": "^3.24.1"
  }
}
'@ | Out-File -FilePath package.json -Encoding utf8
```

### 3. Create `.gitignore`

```powershell
@'
node_modules/
.env
.env.local
*.log
'@ | Out-File -FilePath .gitignore -Encoding utf8
```

### 4. Create `.env.example`

```powershell
@'
PCO_APP_ID=your_planning_center_app_id
PCO_SECRET=your_planning_center_secret
MCP_AUTH_TOKEN=change_me_to_a_long_random_string
PORT=3000
'@ | Out-File -FilePath .env.example -Encoding utf8
```

### 5. Create `render.yaml`

```powershell
@'
services:
  - type: web
    name: church-ai-mcp
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /
    envVars:
      - key: PCO_APP_ID
        sync: false
      - key: PCO_SECRET
        sync: false
      - key: MCP_AUTH_TOKEN
        sync: false
'@ | Out-File -FilePath render.yaml -Encoding utf8
```

### 6. Create `lib\planningCenter.js` and `server.js`

These two files are long, so rather than retype them into `Out-File`
here-strings (error-prone in a terminal), copy them from the project I
generated — **`lib/planningCenter.js`** and **`server.js`** in the attached
zip — into the matching paths:

```powershell
notepad lib\planningCenter.js
notepad server.js
```

Paste the contents from the zip into each, then save.

### 7. Create the local ProPresenter bridge

```powershell
notepad local-bridge\package.json
notepad local-bridge\server.js
```

Paste from the zip's `local-bridge/` folder.

### 8. Install dependencies

```powershell
npm install
```

### 9. Test it locally (optional but recommended)

```powershell
$env:MCP_AUTH_TOKEN="testtoken"
$env:PCO_APP_ID="your_real_app_id"
$env:PCO_SECRET="your_real_secret"
npm start
```

Visit `http://localhost:3000` in a browser — you should see
"Church AI MCP server is running." Press `Ctrl+C` to stop it.

---

## Part B — Push to GitHub

```powershell
git init
git add .
git commit -m "Initial commit: Planning Center MCP server"
git branch -M main
git remote add origin https://github.com/<your-username>/church-ai-mcp.git
git push -u origin main
```

(Create the empty repo on GitHub first at github.com/new if you haven't.)

---

## Part C — Deploy to Render

1. Go to https://dashboard.render.com → **New +** → **Web Service**.
2. Connect your GitHub account and select the `church-ai-mcp` repo.
   (If you committed `render.yaml`, Render will offer to use it as a
   **Blueprint** — that's the fastest path and pre-fills everything below.)
3. If configuring manually instead:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add environment variables under **Environment**:

   | Key | Value |
   |---|---|
   | `PCO_APP_ID` | your Planning Center App ID |
   | `PCO_SECRET` | your Planning Center Secret |
   | `MCP_AUTH_TOKEN` | a random string (generate with the command in `.env.example`) |

5. Click **Create Web Service**. Render builds and deploys automatically,
   and redeploys on every `git push` to `main` from now on.

Your MCP server's URL will be:

```
https://church-ai-mcp.onrender.com/mcp
```

(Render assigns the exact subdomain — check your dashboard for the real one.)

**Note on the free plan:** Render's free web services spin down after
15 minutes of inactivity and take ~30-50 seconds to wake back up on the
next request. That first Claude request after idle time will feel slow;
everything after it is fast until it goes idle again. Upgrade to a paid
instance if you want it always warm.

---

## Part D — Connect Claude to it

This is a remote MCP server — connect it like any other:

- **Claude.ai / Claude apps:** Settings → Connectors → Add custom
  connector → URL `https://church-ai-mcp.onrender.com/mcp`, Authorization
  header `Bearer <your MCP_AUTH_TOKEN>`.
- **Claude Code / Claude Desktop config:** point at the same URL with the
  same bearer token header.

Try: *"List my Planning Center service types."* or *"Show me this Sunday's
plan and its full running order."*

---

## Part E — Phase 2, ProPresenter (local, not Render)

```powershell
cd local-bridge
npm install
$env:PROPRESENTER_HOST="192.168.1.50"
$env:PROPRESENTER_PORT="1025"
npm start
```

Configure Claude Desktop/Code to launch this as a **local stdio MCP
server** (command `node`, args `["local-bridge/server.js"]`, with the
`PROPRESENTER_HOST`/`PROPRESENTER_PORT` env vars set) — not as a remote
URL, since it isn't internet-reachable.

Check ProPresenter's own **Settings → Network → API Documentation**
button for the exact endpoint list for your installed version before
building more tools here.

---

## Safety notes

- `create_plan_item` writes directly to a live Planning Center plan —
  have Claude confirm with you before using it.
- `MCP_AUTH_TOKEN` is the only thing protecting your church's data once
  the Render URL is public. Never commit it — it lives only in Render's
  environment variable settings and your local `.env` (which is
  gitignored).
