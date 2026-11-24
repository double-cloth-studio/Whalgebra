# 计算引擎与数值构造器

实现位于 `src/js/core_computational_logic.js`，依赖先加载的 `shared_code_and_configuration.js`。示例在计算器页面控制台运行。

## MathPlus.calc：表达式求值

```javascript
MathPlus.calc(expr, {
    unknown, f, g,
    mode: 'calc',
    acc: CalcConfig.globalCalcAccuracy
});
```

返回 `[ComplexNumber, canonicalExpr]`。`unknown` 为 `[x]` 的代入值，`f`、`g` 为单参数函数体；`acc` 是本次计算的有效位数。`mode: 'syntaxCheck'` 仅检查并规范化语法，数值位置返回占位值，不能作为计算结果使用。

```javascript
const [value] = MathPlus.calc("f(3)+g(2)", {
    f: "[x]^2+1",
    g: "2[x]",
    acc: 60
});
console.log(value.toString()); // "14"

const [, normalized] = MathPlus.calc("2(3+4", { mode: 'syntaxCheck' });
console.log(normalized); // "2[cdot](3+4)"
```

解析器支持隐式乘法、末尾括号补全、绝对值、科学记数法和函数嵌套。`canonicalExpr` 使用内部词元，不一定与输入文本相同。函数可以互相引用，但递归环会报错。输入错误和数学错误通过异常报告。

## 常用语法与静态方法

| 功能 | 表达式示例 | 对应静态方法 |
| --- | --- | --- |
| 四则与余数 | `2+3*4`、`7mod3` | `plus`、`minus`、`times`、`divide`、`mod` |
| 幂与根 | `2^10`、`sqrt(-1)`、`nroot(16,4)` | `pow`、`sqrt`、`cbrt`、`nroot` |
| 指数和对数 | `exp(1)`、`ln([e])`、`log(2,8)` | `exp`、`ln`、`lg`、`log` |
| 三角与反三角 | `sin([pi]/6)`、`arctan(1)` | `sin`、`cos`、`tan`、`arcsin`、`arccos`、`arctan` |
| 双曲与反双曲 | `sh(1)`、`arsh(1)` | `sh`、`ch`、`th`、`arsh`、`arch`、`arth` |
| 复数分量 | `re(3+4[i])`、`abs(3+4[i])` | `re`、`im`、`conj`、`abs`、`arg`、`sgn` |
| 阶乘与伽马 | `5!`、`[gamma](5)` | `fact`、`gamma` |
| 取整 | `floor(1.5)`、`ceil(1.5)` | `floor`、`ceil` |
| 角度与极坐标 | `sin(30[degree])`、`2[toPolar]0` | `degree`、`toPolar` |

`log(a,b)` 表示以 `a` 为底、`b` 为真数；`nroot(a,b)` 表示 `a` 的 `b` 次根的一个结果，分支沿用 `pow`，负实数的奇次根优先取实根。枚举全部正整数次复根使用 [RadicalFunctionTools](./advanced_analysis_tools.md)。三角函数和极坐标辐角均以弧度计，角度输入需显式使用 `[degree]`。

全部静态方法的计算原理、逐项示例和分支限制见 [MathPlus 函数说明](./mathplus_functions.md)。

静态数学方法通常返回 `ComplexNumber`，参数可用数值、数值字符串或数值对象。表达式字符串应先交给 `MathPlus.calc`，不要把 `"2+3"` 当普通数值传给构造器或算术方法。

## BigNumber：十进制数

```javascript
new BigNumber(x, { acc, pow: 0, noiseMag });
```

内部表示为 `mantissa × 10^power`，其中 `mantissa` 为 `bigint`、`power` 为安全整数，`acc` 为有效位数，`noiseMag` 跟踪舍入噪声量级。支持十进制/科学记数法字符串、有限 `number`、`bigint`、已有实例和 `[power, mantissa, acc]` 元组。

