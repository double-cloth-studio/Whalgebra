# 配置、词元与公共工具

实现位于 `src/js/shared_code_and_configuration.js`，先于计算核心加载。

## CalcConfig

| 配置 | 核心默认值 | 含义 |
| --- | --- | --- |
| `globalCalcAccuracy` | `220` | 计算有效位数，允许 1–220 的整数 |
| `outputAccuracy` | `0.9` | 输出精度策略 |
| `globalPrintMode` | `'algebra'` | `'algebra'` 或 `'polar'` |

输出策略：`>=1` 为绝对有效位数，`0<acc<1` 为计算精度的比例，`<=0` 为沿用计算精度。绝对输出精度受计算精度限制。页面会在初始化时应用保存的精度档位，不能把核心默认值等同于界面当前值。

```javascript
// 单次调用覆盖配置，便于得到可复现结果
const r = CalcTools.exec("1/3", { calcAcc: 60, outputAcc: 8 });
console.log(r.result); // "0.33333333"

// 应用级设置：同时设置计算与输出精度
CalcConfig.setAccuracy(120, 30);
CalcConfig.globalPrintMode = 'algebra';
```

主线程 setter 在 Worker 已可用时异步同步配置；Worker 尚未创建时保留主线程状态，首次创建时读取快照。降低计算精度也会收紧已有绝对输出精度。单次计算优先使用调用参数，界面精度档位由 `PageConfig` 管理。

### 当前边界

| 常量 | 值 | 用途 |
| --- | --- | --- |
| `MAX_GLOBAL_CALC_ACCURACY` | `220` | 全局精度上限 |
| `MAX_INPUT_STRING_LENGTH` | `120459` | 数值输入字符串长度限制 |
| `MAX_TO_STRING_LENGTH` | `120459` | 数值展开字符串长度限制 |
| `MIN_INPUT_EXPONENT` / `MAX_INPUT_EXPONENT` | `-2026` / `2022` | 数值字符串输入的指数边界 |
| `TO_STRING_AUTOMATIC_SWITCH_LENGTH` | `10` | 自动科学记数显示阈值 |
| `RADICAL_FUNCTION_MAX_SHOW_RESULTS` | `20` | 复根数值解展示上限 |
| `VALUE_LIST_MAX_SHOW_RESULTS` | `999` | 数表采样行数上限，不含省略标记 |

输入指数限制与内部安全整数指数范围是不同约束，不应把前者理解为所有中间结果的统一范围。

### 内置常数

`CalcConfig.constants` 惰性解析并缓存常数，如 `pi`、`e`、`ln2`、`ln10`。常数通常以 `[power, bigintMantissa, acc]` 元组提供，**不是十进制字符串**。

```javascript
const pi = new BigNumber(CalcConfig.constants.pi);
console.log(pi.toString({ acc: 10 })); // "3.141592654"
```

常数表也含算法辅助数据；完整键名和数据结构以源码为准，业务代码不应改写缓存。

## TokenConfig 与 Public.getTokenInfo

`TokenConfig` 维护词元集合、参数个数、前/中/后缀位置和结合性。常数为 `[pi]`、`[e]`、`[i]`、`[x]`；伽马函数的表达式词元为 `[gamma]`。`A`、`N`、`&` 是解析器内部词元，不能直接作为用户输入。

优先级数字越小越高，按当前实现排列：

| priority | 词元 |
| --- | --- |
| 0 | 前缀函数及内部绝对值 `A` |
| 1 | `!`、`[degree]` |
| 2 | `^` |
| 3 | 一元负号 `N` |
| 4 | 隐式乘法 `&` |
| 5 | 科学记数 `E`、极坐标 `[toPolar]` |
| 6 | `*`、`/`、`mod` |
| 7 | `+`、`-` |

一元前缀运算与 `^` 为右结合。不要用普通乘法优先级推断隐式乘法行为。

```javascript
const info = Public.getTokenInfo("sin");
console.log(info.parameters);    // 1
console.log(info.funcPlace);     // "front"
console.log(info.priority);      // 0
console.log(info.associativity); // "right"
console.log(info.needKh);        // true
```

固定词元元信息缓存并冻结，调用方应只读访问。

## 常用 Public 方法

| 方法 | 用途 |
| --- | --- |
| `typeOf(value)` | 返回小写类型名，如 `array`、`bignumber`、`complexnumber` |
| `tokenizer(str, options)` | 分词；默认 `baseNumberMode: 'separate'`、`strictMode: true` |
| `zeroCorrect(x, ...refs)` | 按噪声、分量和可选参考尺度归零，返回复数对象 |
| `integerCorrect(x)` | 修正精度范围内接近整数的结果 |
| `idealizationToString(x, options)` | 按输出精度归整并格式化，分析工具和显示层使用 |
| `funcToString(list, mode, asX)` | 将系数还原为表达式，具体顺序取决于 mode |

误差归整用于处理有限精度残差，不代表任意小数都应归零。调用时保留数值对象的精度与噪声信息，避免先转原生 Number 再转换回来。
