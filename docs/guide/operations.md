# 运维 · Operations

**部署 · Deploy.** 盒子（yt.okbro.xyz）：`npm run deploy`（构建 → `pm2 reload` → 两个工作进程 → 健康检查）。Vercel 镜像：`npm run deploy:vercel`（无工作进程；渲染、转写、抓取都在盒子上）。

**进程 · Processes.** `aura` ×4（Web，集群）、`aura-worker` ×2（任务队列：一键成片、渲染、转写、缩略图、抓取、同步）、定时：`aura-research`（选题刷新）、`aura-social`（每小时社媒）、`aura-social-daily`（日观看、创作者频道同步）、`aura-sweep`、`aura-backup`。

**队列 · Queue.** Postgres 表 `jobs`（`SKIP LOCKED` 领取、优先级、重试、心跳；工作进程被杀时任务 3 分钟内回队列；渲染从渲染一步接着做）。

**存储 · Storage.** Neon Postgres（新加坡）、Cloudflare R2（文件与缩略图，浏览器直传需要把域名加入 `scripts/setup-r2.ts` 的 CORS 列表）。

**密钥 · Keys.** `.env.local`（不入库）：数据库、R2、OpenRouter、ElevenLabs、YouTube Data API、Pexels、Unsplash、Zernio/TikHub、APP_URL。Vercel 的环境变量与之同步。

**检查 · Checks.** `node scripts/wiring.mjs`（52 项真实浏览器检查）、`npx tsc --noEmit`、`npm run lint`、`scripts/director-check.ts`（跑一遍一键成片）、`scripts/walkthrough.mjs`（录一遍 0 → 1）。

**常见问题 · Troubleshooting.**
- 缩略图空白：等几秒，会自动重试到生成为止；仍空白看 `pm2 logs aura-worker` 的 `files.poster`。
- 渲染停在某个百分比：工作进程重启时会自动回队列；看 `jobs` 表与 `video_exports.state`。
- 页面上的错误：`pm2 logs aura --lines 200 | grep ⨯`。
