# Whalgebra

<div align="center">
  <img src="./assets/images/icons/logo.png" alt="Whalgebra Logo" width="128" height="128" />
  <h3>基于原生 Web 技术的代数计算工具</h3>
</div>

**Whalgebra**（前身 D-Calculator）是一个基于原生 Web 技术栈构建的代数计算器。其在浏览器本地完成计算，支持高精度十进制数、复数、表达式、自定义函数、统计回归、函数数表，以及四次及以下实系数多项式分析。计算器无外部运行时依赖，单文件版可离线使用。

## 使用与本地启动

- [在线计算器](https://double-cloth-studio.github.io/Whalgebra/)
- 离线使用：下载仓库中的 `dist/Whalgebra.html`，用现代浏览器打开。
- 平台安装包：参见 [Releases](https://github.com/double-cloth-studio/Whalgebra/releases)。

开发工具和测试需要 **Node.js 20+**。仓库没有 npm 依赖，无需先运行 `npm install`。

```powershell
git clone https://github.com/double-cloth-studio/Whalgebra.git
cd Whalgebra
npm start
```

访问终端显示的地址。服务默认仅监听 `127.0.0.1`，从 `8000` 开始查找可用端口。

```powershell
npm start -- --open          # 启动并打开工作台
npm start -- --lan           # 允许局域网设备访问
npm test                    # 运行 Node 回归测试及 JSON 计算用例
```

工作台提供计算器、测试控制台、逆向构建和 SVG 压缩入口。

## 计算示例

以下代码可在计算器页面的开发者控制台运行；根目录工作台不加载计算核心。

```javascript
const { result } = await WorkerTools.exec("2^10 + 24");
console.log(result); // "1048"

const complex = await WorkerTools.exec("sqrt(-1)");
console.log(complex.result); // "[i]"

const custom = await WorkerTools.exec("f(3)", { f: "[x]^2+1" });
console.log(custom.result); // "10"
```

表达式中的常数和变量使用 `[pi]`、`[e]`、`[i]`、`[x]`；三角函数默认采用弧度，例如 `sin(30[degree])` 得到 `0.5`。计算与输出精度均按**有效数字位数**计，当前全局计算精度上限为 220 位；界面提供普通精度（36 位计算、12 位输出）和高精度（220 位计算、100 位输出）两档。

输入态下，`Enter` 执行计算，`Backspace` / `Delete` 删除左右词元，方向键移动光标，`Alt+e` / `Alt+i` / `Alt+x` 输入对应常数或变量。结果页或计算中按 `Enter` / `Escape` 可返回或取消，具体行为取决于当前界面状态。

## 目录与开发约定

| 路径 | 用途 |
| --- | --- |
| `index.html` | 本地工作台 |
| `dist/Whalgebra.html` | 单文件计算器，浏览器测试和 Node 计算测试的核心来源 |
| `src/` | 从单文件拆出的 HTML、CSS、JS，也是 GitHub Pages 部署目录 |
| `assets/` | SVG 字形、图标、工具页共享 UI 和内置 SVGO 库 |
| `tools/` | 本地服务器、逆向构建与 SVG 处理工具 |
| `test/` | Node 测试、浏览器控制台与 JSON 用例 |
| `docs/` | 计算接口与实现说明 |

当前工具链仅提供 **`dist/Whalgebra.html` → `src/`** 的逆向拆分，没有将 `src` 打包回单文件的 npm 脚本。修改计算器时需保持两者一致：只改 `src` 不会进入现有计算核心测试，只改 `dist` 不会更新 Pages。

```powershell
# 建议先拆到临时目录核对；--force 会清空指定输出目录
npm run reverse-build -- --out tmp/reverse-preview --force
# 确认单文件包含需保留的修改后，再同步部署源码
npm run reverse-build -- --force
npm test
```

## 文档

- [文档导航](./docs/README.md)：按任务查找 API 和实现说明。
- [MathPlus 函数说明](./docs/mathplus_functions.md)：逐项查阅计算原理、用法与示例。
- [工具使用](./tools/README.md)：命令参数、输出目录和 Web API 限制。
- [测试维护](./test/README.md)：测试覆盖、用例格式和配置优先级。

项目由 Double-Cloth 维护，联系邮箱：[Double-Cloth@outlook.com](mailto:Double-Cloth@outlook.com)。
