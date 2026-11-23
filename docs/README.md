# 开发文档

这些文档对应当前仓库实现。命令在项目根目录运行；计算 API 示例在 `src/index.html` 或 `dist/Whalgebra.html` 的开发者控制台运行。核心类通过 `window` 导出，没有 npm 包或 ES module 导入入口。

| 任务 | 文档 |
| --- | --- |
| 启动、离线使用、了解目录 | [项目说明](../README.md) |
| 表达式、复数、大数和精度 | [计算引擎与构造器](./math_engine_and_constructors.md) |
| 多项式、复根、数表、统计回归 | [数学分析工具](./advanced_analysis_tools.md) |
| 异步调用、取消和故障恢复 | [Worker 架构](./architecture_and_worker.md) |
| 配置、常数和词元优先级 | [配置与公共工具](./configuration_and_utilities.md) |
| 页面模式、输入和虚拟列表 | [界面与交互](./ui_and_interaction.md) |
| 修改、同步、测试和部署流程 | [工具链与验证](./toolchain_and_testing.md) |
| CLI 参数与路径限制 | [工具手册](../tools/README.md) |
| JSON 用例格式与测试配置 | [测试手册](../test/README.md) |

## 选择计算入口

```javascript
// 界面调用：返回 Promise，在 Worker 中计算
const display = await WorkerTools.exec("1/3", { outputAcc: 8 });
console.log(display.result); // "0.33333333"

// 同步计算：返回数值对象及规范化表达式，适合组合运算
const [value] = MathPlus.calc("2[x]+1", { unknown: 3 });
console.log(value.toString()); // "7"
```

`CalcTools.exec` 是 `WorkerTools.exec` 对应的同步格式化入口。同步接口会占用当前线程；页面中的耗时任务应使用 `WorkerTools`。

## 维护原则

接口参数和返回结构以 `src/js/` 中的实现为准，计算测试从 `dist/Whalgebra.html` 抽取核心，因此修改时必须同步这两份代码。工具参数集中在工具手册，用例格式集中在测试手册，其他页面通过链接引用，避免多份说明逐渐失配。
