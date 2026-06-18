# SPEC.md — 实现与执行清单（交给 codex）

> 读我：本文件是给你（codex）的实现指令。先读完「项目目标」「现状」两节理解上下文，
> 再按「执行清单」分阶段实现，每个阶段都有明确的验收标准。带 ⚠️ 的是必须照官方文档
> 核实、不能凭记忆写死的点。

---

## 一、项目目标

做一个网页版 AI 媒体生成系统，前后端在同一个 Next.js（App Router）仓库里，部署到 Vercel。
两个功能：**生成图像**、**生成视频**。后端通过第三方聚合网关「智增增」调用大模型：

- 图像：豆包 Seedream、GPT Image 2
- 视频：豆包 Seedance

**硬约束（不可违背）：**
1. 全局只有一个密钥 `ZZZ_API_KEY`（网关用同一个 key 调所有厂商）。**key 只能存在于服务端环境变量，绝不可下发到浏览器。** 前端只发送模型 id，由后端映射到真实 model 与鉴权。
2. 图像同步返回；视频是异步任务 → 后端「提交拿 id」立即返回，前端轮询状态。**严禁**在一个请求里同步等视频生成完成（会超时）。
3. 不需要 GPU/特殊机器；目标平台 Vercel serverless（Hobby 档单函数 60s、每月 100GB 带宽）。

---

## 二、现状（已实现，不要重写，只在其上补全）

已有一套可运行的集成骨架，目录：

```
src/lib/zzz.ts                     ✅ 核心集成层（见下）
src/app/api/models/route.ts        ✅ GET  返回模型列表（无 key）
src/app/api/image/route.ts         ✅ POST 同步生成图片
src/app/api/video/create/route.ts  ✅ POST 提交视频任务 → 返回 token
src/app/api/video/status/route.ts  ✅ GET  按 token 轮询任务状态
src/app/api/video/file/route.ts    ✅ GET  Veo 专属：后端注入 key 代理下载视频
src/app/page.tsx                   ⚠️ 仅功能骨架前端，UI 需重做
.env.example                       ✅ 环境变量样例
README.md                          ✅ 端点映射表 + 核实清单
```

`src/lib/zzz.ts` 已完成的内容：
- 配置与两种鉴权封装：`bearerFetch`（bytedance/alibaba/xai 用 `Authorization: Bearer`）、
  `googleFetch`（google/Veo 用 `?key=`）。
- 统一类型：`ImageOptions / ImageResult / VideoOptions / VideoTaskRef / VideoTaskResult / TaskStatus`。
- 四家适配器对象：`veo / doubao / qwen / xai`，各自实现图片或视频的方法。
- 任务引用编解码：`encodeRef / decodeRef`（把 {vendor, model, id} 编成不透明 token 透传）。
- 模型注册表 `MODELS` 与查找 `findModel`。
- 统一分发入口：`generateImage / createVideoTask / getVideoTask`（路由层只调这三个）。

**架构约定（沿用，不要改）：** 新增模型 = 往 `MODELS` 加一项 +（如有新厂商）写一个适配器；
路由层和前端都不需要因此改动。

---

## 三、执行清单（按阶段，依次完成）

### 阶段 0 · 补脚手架并跑起来（P0）
- [ ] 用 `npx create-next-app@latest`（TypeScript + App Router + 不用 src 以外的默认）初始化，
      或手动补齐：`package.json`、`tsconfig.json`（含 `@/*` → `src/*` 路径别名）、
      `next.config.js`、`.gitignore`、`.eslintrc`。保留现有 `src/` 文件。
- [ ] 确认 `@/lib/zzz` 这种别名能解析（tsconfig `paths`）。
- [ ] `cp .env.example .env.local`，填入真实 `ZZZ_API_KEY`。
- [ ] `npm run dev` 能启动，访问首页不报错，`GET /api/models` 返回 image/video 两组列表。
- **验收：** 本地起服务，浏览器打开首页能看到两个模型下拉框被正确填充。

### 阶段 1 · 核实并跑通后端各厂商（P0，最关键）
> 智增增文档只精确给了端点和鉴权；请求体字段是按各家官方格式写的，需逐一核实。
> 调试方法：临时在各 `getVideoTask` 的返回里带上 `raw`，跑一次真实任务，对照真实响应结构。

- [ ] ⚠️ **核实 `MODELS` 里每个 `modelId`**（真实模型名）。当前是占位值，对照各家官方控制台/文档：
  - 豆包（火山方舟）：`doubao-seedream-*`（图）、`doubao-seedance-*`（视频）
  - OpenAI：`gpt-image-2`（图像）
- [ ] ⚠️ **豆包图片**：核实 `/bytedance/api/v3/images/generations` 请求体（`size`、`response_format`、
      `watermark` 等）与返回取值 `data[0].url`。跑通一次。
- [ ] ⚠️ **豆包视频**：核实 `content` 数组结构、`--ratio/--dur` 是否有效、轮询返回里视频地址字段
      （现写 `content.video_url`）、状态枚举（queued/running/succeeded/failed）。跑通一次。
- [ ] ⚠️ **千问视频**：确认创建必须带 `X-DashScope-Async: enable`（已写）；核实 `input`/`parameters`
      （`size` 如 `1280*720`、`duration`）、轮询返回 `output.video_url` 与 `output.task_status`
      （PENDING/RUNNING/SUCCEEDED/FAILED）。跑通一次。
