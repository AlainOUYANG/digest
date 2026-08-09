# Kzyo 每日简报项目规范

## 项目目标

本仓库生成并发布 Kzyo 每日简报。系统从 RSS 聚合 AI 技术、因果推断与营销科学、即刻动态，经筛选和中文摘要后生成 Astro 静态站点。

## 关键结构

- `config/`：栏目、RSS 源和即刻用户配置。
- `scripts/run-digest.mjs`：每日生成流水线入口。
- `scripts/lib/feeds.mjs`：RSS 抓取、内容归一化和时间窗过滤。
- `scripts/lib/select.mjs`：LLM 评分、筛选和摘要。
- `scripts/lib/render.mjs`：期刊 Markdown 渲染。
- `scripts/test/`：Node.js 单元测试。
- `src/content/issues/`：已发布期刊内容。
- `.github/workflows/`：每日生成与 GitHub Pages 部署。

## 内容原则

- 摘要必须由条目正文或原文页面中的可验证内容支撑，不得根据标题猜测。
- 原文内容不足时保留标题、署名和链接，不生成「未提供具体内容」「建议查阅原文」等占位式摘要。
- 不转载全文；只向模型传递满足摘要需要的限长文本，页面继续只发布摘要和原文链接。
- 单个 RSS 源或原文页面失败不得中断整期生成，并应保留可诊断日志。

## 开发约束

- 仓库默认分支是 `master`；功能开发使用独立分支或工作树。
- 优先使用 Node.js 标准库和现有依赖；新增依赖前必须说明现有能力为何不足。
- 修复缺陷时先添加能复现问题的测试，再修改实现。
- 只修改与当前任务直接相关的文件，不顺手重构或调整 CI/CD。
- 密钥只通过环境变量注入，不进入代码、日志或提交。
- 任何 push、GitHub Pages 发布或工作流配置修改都需要主人另行确认。

## 验证要求

代码或内容逻辑变更完成后至少运行：

```bash
npm test
npm run verify
npm run build
```

只有上述验证通过后，才能在 `ROADMAP.md` 中把事项标记为已完成。每次开发、修复或重要文档变更后同步更新 `ROADMAP.md`。
