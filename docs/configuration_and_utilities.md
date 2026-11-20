# 全局配置、常数表与词法解析系统

Whalgebra 的稳健性与高精度依赖于一套组织严密的全局基础设施。本篇文档详细说明配置中枢 **`CalcConfig`**、词法符号字典 **`TokenConfig`** 以及通用工具类 **`Public`**。

---

## 目录

- [1. 计算配置与高精度常数表：CalcConfig](#1-计算配置与高精度常数表calcconfig)
  - [1.1 关键边界阈值与性能限制常量](#11-关键边界阈值与性能限制常量)
  - [1.2 高精度预计算常数表 (constants)](#12-高精度预计算常数表-constants)
  - [1.3 动态响应式配置属性与 Worker 自动同步](#13-动态响应式配置属性与-worker-自动同步)
- [2. 词法字典与操作符优先级：TokenConfig](#2-词法字典与操作符优先级tokenconfig)
  - [2.1 词元 (Token) 分类体系](#21-词元-token-分类体系)
  - [2.2 优先级映射 (priorityMap) 与结合性规则](#22-优先级映射-prioritymap-与结合性规则)
  - [2.3 词元元数据获取：getTokenInfo()](#23-词元元数据获取gettokeninfo)
- [3. 通用基础工具类：Public](#3-通用基础工具类public)
  - [3.1 精确类型判定：Public.typeOf()](#31-精确类型判定publictypeof)
  - [3.2 误差消除与修正：zeroCorrect 与 integerCorrect](#32-误差消除与修正zerocorrect-与-integercorrect)
  - [3.3 理想化显示格式化：Public.idealizationToString()](#33-理想化显示格式化publicidealizationtostring)
  - [3.4 多项式符号化还原：Public.funcToString()](#34-多项式符号化还原publicfunctostring)
  - [3.5 表达式词法切分器：Public.tokenizer()](#35-表达式词法切分器publictokenizer)

---

## 1. 计算配置与高精度常数表：CalcConfig

`CalcConfig`（位于 `src/js/shared_code_and_configuration.js`）是整个计算器运行环境的**全局配置中枢**。它集中维护了所有精度标准、计算边界、以及多达数百位有效数字的数学物理常数。

### 1.1 关键边界阈值与性能限制常量

为了防止超长表达式引发浏览器无响应或内存耗尽，系统设定了清晰的安全限制：

| 常量名称 | 预设值 | 含义与设计考量 |
| :--- | :--- | :--- |
| **`MAX_GLOBAL_CALC_ACCURACY`** | `220` | 系统允许设置的最高全局计算精度（有效位数）。220 位足以满足几乎所有科学与工程需求。 |
| **`MAX_INPUT_STRING_LENGTH`** | `120,459` | 输入表达式的最大允许字符长度。 |
| **`MAX_TO_STRING_LENGTH`** | `120,459` | 结果转换为普通十进制字符串时的最大长度，防止大数展开耗尽内存。 |
| **`MIN_INPUT_EXPONENT`** | `-2026` | 允许的最小十进制指数（过小的数视为下溢归零）。 |
| **`MAX_INPUT_EXPONENT`** | `2022` | 允许的最大十进制指数（超出视为指数上溢）。 |
| **`TO_STRING_AUTOMATIC_SWITCH_LENGTH`** | `10` | 自动切换普通小数与科学记数法的位数阈值。 |
| **`RADICAL_FUNCTION_MAX_SHOW_RESULTS`** | `20` | 复数根式分析在界面上展开展示的具体数值根数量上限。 |
| **`VALUE_LIST_MAX_SHOW_RESULTS`** | `999` | 函数数表单次生成的最大行数，防止大规模循环阻滞线程。 |

### 1.2 高精度预计算常数表 (constants)

为了在高精度计算超越函数时避免反复通过级数展开重新计算常数，`CalcConfig.constants` 预编译并缓存了一组高达 220~420 位精度的核心数学常量：

- **`pi`**：圆周率 $\pi$（前 220+ 位）
- **`e`**：自然对数底数 $e$
- **`ln2`**：$\ln(2)$
- **`ln10`**：$\ln(10)$
- **`sqrt2`**：$\sqrt{2}$
- **`sqrt3`**：$\sqrt{3}$
- **`sqrt5`**：$\sqrt{5}$
- **`oneDivPi`**：$1/\pi$
- **`oneDivTwoPi`**：$1/(2\pi)$
- **`twoDivSqrtPi`**：$2/\sqrt{\pi}$
- **`gammaLanczosCoeffs`**：用于高精度计算伽马函数 $\Gamma(z)$ 的 Lanczos 展开系数数组（内部计算精度达 420 位）。

```javascript
// 读取内置超高精度常数
console.log(CalcConfig.constants.pi);
// "3.14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798214808651328230664709384460955058223172535940812848111745028410270193852110555964462294895493038196..."
```

### 1.3 动态响应式配置属性与 Worker 自动同步

主线程修改 `CalcConfig` 的属性时，内置的 setter 会**自动将变动异步推送到子线程 Worker**，确保双端环境始终一致：

```javascript
// 1. 修改全局计算精度（1 ~ 220）
CalcConfig.globalCalcAccuracy = 150;
console.log(CalcConfig.globalCalcAccuracy); // 150

// 2. 修改输出精度策略
// >= 1: 绝对保留位数；(0, 1): 占计算精度的比例；<= 0: 保持与计算精度一致
CalcConfig.outputAccuracy = 0.8; // 保留 80% 的有效数字

// 3. 修改复数输出模式
CalcConfig.globalPrintMode = 'polar'; // 'algebra' (代数式) 或 'polar' (极坐标式)
```

---

## 2. 词法字典与操作符优先级：TokenConfig

`TokenConfig` 集中定义了计算器所支持的全部数学词元（Tokens）、语法角色及其执行优先级。

### 2.1 词元 (Token) 分类体系

1. **二元中缀运算符 (`PlaceMiddleSet`)**：
   - `+`, `-`, `*`, `/`, `mod`, `^`, `E`（科学记数指数）, `&`（隐式乘法标记）, `[toPolar]`
2. **一元前缀函数与操作符 (`PlaceFrontSet`)**：
   - 单参数超越函数：`sqrt`, `cbrt`, `ln`, `lg`, `exp`, `sin`, `cos`, `tan`, `arcsin`, `arccos`, `arctan`, `sh`, `ch`, `th`, `arsh`, `arch`, `arth`, `re`, `im`, `conj`, `abs`, `sgn`, `floor`, `ceil`, `gamma`, `f`, `g`
   - 双参数函数：`log`, `nroot`
   - 内部前缀负号：`N`（即取负运算 `_oppositeNumber`）
3. **一元后缀运算符 (`PlaceBackSet`)**：
   - 阶乘：`!`
   - 角度转弧度单位：`[degree]`
4. **保留数值词元 (`codeNumbers`)**：
   - `[pi]`（圆周率 $\pi$）, `[e]`（自然底数 $e$）, `[i]`（虚数单位 $i$）, `[x]`（代数自变量 $x$）
5. **结构符号 (`other`)**：
   - `(`, `)`, `,`（参数分隔符）, `|`（绝对值区间）

### 2.2 优先级映射 (priorityMap) 与结合性规则

调度场算法依赖于精确的操作符优先级矩阵：

| 优先级 (Priority) | 操作符 / 词元 | 结合性 (Associativity) |
| :---: | :--- | :---: |
| **最高** | 函数调用（`sin`, `cos`, `sqrt`, `f` 等） | 右结合 (`rightAssocFunc`) |
| **高** | 乘方 `^`, 科学记数法 `E`, 阶乘 `!` | `^` 为右结合，其余为左结合 |
| **中** | 乘法 `*`, 除法 `/`, 取余 `mod` | 左结合 |
| **低** | 加法 `+`, 减法 `-` | 左结合 |
| **极低** | 极坐标标记 `[toPolar]` | 左结合 |

### 2.3 词元元数据获取：getTokenInfo()

通过 `Public.getTokenInfo(token)` 可实时获取任意符号的完整特征元数据：

```javascript
const info = Public.getTokenInfo("sin");
console.log(info);
/* 输出:
{
  token: "sin",
  class: "func",          // 类别: func / number / other / illegal
  params: 1,              // 参数个数: 1 或 2
  funcPlace: "front",     // 位置: front (前缀), middle (中缀), back (后缀)
  priority: 15,           // 调度场运算优先级
  isRightAssoc: true,     // 是否右结合
  needParens: true        // 是否需要强制括号包围参数
}
*/
```

---

## 3. 通用基础工具类：Public

`Public` 提供了一系列零依赖的全局实用辅助工具。

### 3.1 精确类型判定：Public.typeOf()

JavaScript 的 `typeof` 无法区分 `Array`、`Object`、`null` 以及自定义类。`Public.typeOf()` 通过截取 `Object.prototype.toString.call(value)`，返回标准化的小写类型全称：

```javascript
Public.typeOf(123);                     // "number"
Public.typeOf(10n);                     // "bigint"
Public.typeOf("text");                  // "string"
Public.typeOf([1, 2]);                  // "array"
Public.typeOf(new BigNumber(1));        // "bignumber"     (依赖 [Symbol.toStringTag])
Public.typeOf(new ComplexNumber("1+i"));// "complexnumber" (依赖 [Symbol.toStringTag])
```

### 3.2 误差消除与修正：zeroCorrect 与 integerCorrect

- **`Public.zeroCorrect(x, ...refs)`**：
  高精度数值分量归整工具。采用双模式相对量级比对算法，彻底废除固定绝对阈值，从根本上区分“灾难性抵消产生的浮点尾噪”与“真实的物理微小量”：
  - **无参调用（`Public.zeroCorrect(x)`）**：
    仅在复数内部比对实部与虚部的数量级。若其中一个分量相对于另一分量小超过当前有效位阈值（$\text{tol} = \max(\lfloor 0.9 \cdot acc \rfloor, acc - 8)$），则将该微弱分量归零。**纯实数或纯虚数小量（如普朗克常数 $6.626 \times 10^{-34}$ 或 $10^{-40}$）不会受到任何截断误杀**。
  - **带参考尺度调用（`Public.zeroCorrect(x, ...refs)`）**：
    以所有传入的 `...refs`（可包含数值、数组、BigNumber 或 ComplexNumber）中的最大十进制数量级 $\text{refMag}$ 作为基准尺度。若 $x$ 的实部或虚部分量比参考尺度小超过 $\text{tol}$，则判定为有效运算抵消尾部误差，执行安全相对归零。
- **`Public.integerCorrect(n)`**：
  自动侦测并校正非常接近整数的浮点数（例如开方或除法产生的 `4.99999999999999999999` $\to$ `5`）。

### 3.3 理想化显示格式化：Public.idealizationToString()

`Public.idealizationToString(x, { acc, printMode, mode })` 是用户界面屏幕渲染前最重要的格式化器：
- **动态底噪过滤**：结合 `BigNumber` 的 `noiseMag`（截断噪声上界追踪），若分量数值的有效量级已完全落入累计噪声底限（$\text{getMag}(bn) \le bn.\text{noiseMag} + 4$），直接判定为无效浮点抵消残差，安全格式化为 `"0"`（如链式运算 $1/3 \times 3 - 1$ 或 $\sqrt{2}^2 - 2$）。
- **智能去冗余**：智能剔除多余的尾随 `0` 与无效小数点（如 `"12.500000"` $\to$ `"12.5"`）。
- **实数降级呈现**：若复数的虚部在当前显示精度下四舍五入后为 0，自动降级为纯实数格式输出，不呈现多余的 `+0[i]`。
- **坐标模式切换**：支持极坐标与代数形式间的优雅显示切换。

### 3.4 多项式符号化还原：Public.funcToString()

将一个多项式系数列表（如四次多项式系数 `[a, b, c, d, e]`）自动生成为符合人类阅读习惯的代数降幂多项式字符串：

```javascript
// 系数对应: 1*x^3 - 3*x + 2
const exprStr = Public.funcToString([0, 1, 0, -3, 2], 'normal', '[x]');
console.log(exprStr); // "[x]^3-3[x]+2"
```

### 3.5 表达式词法切分器：Public.tokenizer()

```javascript
Public.tokenizer(str, { baseNumberMode = 'separate', strictMode = true } = {})
```

负责将连续的输入字符切分为规范的词元流。
- 能够识别 `12.34` 是一个独立的数字，而不是 `1`、`2`、`.`、`3`、`4` 的简单字符拼合。
- 自动提取 `[pi]`、`[toPolar]` 等括号标签。
- 在 `strictMode: true` 下，检测到非法未注册字符会立即标记并报错。