```javascript
const a = new BigNumber("12345678901234567890.125", { acc: 30 });
console.log(a.toString({ mode: 'normal' })); // "12345678901234567890.125"
console.log(new BigNumber("12.34", { acc: 30 }).valueOf()); // [-2, 1234n, 30]
console.log(new BigNumber("3.14159265").toString({ acc: 5 })); // "3.1416"
```

常用实例方法：`isZero()`、`isPositive()`、`isNegative()`、`toString()`、`valueOf()`。数量级通过静态方法 `BigNumber.getMag(value)` 获取，零返回 `-Infinity`；`BigNumber.decimalLengthBigInt(n)` 返回整数绝对值的十进制位数（零为 1），`BigNumber.pow10(n)` 返回非负整数次的 `10n` 幂。

`toString({ acc, mode })` 的 `mode` 可取 `auto`、`normal`、`scientific`。`valueOf()` **返回内部元组，不是原生 Number**；请通过 `MathPlus` 运算，不要使用 JavaScript 的 `+` 等操作符组合这些对象。高精度输入优先用字符串或 `bigint`，已经在原生浮点计算中损失的位数无法恢复。

## ComplexNumber：复数

```javascript
new ComplexNumber(x, { acc, pow: 0, noiseMag });
```

支持 `"3+4[i]"`、`"3+4i"` 等复数字符串、实数、`BigNumber`、`[real, imag]`、内部元组和已有复数实例。`re`、`im` 均为 `BigNumber`，`onlyReal` 表示虚部为零，分量精度按较低值对齐。

```javascript
const z = new ComplexNumber("3+4[i]", { acc: 50 });
console.log(z.toString({ printMode: 'algebra' })); // "3+4[i]"
console.log(z.toString({ printMode: 'polar', acc: 10 })); // "5[toPolar]0.927295218"
console.log(MathPlus.abs(z).toString()); // "5"
```

`valueOf()` 返回 `[[re.power,re.mantissa,re.acc], [im.power,im.mantissa,im.acc]]`，可交回构造器继续计算。元组含 `bigint`，不能直接用 `JSON.stringify` 序列化；它也不包含 `noiseMag`，不应当作完整误差状态快照。

## 噪声状态与对象传递

`noiseMag` 是绝对十进制噪声量级上界，`-Infinity` 表示当前没有记录到截断或舍入噪声；它与有效位数 `acc` 分开维护。输入未发生舍入时可保留 `-Infinity`，有限精度舍入和算术运算会更新噪声。加法因量级差过大而直接返回较大项时，也会将被舍弃项计入结果噪声。

复制 `BigNumber` 或 `ComplexNumber` 实例会继承噪声；通过 `pow` 选项进行十进制缩放时，噪声量级相应平移。`ComplexNumber` 的 `noiseMag` 选项还接受 `[realNoise, imagNoise]`，分别指定两分量的噪声。

`valueOf()` 和 `CalcTools.exec(..., { outputMode: 'mid' })` 的元组不保存噪声。从元组重建与直接复制对象可能产生不同的判零结果，尤其是由近似 π 得到的角度；需要保留误差传播时，应直接传递数值对象。字符串也只保留其文本表示，增加 `acc` 无法恢复已丢失的信息。

## 精度与显示

核心默认计算精度为 220，输出策略为 `0.9`；界面初始化会应用用户保存的精度档位。需要稳定、可复现的示例时，显式指定精度和显示模式。

`MathPlus.calc` 的 `acc` 控制计算精度；`toString({ acc })` 控制显示有效位数。`CalcTools.exec` 还支持输出比例和底噪归整，参数见[分析工具文档](./advanced_analysis_tools.md)。增加显示位数不会提高已有结果的计算精度，数值算法也可能因输入过大或精度不可靠而拒绝计算。

全局上限与算法内部工作精度不同：基础常数保存 440 位，若干超越函数使用额外保护位，阶乘按系数集与输入规模选择工作精度，最终仍按目标 `acc` 返回结果。实现说明见[MathPlus 函数文档](./mathplus_functions.md)。