- [ ] ⚠️ **xAI 图片/视频**：核实视频创建请求体、返回的 `request_id` 字段名、轮询返回的状态与
      视频 URL 字段名（`getVideoTask` 里已做容错映射，按真实结构收紧）。跑通一次。
- [ ] ⚠️ **Veo**：核实 `:predictLongRunning` 请求体（`instances`/`parameters`、`personGeneration`
      在欧盟/英国等地区受限）、operation 返回的 `name`、完成后视频 fileId 的解析路径
      （`extractVeoFileId` 已做多结构容错，按真实结构确认）。跑通一次「提交→轮询→/api/video/file 下载」。
- [ ] 统一错误处理：把网关返回的错误码/信息透传到前端可读的 `error` 字段；
      参考错误码文档 https://doc.zhizengzeng.com/doc-6902939 。
- **验收：** 用 curl 或脚本，对每个 `MODELS` 条目都能：图片拿到可访问 URL；视频拿到 token →
      轮询到 `succeeded` → 得到能播放的 `videoUrl`。

### 阶段 2 · 重做前端（P1）
> 现有 `src/app/page.tsx` 只是功能骨架，逻辑可参考但 UI 要重做。

- [ ] 两个 Tab：「生成图像」「生成视频」。切换 Tab 时按 kind 切换模型下拉（数据来自 `/api/models`）。
- [ ] 通用输入：模型下拉、prompt 文本框、生成按钮、加载/错误态。
- [ ] 视频额外参数控件：宽高比（16:9 / 9:16）、时长（如 5/8 秒）；图生视频可选首帧图 URL。
      这些参数透传给 `/api/video/create`。
- [ ] 图像流：POST `/api/image` → 展示返回图片（`url` 或 `data:image/...;base64,`）。
- [ ] 视频流：POST `/api/video/create` 拿 token → 轮询 `GET /api/video/status?token=...`
      （建议每 5 秒一次、带指数退避上限、最长轮询时间保护）→ `succeeded` 后用 `<video>` 播放
      `videoUrl`（Veo 是 `/api/video/file?...` 代理地址，其余是临时公开 URL）。
- [ ] 轮询期间展示进度/状态文案；`failed` 时展示错误并允许重试；离开页面/切 Tab 要能取消轮询。
- [ ] 结果区：图片/视频可下载；可展示本次 prompt 与所用模型。
- [ ] 基础响应式与无障碍（label、按钮禁用态、loading 提示）。
- **验收：** 在网页上完整走通「选模型→输入→生成→看到结果」两条链路，含视频的轮询过程。

### 阶段 3 · 健壮性与体验（P2，可选但建议）
- [ ] 输入校验（空 prompt、未选模型禁用按钮）。
- [ ] 网关超时/429/5xx 的重试与友好提示。
- [ ] 视频轮询的全局超时（如 10 分钟）与「任务仍在进行，可稍后用 token 查询」的兜底。
- [ ] （可选）生成历史：用 Vercel KV / Postgres 或 Supabase 存 {时间, 模型, prompt, 结果URL}，
      首页展示最近 N 条。注意 Veo 视频源只存 2 天、各家视频 URL 多为临时签名 URL——
      如需长期保存，完成后把字节转存到对象存储（Vercel Blob / R2 / S3）。
- [ ] （可选）简单限流，避免 key 被刷。

### 阶段 4 · 部署（P1）
- [ ] 代码推送到 GitHub。
- [ ] Vercel 连接该仓库；在 Settings → Environment Variables 配置 `ZZZ_API_KEY`（可选 `ZZZ_BASE_URL`）。
- [ ] 确认各 API 路由的 `maxDuration` 合理（已设 60s，符合 Hobby 档）。
- [ ] 线上验证两条链路；确认浏览器端任何网络请求都看不到 `ZZZ_API_KEY`。
- **验收：** 线上可用；DevTools Network 里不存在任何泄露 key 的请求或响应。

---

## 四、已知坑（务必遵守）
1. **千问创建任务必须带 `X-DashScope-Async: enable` 头**，否则同步等待 → 超时。
2. **Veo 下载地址带 `?key=`，绝不能给前端**；已通过 `/api/video/file` 后端代理处理，前端只拿到该代理地址。
3. **视频不要同步等**；一律「create 返回 token + status 轮询」。
4. **key 只在服务端**；前端任何地方、任何响应体都不得出现 `ZZZ_API_KEY` 或其他服务端密钥。
5. 各家**视频源链接有时效**（Veo 约 2 天，其余多为临时签名 URL）；要长期留存得转存对象存储。
6. 通过后端代理 Veo 视频会**消耗 Vercel 出口带宽**；个人使用足够，量大需改为转存。

## 五、不要做的事
- 不要把 key 写进前端代码或通过 `/api/models` 等接口返回。
- 不要改动 `lib/zzz.ts` 既定的统一分发签名（`generateImage/createVideoTask/getVideoTask`）；
  扩展请通过新增 `MODELS` 条目 / 新适配器实现。
- 不要为了「省事」把视频改成同步等待。

## 六、参考
- 网关文档总入口与端点映射见仓库 `README.md`。
- 各家官方文档（核实请求体用）：火山方舟、阿里云百炼 DashScope、x.ai docs、Gemini/Veo docs，
  对应链接散见于智增增各页「官方文档」处。
