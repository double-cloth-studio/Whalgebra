# 开发、测试与部署

项目使用原生 JavaScript 和 Node.js 20+，`package.json` 未声明 npm 依赖，无需安装依赖即可启动和测试。SVG 工具使用仓库内置的 `assets/lib/svgo.browser.js`。

## 入口与数据流

```text
dist/Whalgebra.html ── reverse-build ──→ src/ ── Pages workflow ──→ 在线计算器
        │
        ├── 浏览器测试控制台：iframe + 真实 Worker
        └── npm test：抽取核心脚本 + Node vm + WorkerTools 同步替身
```

当前没有 `src/` → 单文件的打包脚本。`dist/Whalgebra.html` 虽位于发行目录，仍是逆向拆分和计算回归测试的输入；不能仅按普通构建缓存处理。

## 日常开发

```powershell
npm start -- --open
npm test
```

本地工作台在根目录 `index.html`；源码计算器为 `src/index.html`；测试控制台为 `test/web/index.html`。服务器从 8000 查找可用端口，实际地址以终端为准。

修改计算器时：

1. 核对 `dist/Whalgebra.html` 与 `src/` 中对应实现，确认需保留的改动。
2. 将单文件改动先拆到临时目录，检查文件和引用。
3. 确认后同步 `src/`，检查差异并运行测试。
4. 在浏览器验证受影响的页面和真实 Worker 行为。

```powershell
npm run reverse-build -- --out tmp/reverse-preview --force
# --force 会清空输出目录；确认 dist 已包含需保留的 src 改动后再执行
npm run reverse-build -- --force
npm test
```

仅修改工具或测试页时无需重拆计算器。逆向构建会提取内联 `<style>` / `<script>`、按标签标识生成文件、改写引用并生成 `.nojekyll`，参数详见[工具手册](../tools/README.md)。

## 测试覆盖与边界

| 入口 | 覆盖范围 | 不覆盖 |
| --- | --- | --- |
| `npm test` | 服务器、路径边界、逆向构建、SVG 工具、统计/三角函数专项及清单中参与全量运行的 JSON 计算用例 | 浏览器布局、交互、真实 Worker 通信 |
| 浏览器测试控制台 | iframe 中的发行版计算核心、真实 Worker、单集调试和性能基准 | 完整人工交互与视觉检查 |
| 人工浏览器检查 | 模式切换、输入、结果、取消、响应式布局、滚动等受影响流程 | 自动化数值用例的替代验证 |

Node 测试通过 `test/node/helpers/calc_core.js` 抽取发行版的配置与计算脚本，使用 `WorkerTools` 同步替身调用真实数学实现。它复用浏览器 JSON 用例和执行逻辑，但不启动 Web Worker，也不运行计算器完整页面。

测试集清单只在 `test/cases/test_suites.json` 维护。当前有 8 个计算测试集及 1 个单独的性能基准，性能基准不参与“运行全部”。配置优先级与用例示例见[测试手册](../test/README.md)。

## 工具与发布

- `npm run compress-svg`：优化 `tmp/input` 下 SVG，输出 CSS 与优化后的 SVG；运行前清空输出目录，使用前核对路径。
- 本地服务器默认仅本机监听，`--lan` 可开启局域网访问；Web API 的同源、JSON、请求大小和目录限制见[工具手册](../tools/README.md)。
- `.github/workflows/ci.yml` 在匹配路径的 main 推送或 PR 中以 Node.js 20 运行 `npm test`，也支持手动触发。
- `.github/workflows/deploy.yml` 在 main 的 `src/**` 或自身变更时部署 `src/`，也支持手动触发；不会自动逆向构建或更新安装包。

修改文档通常不会触发现有 CI 路径过滤。文档维护应自行核对本地链接、命令、API 示例和对应实现。
