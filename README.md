# Kzyo 每日简报

每天自动聚合三类信息源并生成中文摘要的静态简报站，发布于 <https://alainouyang.github.io/digest/>。

## 栏目与信息源

| 栏目 | 来源 | 配置文件 |
|---|---|---|
| AI 技术博客 | 92 个技术博客 RSS（源列表引自 Hacker News Popularity Contest 精选） | `config/feeds-ai.json` |
| 因果推断与营销科学 | arXiv stat.ME / econ.EM 与精选博客 | `config/feeds-causal.json` |
| 即刻简报 | 即刻用户动态（经 RSSHub） | `config/jike-users.json` |

栏目定义（名称、筛选主题、条数上限）见 `config/sections.json`。所有条目均为「摘要 + 作者署名 + 原文链接」，不转载全文。

## 工作方式

`.github/workflows/digest.yml` 定时运行 `scripts/run-digest.mjs`：抓取三组 RSS → 24 小时时间窗过滤 → LLM 评分筛选与中文摘要 → 生成 `src/content/issues/YYYY-MM-DD.md` → 提交并重新构建部署。摘要服务失败时降级为仅标题与链接；单个源失败只影响该源并在当期标注。

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
