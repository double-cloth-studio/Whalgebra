# 本地工具手册

工具用于开发、源码拆分和 SVG 资源处理，不参与计算器运行时。需要 Node.js 20+，无需安装 npm 依赖。以下命令在项目根目录运行。

```text
tools/
├── cli/       # 命令行工具，可导入其导出函数
├── server/    # 静态服务与受限 Web API
├── shared/    # 路径检查和换行处理
└── web/       # 浏览器工具页面
```

## 本地服务器

```powershell
npm start
npm start -- --port 8080 --open
npm start -- --lan
```

入口为 `tools/server/run_server.js`，默认仅本机监听、从 8000 查找空闲端口、不自动打开浏览器且不输出 HTTP 访问日志。实际地址以终端输出为准，按 `Ctrl+C` 停止。

| 参数 | 含义 |
| --- | --- |
| `--dir <PATH>` | 静态服务目录，默认项目根目录 |
| `--port <PORT>` | 起始端口，占用时继续查找 |
| `--local` / `--lan` | 监听 `127.0.0.1`（默认）/ `0.0.0.0` |
| `--open` / `--no-open` | 自动打开 / 不打开浏览器（默认） |
| `--log` / `--no-log` | 输出 / 不输出 HTTP 访问日志（默认） |
| `-h, --help` | 帮助 |

服务器禁用缓存，添加 `nosniff`、`Referrer-Policy: same-origin` 响应头。没有 `index.html` 的目录返回 403，服务器不列目录。`--lan` 仅用于静态预览，工具 API 统一返回 403，即使从本机访问。需要运行 Web 工具时，使用默认的 `--local` 模式。

从项目根目录提供局域网预览时，只开放工作台、计算器和页面所需的静态资源。使用 `--dir` 指定其他目录时，请只放入要共享的文件。局域网模式屏蔽隐藏路径和指向服务目录外的链接。

### Web 工具 API

工作台提供以下工具页面，对应 API 只在本地 Node 服务中可用，直接打开 HTML 或通过普通静态托管无法执行这些工具。

| 页面 | API |
| --- | --- |
| `tools/web/reverse_build.html` | `POST /api/tools/reverse-build` |
| `tools/web/svg_compressor.html` | `POST /api/tools/svg-compressor` |

工具页通过 `GET /api/tools/status` 探测服务，成功响应为 `{"ok":true}`，不返回项目绝对路径。

工具 POST 请求使用 `application/json`，请求体最多 1 MB；携带 `Origin` 时须与当前服务同源，无 `Origin` 的 CLI 请求也可调用。路径须位于项目内，Web 逆向构建仅允许输出到 `src`、`tmp` 或其子目录；Web SVG 工具的输入、输出和临时目录均限制在 `tmp` 内。更改静态服务目录不等于放宽这些路径限制。

逆向构建请求字段为 `inputFile`、`outputDir`、`noDedent`、`force`；SVG 请求字段为 `inputDir`、`outputDir`、`tempDir`，省略时使用对应工具默认值。成功返回 `{ok:true,result,logs}`，失败返回 `{ok:false,code,error,logs}`（来源或媒体类型校验失败时无 `logs`）。跨源、非 JSON、逆向构建输出目录已存在且未允许覆盖时分别返回 403、415、409，其他工具错误返回 400。Web 调用没有交互式覆盖确认，覆盖已有逆向构建输出目录时需显式传入 `force: true`。

## 逆向构建

从 `dist/Whalgebra.html` 提取有效的内联 style/script，改写引用，默认输出到 `src`。这不是从源码生成发行版的打包命令。

```powershell
# 先输出到临时目录，便于检查
npm run reverse-build -- --out tmp/reverse-preview --force

# 确认 dist 已包含需保留的源码修改后，同步 src
npm run reverse-build -- --force
```

CLI 用法：`node tools/cli/reverse_build.js [input_file] [选项]`。

| 参数 | 含义 |
| --- | --- |
| `input_file` | 输入单文件，默认 `dist/Whalgebra.html` |
| `-o, --out <PATH>` | 输出目录，默认 `src` |
| `--no-dedent` | 保留内联代码缩进 |
| `-f, --force` | 跳过确认，构建成功后替换已有输出目录 |
| `-h, --help` | 帮助 |

输出包含 `index.html`、`.nojekyll`、`css/`、`js/`。目标目录已存在且未传 `--force` 时，CLI 要求确认。输出目录不能是磁盘根目录、项目根目录或包含输入文件的目录。

工具先在目标目录旁的临时目录生成完整产物。读取或构建失败时保留旧产物，构建完成后才整体替换目标目录。如果将新产物移入目标目录时失败，工具会尝试恢复旧目录。恢复也失败时，错误消息会给出旧产物的备份路径。

## SVG 压缩

```powershell
npm run compress-svg
# 自定义路径
npm run compress-svg -- --input tmp/input --output tmp/output-css --temp tmp/output-svg
```

工具使用内置 SVGO，处理输入目录直属的 `.svg` 文件，不递归遍历子目录。

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `-i, --input <PATH>` | `tmp/input` | SVG 输入 |
| `--output <PATH>` | `tmp/output-css` | CSS 输出 |
| `--temp <PATH>` | `tmp/output-svg` | 优化后的 SVG 输出，供检查 |
| `-h, --help` | — | 帮助 |

默认生成 `icons.css`，高度为 `5dvmin`。例如 `sin.svg` 对应：

```css
._sin_ {
    height: 5dvmin;
    content: url(data:image/svg+xml;base64,...);
}
```

输入目录不存在时，工具创建目录并退出，放入 SVG 后重跑。**输出与临时目录会在处理前清空**，不得包含输入目录、项目根目录或彼此嵌套。含 `text`、`tspan`、`textPath`、`flowRoot` 时会提示先转曲；工具不会替你转换字形，输出应人工核对。

## 维护工具

共享逻辑位于 `tools/shared/filesystem.js`：`PROJECT_ROOT`、`nativeNewlines()`、`resolveProjectPath()`、`assertSafeOutputPaths()`。新增写文件或清空目录的操作应复用现有路径检查。

命令行入口放在 `cli/`，页面放在 `web/`；页面复用 `assets/ui/` 的样式和脚本。修改后运行 `npm test`。计算器同步和部署流程见[开发流程](../docs/toolchain_and_testing.md)，测试维护见[测试手册](../test/README.md)。
