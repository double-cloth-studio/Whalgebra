# 高阶数学分析与求解工具指南

Whalgebra 不仅提供表达式求值与基础算术，还内置了一套工业级的高阶数学分析工具包，全部基于静态工具类设计，涵盖多项式解析、复数根式展开、函数数表生成、双变量统计回归以及高层执行门面。

---

## 目录

- [1. 多项式与幂函数分析器：PowerFunctionTools](#1-多项式与幂函数分析器powerfunctiontools)
  - [1.1 支持范围与降阶求解机制](#11-支持范围与降阶求解机制)
  - [1.2 powerFunctionAnalysis() API 说明](#12-powerfunctionanalysis-api-说明)
  - [1.3 返回值结构 PowerFunctionAnalysisResult 详析](#13-返回值结构-powerfunctionanalysisresult-详析)
  - [1.4 调用示例：四次多项式综合分析](#14-调用示例四次多项式综合分析)
- [2. 复数根式分析器：RadicalFunctionTools](#2-复数根式分析器radicalfunctiontools)
  - [2.1 复数开方原理与通式生成](#21-复数开方原理与通式生成)
  - [2.2 radicalFunctionAnalysis() API 说明与示例](#22-radicalfunctionanalysis-api-说明与示例)
- [3. 函数数表生成器：FuncValueListTools](#3-函数数表生成器funcvaluelisttools)
  - [3.1 数表功能设计与溢出保护机制](#31-数表功能设计与溢出保护机制)
  - [3.2 valueList() API 说明与调用示例](#32-valuelist-api-说明与调用示例)
- [4. 统计分析与回归拟合：StatisticsTools](#4-统计分析与回归拟合statisticstools)
  - [4.1 描述性统计指标清单](#41-描述性统计指标清单)
  - [4.2 七大回归模型拟合算法与方程构建](#42-七大回归模型拟合算法与方程构建)
  - [4.3 statisticsCalc() API 说明与调用示例](#43-statisticscalc-api-说明与调用示例)
- [5. 独立高层计算门面：CalcTools](#5-独立高层计算门面calctools)
  - [5.1 职责与与 MathPlus 的区别](#51-职责与与-mathplus-的区别)
  - [5.2 exec() API 详解与调用示例](#52-exec-api-详解与调用示例)

---

## 1. 多项式与幂函数分析器：PowerFunctionTools

`PowerFunctionTools` 专门用于对实系数多项式函数进行严格的微积分与代数分析。它支持最高四次的多项式（Quartic），涵盖图像特征、导数零点、凹凸拐点与实/复根求解。

### 1.1 支持范围与降阶求解机制

多项式采用统一的四次多项式形式输入：

$$f(x) = ax^4 + bx^3 + cx^2 + dx + e$$

- 当最高次项系数为 0 时，分析器会自动、平滑地降阶为三次多项式（Cubic）、二次多项式（Quadratic）、线性方程（Linear）或常数函数。
- **求根算法**：
  - **一次方程**：$dx + e = 0 \implies x = -e / d$。
  - **二次方程**：采用判别式 $\Delta = b^2 - 4ac$ 与求根公式，自动输出重实根、双实根或共轭复根对。
  - **三次方程**：应用卡尔丹公式（Cardano's Formula），通过变换消去二次项转化为降次三次方程，并使用复数立方根求解。
  - **四次方程**：应用费拉里方法（Ferrari's Method），构建三次预解多项式（Resolvent Cubic），将四次方程分解为两个二次方程求解。

### 1.2 powerFunctionAnalysis() API 说明

```javascript
PowerFunctionTools.powerFunctionAnalysis(list)
```

- **`list` (`Array<string|number|BigNumber|ComplexNumber>`)**：固定长度为 5 的数组，按降幂排列的实系数 `[a, b, c, d, e]`。
  - 低次多项式的高次项必须补 `0`。例如，分析 $2x^2 - 4x + 2$ 应传入 `[0, 0, 2, -4, 2]`。
  - 系数必须为实数，若检测到虚部非零会抛出错误。

### 1.3 返回值结构 PowerFunctionAnalysisResult 详析

返回的对象具有严格一致的结构，即使某些低阶多项式不适用某些字段，也会保留固定的占位符（避免 UI 产生空指针异常）：

```typescript
interface PowerFunctionAnalysisResult {
    equation: string;                  // 规范化后的降幂多项式字符串，如 "x^4-5x^2+4"
    range: [string, string];           // 函数值域左右端点，如 ["-2.25", "+inf"]
    increasingInterval: [string, string][]; // 单调递增区间列表
    decreasingInterval: [string, string][]; // 单调递减区间列表
    maximumPoint: [string, string][];  // 极大值点坐标 [x, y] 列表；无极大值时为 [["null", "null"]]
    minimumPoint: [string, string][];  // 极小值点坐标 [x, y] 列表
    convexInterval: [string, string][];     // 凸区间 (f''(x) < 0)
    concaveInterval: [string, string][];    // 凹区间 (f''(x) > 0)
    inflectionPoint: [string, string][];    // 拐点坐标 [x, y] 列表
    roots: string[];                   // 方程的所有根（实根与复根字符串），如 ["-2", "-1", "1", "2"]
}
```

### 1.4 调用示例：四次多项式综合分析

```javascript
// 分析多项式: f(x) = x^4 - 2x^2
// 传入系数: a=1, b=0, c=-2, d=0, e=0
const analysis = PowerFunctionTools.powerFunctionAnalysis([1, 0, -2, 0, 0]);

console.log("规范化方程:", analysis.equation);
// "x^4-2x^2"

console.log("多项式的根:", analysis.roots);
// ["0", "-1.41421356...", "1.41421356..."]

console.log("极小值点坐标:", analysis.minimumPoint);
// [["-1", "-1"], ["1", "-1"]]

console.log("极大值点坐标:", analysis.maximumPoint);
// [["0", "0"]]

console.log("函数值域:", analysis.range);
// ["-1", "+inf"]
```

---

## 2. 复数根式分析器：RadicalFunctionTools

`RadicalFunctionTools` 专注于求解和展开任意复数 $z$ 的 $n$ 次方根。

### 2.1 复数开方原理与通式生成

根据棣莫弗定理（De Moivre's Theorem），任何非零复数 $z = r e^{i\theta}$ 在复数平面上均有恰好 $n$ 个互不相同的 $n$ 次方根，均匀分布在半径为 $\sqrt[n]{r}$ 的圆周上：

$$w_k = \sqrt[n]{r} \cdot e^{i \frac{\theta + 2k\pi}{n}} = \sqrt[n]{r} \left( \cos\frac{\theta + 2k\pi}{n} + i\sin\frac{\theta + 2k\pi}{n} \right), \quad k \in \{0, 1, \dots, n-1\}$$

### 2.2 radicalFunctionAnalysis() API 说明与示例

```javascript
RadicalFunctionTools.radicalFunctionAnalysis(z, n)
```

- **`z`**：被开方数（支持实数、复数、字符串或 `ComplexNumber`）。
- **`n`**：根指数，必须能够被规范化为严格大于 0 的正整数。

#### 返回结果结构：
- **`z`** (`string`)：规范化后的被开方数字符串。
- **`n`** (`string`)：正整数根指数。
- **`formula`** (`string`)：带有参数 `[k]` 和极坐标标识 `[toPolar]` 的解析通式。
- **`kRange`** (`[string, string]`)：根序号范围，恒为 `["0", String(n - 1)]`。
- **`numericalResults`** (`string[]`)：计算所得的具体数值解列表（长度受 `CalcConfig.RADICAL_FUNCTION_MAX_SHOW_RESULTS`（20）限制，超过时触发截断）。
- **`overflow`** (`boolean`)：标记是否发生超出显示上限的截断。

#### 代码示例：
```javascript
// 计算复数 1 + i 的 4 次方根
const result = RadicalFunctionTools.radicalFunctionAnalysis("1 + [i]", 4);

console.log("被开方数:", result.z);       // "1+[i]"
console.log("根指数:", result.n);         // "4"
console.log("解析通式:", result.formula);  // 形如 "1.0905...[toPolar](0.1963...+1.5707...[k])"
console.log("k 取值范围:", result.kRange); // ["0", "3"]
console.log("4个复数根:");
result.numericalResults.forEach((root, idx) => {
    console.log(`  w_${idx} = ${root}`);
});
```

---

## 3. 函数数表生成器：FuncValueListTools

`FuncValueListTools` 用于在指定闭区间 $[start, end]$ 内，以恒定步长 $step$ 密集采样计算自定义函数 $f(x)$ 与 $g(x)$ 的取值，便于前端以表格或离散图表的方式展示变化趋势。

### 3.1 数表功能设计与溢出保护机制

- **区间要求**：$start \le end$，且 $step > 0$ 且必须为纯实数，防止因负步长或零步长导致死循环。
- **双函数并行计算**：$f$ 与 $g$ 共享同一个自变量采样序列，单点计算失败（例如遭遇无定义除零）时，仅在该点填充错误占位符，不影响其他采样点的生成。
- **数量截断上限**：受 `CalcConfig.VALUE_LIST_MAX_SHOW_RESULTS`（默认为 999 项）保护。当超出限制时自动截断，并在末尾追加哨兵标记 `[print_content_omit]`。

### 3.2 valueList() API 说明与调用示例

```javascript
FuncValueListTools.valueList(f, g, start, step, end)
```

#### 返回值结构：
```typescript
interface ValueListResult {
    varList: string[]; // 自变量采样点序列，例如 ["0", "0.5", "1", "1.5", ...]
    f: string[];       // 对应的 f(x) 函数值序列
    g: string[];       // 对应的 g(x) 函数值序列
}
```

#### 代码示例：
```javascript
// 生成 f(x) = x^2, g(x) = sin(x) 在区间 [-1, 1]，步长 0.5 处的数表
const table = FuncValueListTools.valueList("[x]^2", "sin([x])", -1, 0.5, 1);

console.log("自变量 x:", table.varList); // ["-1", "-0.5", "0", "0.5", "1"]
console.log("f(x):", table.f);           // ["1", "0.25", "0", "0.25", "1"]
console.log("g(x):", table.g);           // ["-0.8414...", "-0.4794...", "0", "0.4794...", "0.8414..."]
```

---

## 4. 统计分析与回归拟合：StatisticsTools

`StatisticsTools` 提供了完整的**双变量与单变量统计分析**，并能一键执行 **7 种常用数学回归模型的自动拟合与优选**。

### 4.1 描述性统计指标清单

输入非空的实数样本对 $(x_1, y_1), (x_2, y_2), \dots, (x_n, y_n)$，分析器自动计算：

| 指标字段 | 统计学含义 | 计算公式 / 行为 |
| :--- | :--- | :--- |
| **`n`** | 样本对数量 | $n$ |
| **`averageA` / `averageB`** | 样本均值 $\bar{x}, \bar{y}$ | $\frac{1}{n}\sum x_i, \frac{1}{n}\sum y_i$ |
| **`sumA` / `sumB`** | 样本总和 $\sum x, \sum y$ | $\sum x_i, \sum y_i$ |
| **`sum2A` / `sum2B`** | 平方和 $\sum x^2, \sum y^2$ | $\sum x_i^2, \sum y_i^2$ |
| **`totalVarianceA` / `B`** | 总体标准差 $\sigma$ | $\sqrt{\frac{1}{n}\sum (x_i - \bar{x})^2}$ |
| **`sampleVarianceA` / `B`** | 样本标准差 $s$ | $\sqrt{\frac{1}{n-1}\sum (x_i - \bar{x})^2}$（$n=1$ 时为 `'error'`） |
| **`maxA`, `minA`, `maxB`, `minB`** | 极值统计 | 样本集合中的最大值与最小值 |
| **`dotAB`** | 样本点积 $\sum xy$ | $\sum x_i y_i$ |
| **`dotA2B`** | 加权点积 $\sum x^2 y$ | $\sum x_i^2 y_i$ |
| **`totalCovariance`** | 总体协方差 $\operatorname{Cov}(X, Y)$ | $\frac{1}{n}\sum (x_i - \bar{x})(y_i - \bar{y})$ |
| **`sampleCovariance`** | 样本协方差 | $\frac{1}{n-1}\sum (x_i - \bar{x})(y_i - \bar{y})$ |
| **`correlationCoefficient`** | 皮尔逊相关系数 $r$ | $\frac{\operatorname{Cov}(X,Y)}{\sigma_X \sigma_Y} \in [-1, 1]$ |

### 4.2 七大回归模型拟合算法与方程构建

系统通过构建正规方程组（Normal Equations）并使用高斯消元法求解最小二乘解，在原始尺度上计算决定系数 $R^2$：

1. **线性模型 (`linear`)**：$y = a + bx$
2. **二次多项式模型 (`square`)**：$y = a + bx + cx^2$
3. **对数模型 (`ln`)**：$y = a + b\ln(x)$（要求 $x_i > 0$）
4. **指数模型 (`exp`)**：$y = a \cdot e^{bx}$（通过对 $y$ 取对数线性化，要求 $y_i > 0$）
5. **乘幂模型 (`abx`)**：$y = a \cdot b^x$
6. **幂函数模型 (`axb`)**：$y = a \cdot x^b$（要求 $x_i > 0, y_i > 0$）
7. **倒数/双曲模型 (`reciprocal`)**：$y = a + \frac{b}{x}$（要求 $x_i \ne 0$）

> [!TIP]
> 引擎会自动对比各模型在因变量真实量纲上的决定系数 $R^2$，并在字段 `bestModel` 中标记最优模型名称。

### 4.3 statisticsCalc() API 说明与调用示例

```javascript
StatisticsTools.statisticsCalc(listA, listB)
```

- **`listA`**：自变量 $X$ 数据样本（实数列表）。
- **`listB`**：因变量 $Y$ 数据样本（实数列表，长度必须与 `listA` 相等且大于 0）。

```javascript
// 准备测试数据点
const xData = [1, 2, 3, 4, 5];
const yData = [2.2, 3.8, 6.1, 7.9, 10.2];

// 执行统计计算
const result = StatisticsTools.statisticsCalc(xData, yData);

// 1. 读取基础统计量
console.log(`样本容量: ${result.n}`);
console.log(`X 均值: ${result.averageA}, Y 均值: ${result.averageB}`);
console.log(`皮尔逊相关系数: ${result.correlationCoefficient}`); // 接近 0.999

// 2. 查看自动判定的最优回归模型
const best = result.bestModel;
console.log(`最优拟合模型为: ${best}`); // "linear"
console.log(`回归方程: ${result[best].regressionEquation}`); // 形如 "0.19+1.99[x]"
console.log(`决定系数 R^2: ${result[best].R2}`);              // 接近 0.998

// 3. 也可查看其他模型（如二次多项式）
console.log(`二次模型 R^2: ${result.square.R2}`);
console.log(`二次模型方程: ${result.square.regressionEquation}`);
```

---

## 5. 独立高层计算门面：CalcTools

`CalcTools` 是位于 `core_computational_logic.js` 末端的同步高层门面类，它统一包装了 `MathPlus.calc` 的求值、格式化与精度配置，特别适合主线程与后续 Worker 线程的统一调用。

### 5.1 职责与与 MathPlus 的区别

- `MathPlus.calc()` 专注于**代数算法**与底层数据结构运算，输出未格式化的 `ComplexNumber` 对象。
- `CalcTools.exec()` 专注于**应用层接口**：它直接接收调用级精度配置、输出模式（字符串或结构体元组），并负责调用 `Public.idealizationToString()` 将结果格式化为最终可阅读或显示的字符串。

### 5.2 exec() API 详解与调用示例

```javascript
CalcTools.exec(expr, {
    printMode = CalcConfig.globalPrintMode,
    calcAcc = CalcConfig.globalCalcAccuracy,
    outputAcc = CalcConfig.outputAccuracy,
    calcMode = 'calc',
    outputMode = 'output',
    f, g
} = {})
```

#### 参数特性：
- **`calcAcc`**：本次计算专用精度（不修改全局 `CalcConfig.globalCalcAccuracy`）。
- **`outputAcc`**：最终显示精度策略：
  - $\ge 1$：绝对保留有效位数（如 `16`）。
  - $(0, 1)$：相对 `calcAcc` 的保留比例（例如 `0.9` 表示保留 90% 有效位数）。
  - $\le 0$：完全保持与 `calcAcc` 相同。
- **`outputMode`**：
  - `'output'`（默认）：将结果格式化为用户友好的字符串（例如 `"3.14159265"`）。
  - `'mid'`：保留内部高精度数组表示 `[[power, mantissa, acc], [power, mantissa, acc]]`，用于后续无精度损失的连续运算。

#### 调用示例：
```javascript
// 1. 标准输出计算
const r1 = CalcTools.exec("sin([pi] / 2) + 10^3");
console.log(r1.result); // "1001"
console.log(r1.expr);   // 规范化后的内部表达式

// 2. 以极坐标输出复数
const r2 = CalcTools.exec("1 + [i]", {
    printMode: 'polar',
    outputAcc: 8
});
console.log(r2.result); // "1.4142136[toPolar]0.78539816"

// 3. 返回中间无损元组结构 (outputMode: 'mid')
const r3 = CalcTools.exec("1 / 3", {
    outputMode: 'mid',
    calcAcc: 30
});
console.log(r3.result); // 实部与虚部的 [power, mantissa, acc] 数组
```
