# Kzyo 每日简报

每天自动聚合两类信息源并生成中文摘要的静态简报站，发布于 <https://alainouyang.github.io/digest/>。

## 栏目与信息源

| 栏目 | 来源 | 配置文件 |
|---|---|---|
| AI 技术博客 | 47 个 AI／技术博客 RSS | `config/feeds-ai.json` |
| 即刻简报 | 即刻用户动态（经 RSSHub） | `config/jike-users.json` |

栏目定义（名称、筛选主题、条数上限）见 `config/sections.json`。所有条目均为「摘要 + 作者署名 + 原文链接」，不转载全文。

## 工作方式

`.github/workflows/digest.yml` 定时运行 `scripts/run-digest.mjs`：抓取两组 RSS → 24 小时时间窗过滤 → LLM 评分筛选与中文摘要 → 生成 `src/content/issues/YYYY-MM-DD.md` → 提交并重新构建部署。摘要服务失败时降级为仅标题与链接；单个源失败只影响该源并在当期标注。

## 摘要健康与告警

- 生产生成步骤使用 `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"`，避免无 IPv6 的 GitHub runner 在连接方舟时过早放弃 IPv4。
- 网络异常与 HTTP 429/500/502/503/504 在客户端最多尝试两次，中间退避 1 秒；认证错误、响应格式错误和请求超时不在客户端自动重放。栏目层仍保留原有两次处理尝试。
- 日志保留安全清理后的底层连接错误码，不打印密钥、提示词或服务端响应正文。
- 每次生成在 Actions Summary 写出入选数、有摘要数、缺失数及降级原因；整栏降级、摘要覆盖率低于 80% 或无入选内容时，独立 `summary-health` 作业失败，让整体运行报红。发布作业不依赖此健康作业，标题版仍可正常部署。
- 少量摘要缺失、趋势缺失或源不可用产生 warning；不能把发布成功等同于摘要成功。
- 失败通知使用 GitHub Actions 原生机制；是否收到邮件/推送取决于个人 GitHub 通知设置，未接入额外通知渠道。
- `.github/workflows/test.yml` 在修复分支、master 推送和 PR 上运行无密钥的单测、内容校验与静态构建，不调用付费模型。

## 本地命令

```bash
npm install
npm run dev        # 本地预览
npm run build      # 生产构建
npm test           # 流水线单测
npm run verify     # 期刊内容契约
npm run digest     # 手动生成当期（需下方环境变量）
```

## Secrets / 环境变量

| 名称 | 说明 |
|---|---|
| `ARK_API_KEY` | 火山引擎方舟 API key |
| `ARK_MODEL` | 方舟模型（endpoint）名 |
| `ARK_BASE_URL` | 可选，默认 `https://ark.cn-beijing.volces.com/api/v3` |
| `RSSHUB_BASES` | 可选，逗号分隔的 RSSHub 实例列表 |

## 名单维护

`scripts/bootstrap-jike.mjs` 是生成初始即刻名单的一次性脚本；日常增删用户直接编辑 `config/jike-users.json`。
