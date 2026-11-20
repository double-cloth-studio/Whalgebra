# Whalgebra 项目技术与开发文档

欢迎查阅 **Whalgebra**（基于原生 Web 技术的代数计算工具）官方项目文档。

本文档库位于 `docs/` 目录中，旨在为开发者、贡献者及研究人员提供全面、系统、深入的代码级开发参考。文档重点剖析了核心计算引擎 **`MathPlus`** 与各种高精度数学构造器（**`BigNumber`**、**`ComplexNumber`**）的设计机理与调用方法，并详尽阐述了项目的高阶数学分析工具、异步 Worker 架构、配置与词法系统、交互及虚拟渲染引擎，以及配套的工程工具链与测试体系。

---

## 文档目录与快速导航

| 序号 | 文档模块 | 重点内容概述 |
| :---: | :--- | :--- |
| **01** | [**数学核心构造器与 MathPlus 计算引擎详解**](./math_engine_and_constructors.md) | **【核心重点】** 深入讲解 `BigNumber`（任意精度十进制数）、`ComplexNumber`（复数构造器）与 `MathPlus` 静态计算引擎（调度场算法、`calc()` API、40+ 静态数学函数、复数域与超越函数支持、精度控制与代码示例）。 |
| **02** | [**高阶数学分析工具指南**](./advanced_analysis_tools.md) | 涵盖 `PowerFunctionTools`（0-4 次多项式求根与函数图像分析）、`RadicalFunctionTools`（复数根式与极坐标通式）、`FuncValueListTools`（函数数表生成器）、`StatisticsTools`（统计指标与 7 种回归模型分析）及 `CalcTools`（执行门面）。 |
| **03** | [**异步计算架构与 Worker 系统**](./architecture_and_worker.md) | 深入解析 `SyncWorker`（无外部文件依赖的动态 Web Worker 封装、RPC 通信、任务取消与超时机制）与 `WorkerTools`（主线程异步计算门面、状态同步、崩溃自动重启与恢复）。 |
| **04** | [**全局配置、常数表与词法解析系统**](./configuration_and_utilities.md) | 阐述 `CalcConfig`（精度上限、格式限制、Lanczos 伽马常数与高精度常数表）、`TokenConfig`（数学符号词典、结合性与运算符优先级）与 `Public` 公共实用工具类（类型识别、数值归整、理想化字符串输出）。 |
| **05** | [**UI 交互、虚拟滚动与渲染层**](./ui_and_interaction.md) | 解析纯原生 JavaScript 实现的交互架构：`InputManager`（虚拟/实体键盘事件与括号自动匹配）、`PrintManager`（计算结果显示）、`VirtualScroll`（自研高动态 DOM 节点池虚拟滚动引擎）与 `PageControlTools`。 |
| **06** | [**工程工具链、本地服务与测试体系**](./toolchain_and_testing.md) | 介绍项目轻量开发体系：内置静态 HTTP 服务器（`run_server.js`）、单文件逆向拆分构建工具（`reverse_build.js`）、SVG 压缩与 Base64 CSS 生成工具（`svg_compressor.js`），以及包含 9 大测试集的自动化测试体系。 |

---

## 核心能力极简速览

### 1. 任意精度与复数域运算
```javascript
// 创建高精度大数与复数
const a = new BigNumber("12345678901234567890.123456789", { acc: 50 });
const z = new ComplexNumber("3 + 4[i]");

// 使用 MathPlus 静态类进行链式/复合数学运算
const w = MathPlus.sin(z);
console.log(w.toString({ printMode: 'algebra' })); // 3.853738... - 27.01681...[i]
```

### 2. 标准表达式解析与计算 (`MathPlus.calc`)
```javascript
// 支持标准代数表达式、超越函数、特殊常数与自定义函数
const [res, canonicalExpr] = MathPlus.calc("sin([pi]/4 + [i]) + 2^10", {
    acc: 100 // 指定正整数有效位数
});
console.log(res.toString()); // 显示高精度代数计算结果
console.log(canonicalExpr);  // 内部规范化后的词元表达式
```

### 3. 多项式求根与函数性质分析
```javascript
// 分析四次多项式 x^4 - 5x^2 + 4 = 0 的根、极值点、拐点及单调区间
const analysis = PowerFunctionTools.powerFunctionAnalysis([1, 0, -5, 0, 4]);
console.log("多项式实/复根:", analysis.roots); // ['-2', '-1', '1', '2']
console.log("极小值点:", analysis.minimumPoint);
```

### 4. 统计与多模型回归拟合
```javascript
// 传入 X 与 Y 样本数据，一键对比 7 种回归模型（线性、多项式、指数、对数、幂函数等）
const stats = StatisticsTools.statisticsCalc([1, 2, 3, 4, 5], [2.1, 3.9, 6.2, 8.1, 9.9]);
console.log("最佳拟合模型:", stats.bestModel);
console.log("决定系数 R²:", stats[stats.bestModel].R2);
console.log("回归方程:", stats[stats.bestModel].regressionEquation);
```

### 5. 异步 Web Worker 零阻塞调用
```javascript
// 通过 WorkerTools 在后台子线程中进行密集型数学计算，彻底释放主线程 UI
const result = await WorkerTools.exec("100! + gamma(0.5)", {
    calcAcc: 220,
    outputAcc: 50
});
console.log(result.result);
```

---

## 项目运行与测试环境

- **运行环境**: Node.js >= 20，现代浏览器（Chrome 109+、Firefox、Safari、Edge）。
- **零依赖原则**: 计算核心全部采用原生 JavaScript (ES6+)，无任何第三方外部运行时库（Zero Runtime Dependencies）。
- **本地启动服务**:
  ```powershell
  npm start
  ```
- **自动化测试回归**:
  ```powershell
  npm test
  ```

更多详细信息，请点击上方对应专栏文档深入阅读。
