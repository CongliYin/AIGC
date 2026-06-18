# AIGC Media Generator

一个基于 Next.js 的网页端 AIGC 生成工具，支持 GPT 与 Seed 系列模型生成图像和视频。前端负责选择模型、填写提示词和预览结果；后端 API 路由负责调用模型、上传素材、轮询视频任务状态，并保护服务端密钥不暴露到浏览器。

## 功能

- 图像生成：支持 Seedream 和 GPT Image 2。
- 视频生成：支持 Seedance。
- 视频输入：支持文生视频、首帧图、首帧 + 尾帧、多参考素材。
- 素材上传：支持图片、视频、音频上传到 Vercel Blob，用于视频首帧或参考素材。
- 结果预览：图片直接展示；视频任务提交后自动轮询，完成后播放。
- 部署友好：Next.js App Router 单仓库，可直接部署到 Vercel。

## 当前模型

| 类型 | 前端模型名 | 模型 ID |
|---|---|---|
| 图像 | 豆包 Seedream（图） | `doubao-seedream-5-0-lite-260128` |
| 图像 | GPT Image 2（图） | `gpt-image-2` |
| 视频 | 豆包 Seedance（视频） | `doubao-seedance-2-0-260128` |

图片尺寸会按模型自动切换：

- Seedream: `2048x2048`, `2560x1440`, `1440x2560`
- GPT Image 2: `1024x1024`, `1536x1024`, `1024x1536`

Seedance 视频当前支持：

- 输入模式：文生视频、首帧图、首帧 + 尾帧、参考素材
- 时长：`5` 秒、`10` 秒
- 比例：`16:9`、`9:16`、`4:3`、`3:4`
- 参考素材上限：9 张图、3 段视频、3 段音频

## 项目结构

```text
src/lib/zzz.ts                     模型配置、适配器、统一分发
src/app/api/models/route.ts        获取前端可选模型
src/app/api/image/route.ts         图像生成
src/app/api/video/create/route.ts  创建视频任务
src/app/api/video/status/route.ts  轮询视频任务状态
src/app/api/upload/image/route.ts  上传图片素材
src/app/api/upload/media/route.ts  上传图片/视频/音频素材
src/app/page.tsx                   前端工作台
src/app/globals.css                页面样式
```

## 环境变量

复制示例文件：

```bash
cp .env.example .env.local
```

配置：

```bash
ZZZ_API_KEY=your_model_api_key_here
ZZZ_BASE_URL=https://your-model-api-base-url.example
BLOB_READ_WRITE_TOKEN=your_vercel_blob_read_write_token_here
```

不要提交 `.env.local`。密钥只应配置在本地 `.env.local` 或 Vercel Environment Variables。

## 本地运行

```bash
npm install
npm run dev
```

默认访问：

```text
http://localhost:3000
```

如果你用的是其它端口，例如：

```bash
npm run dev -- -p 3100
```

则访问：

```text
http://localhost:3100
```

## 部署到 Vercel

1. 将代码推送到 GitHub。
2. 在 Vercel 新建项目并导入仓库。
3. Framework Preset 选择 `Next.js`。
4. 在 Vercel 的 Environment Variables 中配置：
   - `ZZZ_API_KEY`
   - `ZZZ_BASE_URL`
   - `BLOB_READ_WRITE_TOKEN`
5. 点击 Deploy。

部署完成后，可以先访问：

```text
https://你的域名.vercel.app/api/models
```

正常情况下会返回图像模型和视频模型列表。然后再打开首页测试图像生成、视频生成和素材上传。

## 注意事项

- 视频生成是异步任务：创建任务后前端会轮询状态，不会在一个请求里等待视频完成。
- 上传首帧图或参考素材需要配置 `BLOB_READ_WRITE_TOKEN`。
- 修改模型 ID 后需要重启本地开发服务或重新部署 Vercel。
- 生产环境不要在浏览器、日志或接口响应里暴露任何服务端密钥。
