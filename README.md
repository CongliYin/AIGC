# zzz-media — AI 图像 / 视频生成工作台

Next.js（App Router）单仓库，前端 + serverless API 路由，可直接部署到 Vercel。
所有模型请求都走智增增网关；key 只放在服务端环境变量。

## 目录
```
src/lib/zzz.ts                     核心：配置 / 类型 / 适配器 / 模型注册表 / 统一分发
src/app/api/models/route.ts        GET  返回可选模型（无 key）
src/app/api/image/route.ts         POST 同步生成图片
src/app/api/video/create/route.ts  POST 提交视频任务 → 返回 token
src/app/api/video/status/route.ts  GET  轮询视频任务状态
src/app/api/video/file/route.ts    GET  Veo 专属：后端代理下载视频（注入 key）
src/app/page.tsx                   前端工作台
```

## 当前前端暴露的模型
- 图像：豆包 Seedream、GPT Image 2
- 视频：豆包 Seedance

## 端点映射（来自智增增文档，均挂在 https://api.zhizengzeng.com 下）
| 厂商 | 能力 | 方法 + 路径 | 鉴权 | 模式 |
|---|---|---|---|---|
| Veo (google) | 视频 | `POST /google/v1beta/models/{model}:predictLongRunning` | `?key=` | 异步 |
| Veo | 轮询 | `GET /google/v1beta/models/{model}/operations/{id}` | `?key=` | — |
| Veo | 下载 | `GET /google/v1beta/files/{fileId}:download?alt=media` | `?key=` | — |
| 豆包 (bytedance) | 图片 | `POST /bytedance/api/v3/images/generations` | Bearer | 同步 |
| 豆包 | 视频 | `POST /bytedance/api/v3/contents/generations/tasks` | Bearer | 异步 |
| 豆包 | 轮询 | `GET /bytedance/api/v3/contents/generations/tasks/{id}` | Bearer | — |
| 千问 (alibaba) | 视频 | `POST /alibaba/api/v1/services/aigc/video-generation/video-synthesis` | Bearer + `X-DashScope-Async: enable` | 异步 |
| 千问 | 轮询 | `GET /alibaba/api/v1/tasks/{task_id}` | Bearer | — |
| xAI (xai) | 图片 | `POST /xai/v1/images/generations` | Bearer | 同步 |
| xAI | 视频 | `POST /xai/v1/videos/generations` | Bearer | 异步 |
| xAI | 轮询 | `GET /xai/v1/videos/{request_id}` | Bearer | — |
| OpenAI 兼容通道 | 图片 | `POST /openai/v1/images/generations` | Bearer | 同步，通常返回 `b64_json` |

## ⚠️ 交给 codex 前请核实（智增增文档只给了端点，请求体指向各家官方文档）
1. `src/lib/zzz.ts` 里 `MODELS` 的每个 `modelId`（真实模型名）—— 对照各家官方控制台。
2. 各家请求体字段细节：火山 content/参数、DashScope `parameters.size`/`duration`、
   xAI 视频请求体与状态字段、Veo `parameters`（personGeneration 在欧盟等地区受限）。
3. 各家轮询响应里取视频地址的字段名（已按官方格式写并做了容错，建议先打 `raw` 看真实结构）。
4. Veo 完成后的 fileId 解析（`extractVeoFileId`）—— 不同 Veo 版本结构略有差异。

## 本地运行
```bash
npm i        # 需要一个标准 Next.js 14+ 项目（codex 可补 package.json / tsconfig / next.config）
cp .env.example .env.local
# 填入 ZZZ_API_KEY
npm run dev
```

## 部署到 Vercel
1. 代码推到 GitHub。
2. Vercel 连接该仓库，自动部署。
3. 在 Vercel 项目 Settings → Environment Variables 配置 `ZZZ_API_KEY`。
4. 全程无需 GPU；视频走「提交 + 轮询」异步模式，不会触发函数超时。
   Veo 视频通过后端代理下载会占出口带宽，个人使用足够（Hobby 档每月 100GB）。
```
