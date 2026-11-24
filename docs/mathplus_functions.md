# MathPlus 函数原理与用法

本文按当前[计算核心](../src/js/core_computational_logic.js)说明 MathPlus 的全部 44 个公开静态方法，以及 3 个内部辅助方法。重点是函数做什么、如何计算、怎样调用；数值对象与精度配置详见[计算引擎与构造器](./math_engine_and_constructors.md)。

## 调用约定

示例可在 `src/index.html` 或 `dist/Whalgebra.html` 的开发者控制台运行。MathPlus 是静态工具类，不能用 `new MathPlus()` 实例化。

```javascript
// 表达式入口：返回 [数值对象, 规范化表达式]
const [value] = MathPlus.calc("sin(30[degree])+sqrt(9)", { acc: 60 });
console.log(value.toString({ acc: 10, mode: 'normal', printMode: 'algebra' })); // "3.5"

// 单个函数入口：直接返回 ComplexNumber
console.log(MathPlus.plus("0.1", "0.2").toString()); // "0.3"
console.log(MathPlus.conj("3+4[i]").toString()); // "3-4[i]"
```

常规数学方法返回 `ComplexNumber`，即使结果为实数；`calc` 返回二元数组，`realPlus/realMinus/realTimes/realDivide` 返回 `BigNumber`，`oppositeNumber` 的返回类型取决于输入，详见下文。常规方法参数接受可由 `ComplexNumber` 构造的数值，例如字符串、有限 number、bigint、BigNumber、ComplexNumber 或数值元组；`"2+3"` 这样的表达式应传给 `calc`，不能当成单个数值传入。实数运算核必须直接传入 `BigNumber`。

直接调用通常从操作数继承精度，双参数方法通常取两者的较低精度；指定计算精度可使用 `calc(expr, { acc })` 或预先构造指定精度的数值对象。高精度输入优先使用字符串，`toString({ acc })` 只控制显示位数。

下表“表达式”列可作为 `MathPlus.calc` 的第一个参数。结果按 60 位计算、10 位有效数字显示；常数和超越函数的非有限小数结果均为近似值。表达式常数写作 `[pi]`、`[e]`、`[i]`，角度均以弧度计。

## 表达式求值：calc

```javascript
const [value, normalized] = MathPlus.calc("f(3)+g(2)", {
    f: "[x]^2+1",
    g: "2[x]",
    acc: 60
});
console.log(value.toString()); // "14"

const [, syntax] = MathPlus.calc("2(3+4", { mode: 'syntaxCheck' });
console.log(syntax); // "2[cdot](3+4)"
```

`calc(expr, { unknown, f, g, mode = 'calc', acc = CalcConfig.globalCalcAccuracy })` 先分词，再补全隐式乘法、正负号、绝对值和缺失括号，最后用调度场算法按优先级操作数值栈与运算符栈，调用下文的数学方法完成求值。

- 返回 `[ComplexNumber, canonicalExpr]`，第二项是规范化表达式。
- `unknown` 为 `[x]` 的代入值；`f`、`g` 为单参数函数体，调用写作 `f(3)`、`g(2)`。可引用另一函数，递归环会报错。
- `mode: 'syntaxCheck'` 只检查和规范化语法，返回的数值是占位值，不执行函数的数学定义域检查。
- 缺少变量、未定义函数、语法错误或无效运算会抛出异常。优先级见[词元配置](./configuration_and_utilities.md)。

## 基础运算

| 静态方法 | 原理与用法 | 表达式 | 结果 |
| --- | --- | --- | --- |
| `plus(a, b)` | 加法。实数对齐十进制指数后合并整数尾数；复数分别相加实部、虚部。 | `2+3` | `5` |
| `minus(a, b)` | 减法，以加上 b 的相反数实现。 | `2-3` | `-1` |
| `times(a, b)` | 乘法。实数尾数相乘、指数相加；复数按分配律展开并使用 i² = -1。 | `(1+[i])*(1-[i])` | `2` |
| `divide(a, b)` | 除法。实数扩大尾数后做整数除法并保留保护位；复数乘除数共轭后有理化。b 不能为零。 | `(3+4[i])/(1-2[i])` | `-1+2[i]` |
| `mod(a, b)` | 定义为 a - b × floor(a/b)。实数通过整数尾数取模并调整符号；复数使用分量取整后的商。b 不能为零。 | `(-7)mod3` | `2` |
| `exponential(a, b)` | 十进制缩放 a × 10^b，复用 pow 与 times；常用于科学记数法，与自然指数 exp 不同。 | `1.23E3` | `1230` |

实数 mod 的非零余数与除数同号，例如 `7mod(-3)` 得到 `-2`；其行为不同于 JavaScript 的 `%`。复数 mod 是本项目的分量取整约定。

基础运算会传递操作数噪声；加法在量级差过大、直接保留较大项的快路径中，也记录被舍弃项的噪声上界。继续运算时保留数值对象，避免通过元组重建丢失误差信息，详见[噪声状态](./math_engine_and_constructors.md#噪声状态与对象传递)。

### 实数运算核与取反

`plus/minus/times/divide` 在纯实输入时直接调用实数运算核，减少复数对象的构造；对外仍返回 `ComplexNumber`。已有 `BigNumber` 且只需实数结果时，可直接调用以下方法，它们不修改原对象。

| 静态方法 | 输入与返回 |
| --- | --- |
| `realPlus(a,b)` | 两个 `BigNumber` 相加，返回 `BigNumber` |
| `realMinus(a,b)` | 两个 `BigNumber` 相减，返回 `BigNumber` |
| `realTimes(a,b)` | 两个 `BigNumber` 相乘，返回 `BigNumber` |
| `realDivide(a,b)` | 两个 `BigNumber` 相除，返回 `BigNumber`；除数为零时抛错 |
| `oppositeNumber(x)` | 取反并保留精度与噪声；`BigNumber` 输入返回 `BigNumber`，其他支持输入返回 `ComplexNumber` |

实数运算核按操作数的较低精度返回结果，并传播噪声。`oppositeNumber` 是当前公开名称，旧的 `_oppositeNumber` 已移除。

```javascript
const a = new BigNumber("0.1", { acc: 60 });
const b = new BigNumber("0.2", { acc: 60 });
console.log(MathPlus.realPlus(a, b).toString()); // "0.3"
console.log(MathPlus.oppositeNumber(a).toString()); // "-0.1"
```

## 幂、根、指数与对数

| 静态方法 | 原理与用法 | 表达式 | 结果 |
| --- | --- | --- | --- |
| `pow(a, b)` | 求 a^b。实底数整数幂按规模选择原生 BigInt 幂或平方乘快速幂，负整数指数再取倒数；一般情况结合 ln、exp 或极坐标计算。 | `2^10` | `1024` |
| `sqrt(x)` | 平方根。实数先按十进制指数缩放，再用牛顿公式 u ← (u + x/u)/2；负实数返回正虚根，复数通过 pow 求主平方根。 | `sqrt(-4)` | `2[i]` |
| `cbrt(x)` | 立方根。实数缩放后用 u ← (2u + x/u²)/3 迭代，并保留原符号；一般复数通过 pow 求主立方根。 | `cbrt(-8)` | `-2` |
| `nroot(a, b)` | 求 a 的 b 次根，通过 pow(a, 1/b) 得到一个结果，分支沿用 pow；b 不能为零。 | `nroot(-8,3)` | `-2` |
| `exp(x)` | 自然指数 e^x。实数拆分整数与小数部分，小数缩小后用泰勒级数并取十次幂还原；复数使用 e^(a+bi) = e^a(cos b + i sin b)。 | `exp(1)` | `2.718281828` |
| `ln(x)` | 自然对数。正实数缩放到 1 附近，以 t = (x-1)/(x+1) 展开 2(t + t³/3 + …)，再补回缩放量；其他非零复数用 ln(abs(x)) + i arg(x)。 | `ln(-1)` | `3.141592654[i]` |
| `lg(x)` | 常用对数，通过 ln(x)/ln(10) 换底。 | `lg(100)` | `2` |
| `log(a, b)` | 以 a 为底、b 为真数的对数，通过 ln(b)/ln(a) 换底。 | `log(2,8)` | `3` |

平方根、立方根迭代若异常，会回退到 ln/exp 或 pow 路径。整数幂会估算结果规模并保留保护位；超过可表示规模时可能报错，极小结果可能归零。

`sqrt/cbrt/exp/ln/sin/cos/arctan` 在目标精度之外使用 6 位内部保护位，再按输入精度返回结果。保护位用于减少中间舍入误差，不会提高输入本身的可靠精度；基础常数的存储精度见[常数配置](./configuration_and_utilities.md#内置常数)。

分支与定义域需注意：

- `0^0`、零的负次幂、`ln(0)` 无定义；对数底 a 不能为 0 或 1，真数 b 不能为 0。负实数和复数对数允许返回复数。
- 复对数采用 `arg(x)` 的主辐角。一般复数幂以此选取一个分支，不返回多值集合。
- **负实数开奇次根优先取实根。** pow 对非整数实指数会检查其倒数能否经整数修正判为奇整数，因此 `(-8)^(1/3)` 和 `nroot(-8,3)` 都得到 `-2`；不能笼统视作复对数主值幂。负实数的其他非整数幂通常通过模长与 bπ 的三角值组合。
- `nroot` 不枚举全部根；需要全部正整数次复根时用 [RadicalFunctionTools](./advanced_analysis_tools.md)。

`log` 对 `ln(a)` 按其自身噪声判零，不额外使用 1 作为参考尺度，因此能保留精确输入中接近 1 的合法底数。例如按 60 位计算、10 位输出，`log(1.000000000000000000000000000001,2)` 得到约 `6.931471806E+29`；底数恰为 1 仍会报错。

## 三角与反三角函数

| 静态方法 | 原理与用法 | 表达式 | 结果 |
| --- | --- | --- | --- |
| `sin(x)` | 正弦。实数按周期、象限归约，再除以 3 缩小参数，用泰勒级数与三倍角公式还原；复数用 (e^(ix) - e^(-ix))/(2i)。 | `sin(30[degree])` | `0.5` |
| `cos(x)` | 余弦。实数归约后再除以 4，用泰勒级数与四倍角公式还原；复数用 (e^(ix) + e^(-ix))/2。 | `cos([pi])` | `-1` |
| `tan(x)` | 正切，计算 sin(x)/cos(x)，除法前对接近零的余弦做噪声修正。 | `tan([pi]/4)` | `1` |
| `arcsin(x)` | 反正弦。实数 [-1,1] 用 arg(sqrt(1-x²) + ix)；区间外实数分段用对数公式，复数用 -i ln(ix + sqrt(1-x²))。 | `arcsin(0.5)` | `0.5235987756` |
| `arccos(x)` | 反余弦，复用 π/2 - arcsin(x)。 | `arccos(0.5)` | `1.047197551` |
| `arctan(x)` | 反正切。实数通过倒数、半角公式缩小参数，再计算交错泰勒级数；复数用 (-i/2) ln((i-x)/(i+x))。 | `arctan(1)` | `0.7853981634` |

实数反三角函数的返回范围分别为 arcsin 的 [-π/2, π/2]、arccos 的 [0, π]、arctan 的 (-π/2, π/2)。arcsin、arccos 的实数输入超出 [-1,1] 时返回复数；arctan 的输入 ±i 为奇点。tan 在余弦为零时抛错。极大实角可能因相位精度不足而警告或被拒绝。

实角归约会同时考虑输入噪声、归约运算噪声及内置常数的有限精度。需要周期或象限变换时才清理相位残差；无需变换时保留原角度及其精度、噪声。精确大角度的数量级不会直接用作相对判零基准，`cos` 的最终归整也不额外与 1 比较，以保留零点附近仍可分辨的小值。

```javascript
console.log(CalcTools.exec("sin(1E35)", {
    calcAcc: 36, outputAcc: 10
}).result); // "0.9575238007"
console.log(CalcTools.exec("sin(1E-100)", {
    calcAcc: 36, outputAcc: 10
}).result); // "1E-100"
```

由 `[pi]` 参与运算得到的近似整周期角度可按相位噪声归零；将同一角度转为不含噪声的元组再构造数值，可能保留非零余角。这两种输入携带的误差信息不同。

## 双曲与反双曲函数

| 静态方法 | 原理与用法 | 表达式 | 结果 |
| --- | --- | --- | --- |
| `sh(x)` | 双曲正弦 sinh，计算 (e^x - e^(-x))/2。 | `sh(1)` | `1.175201194` |
| `ch(x)` | 双曲余弦 cosh，计算 (e^x + e^(-x))/2。 | `ch(1)` | `1.543080635` |
| `th(x)` | 双曲正切 tanh，计算 (e^(2x)-1)/(e^(2x)+1)；实部为正时改用 (1-e^(-2x))/(1+e^(-2x))，也适用于复数，避免中间值溢出。 | `th(1)` | `0.761594156` |
| `arsh(x)` | 反双曲正弦，计算 ln(x + sqrt(x²+1))；负实数利用奇函数性质，避免相消。 | `arsh(1)` | `0.881373587` |
| `arch(x)` | 反双曲余弦，按 ln(x + sqrt(x-1)·sqrt(x+1)) 计算主值；实数 x≤-1 使用等价分支避免相消。 | `arch(2)` | `1.316957897` |
| `arth(x)` | 反双曲正切，计算 ln((1+x)/(1-x))/2，分母做噪声归零修正。 | `arth(0.5)` | `0.5493061443` |

以上均可接受复数。实数 arsh 的结果为实数；arch 在 x ≥ 1 时返回非负实数；arth 在 (-1,1) 内返回实数，±1 为奇点，区间外返回复数。th 的复数奇点由分母为零判断。

`arth` 对分母 `1-x` 按差值自身噪声判零，保留精确输入与 1 之间可分辨的微小差值。例如按 60 位计算、10 位输出，`arth(0.999999999999999999999999999999)` 得到约 `34.88534999`。

项目入口名称是 `sh/ch/th/arsh/arch/arth`，不要把数学名称 sinh、cosh 等当成已实现的别名。对于实数 x≤-1，`arch` 返回 ln(-x + sqrt(x²-1)) + iπ，例如 `arch(-2)` 得到约 `1.316957897+3.141592654[i]`；`arch(-1)` 得到 iπ。

## 阶乘、伽马与取整

| 静态方法 | 原理与用法 | 表达式 | 结果 |
| --- | --- | --- | --- |
| `fact(x)` | 阶乘。0–100000 的整数用 BigInt 分治求积；更大的正整数及其他非极点值以 Lanczos 近似计算 Γ(x+1)，负实部通过反射公式处理。 | `5!` | `120` |
| `gamma(x)` | 伽马函数，通过 fact(x-1) 实现。正整数 n 满足 Γ(n) = (n-1)!。 | `[gamma](5)` | `24` |
| `floor(x)` | 向下取整；实数截去小数并修正负数，复数对实部、虚部分别取整。 | `floor(-1.2)` | `-2` |
| `ceil(x)` | 向上取整；实数截去小数并修正正数，复数对实部、虚部分别取整。 | `ceil(-1.2)` | `-1` |

`0!` 为 1，负整数阶乘无定义；gamma 在零和负整数处有极点。分治路径先用 BigInt 求完整整数乘积，再按目标有效位数构造结果；超过 100000 的正整数走近似路径，避免展开完整阶乘。结果仍受内部指数范围和算法可靠性限制，不代表任意大整数的阶乘都可计算。

Lanczos 路径按目标精度选择系数集：

| 目标有效位数 acc | 系数集 | 级数求和精度 calcAcc |
| --- | --- | --- |
| ≤40 | `lanczos_n20` | 100 |
| 41–75 | `lanczos_n40` | 160 |
| 76–155 | `lanczos_n82` | 250 |
| ≥156 | `lanczos_n164` | 420 |

级数求和使用 `calcAcc` 抵抗相消；后续乘方和反射使用动态精度 `workAcc = min(calcAcc, acc + inputMag + 12)`，其中 `inputMag` 为实部、虚部十进制数量级与 0 的最大值。负实部反射时，先按最近整数归约实部，再计算正弦并恢复奇偶符号。最终按输入的 `acc` 返回结果。

```javascript
console.log(CalcTools.exec("100001!", {
    calcAcc: 60, outputAcc: 10
}).result); // "2.82425765E+456578"
```

表达式的伽马入口为 `[gamma](x)`，静态方法为 `MathPlus.gamma(x)`。复数取整示例：`floor(1.2-2.3[i])` 得到 `1-3[i]`，`ceil(1.2-2.3[i])` 得到 `2-2[i]`。

## 复数分量、模与方向

| 静态方法 | 原理与用法 | 表达式 | 结果 |
| --- | --- | --- | --- |
| `re(x)` | 提取实部，以虚部为零的新数值返回。 | `re(3+4[i])` | `3` |
| `im(x)` | 提取虚部系数，以纯实数返回，不附带 i。 | `im(3+4[i])` | `4` |
| `conj(x)` | 共轭：实部不变，虚部取反。 | `conj(3+4[i])` | `3-4[i]` |
| `abs(x)` | 实数绝对值或复数模；一般复数按 sqrt(re² + im²) 计算。也支持绝对值竖线写法。 | `abs(3+4[i])` | `5` |
| `arg(x)` | 主辐角，先算 arctan(im/re)，再按坐标轴和象限修正，返回范围 (-π,π]。 | `arg(1+[i])` | `0.7853981634` |
| `sgn(x)` | 单位方向 x/abs(x)。实数得到 -1、0 或 1；非零复数得到单位圆上的复数，零返回零。 | `sgn(3+4[i])` | `0.6+0.8[i]` |

`arg(0)` 无定义并抛错；`abs(0)`、`sgn(0)` 均为零。arg 的结果是弧度；需要角度可计算 `arg(x)*180/[pi]`。

## 角度与极坐标

| 静态方法 | 原理与用法 | 表达式 | 结果 |
| --- | --- | --- | --- |
| `degree(x)` | 将角度转为弧度，计算 x × π/180；表达式中是后缀词元。 | `180[degree]` | `3.141592654` |
| `toPolar(a, b)` | 由模长 a 和弧度 b 构造复数 a(cos b + i sin b)；表达式中是中缀词元。 | `2[toPolar]([pi]/2)` | `2[i]` |

通常给 toPolar 传入非负实模长和实辐角。名称虽为 toPolar，**返回值仍是数值对象**；它表示“按极坐标输入”，不是输出极坐标文本。显示极坐标需调用 `value.toString({ printMode: 'polar' })`。

## 内部辅助方法

下列方法是实现细节，调用者应优先使用上述公开入口。

| 方法 | 原理与内部用途 | 对应公开用法 |
| --- | --- | --- |
| `_arithmeticInput(x)` | 复用已有不可变数值实例，解析外部输入，并将纯实输入保留为 BigNumber，供基础四则运算分派。 | `MathPlus.plus/minus/times/divide`。 |
| `_customFunc(token, funcs, unknown, acc)` | 为 f/g 递归调用 calc，将实参代入 [x] 并继承精度；传递另一函数定义，移除当前函数定义，使循环调用触发未定义错误。 | `MathPlus.calc("f(3)", { f: "[x]^2+1" })`。 |
| `_toLessThanHalfPi(angle, name)` | 使用高精度 1/(2π) 进行周期归约，再用对称性映射到 [0,π/2]，返回实角 BigNumber 与象限符号乘子；发生归约时按相位噪声清理残差，未归约时保留原角度。 | sin、cos 自动调用，无需手工归约角度。 |

方法内部还定义了局部辅助函数：pow 中的对数量级估计与 fastPow 用于规模保护和快速幂；fact 中的 factorialOptimized、rangeProduct 用于分治求积；calc 中的 symbolConversion、evaluationRPN 用于词元映射与栈求值。它们没有独立的外部调用入口。

## 错误处理与页面调用

```javascript
try {
    const [value] = MathPlus.calc("log(1,8)", { acc: 60 });
    console.log(value.toString());
} catch (error) {
    console.error(error.message); // 底数为 1，ln(1)=0，触发除零错误
}

// 页面中的耗时计算使用 Worker，避免同步占用 UI 线程。
const { result } = await WorkerTools.exec("[gamma](0.5)", {
    calcAcc: 60,
    outputAcc: 10
});
console.log(result); // "1.772453851"
```

MathPlus.calc 是同步数值入口；需要格式化结果可用 CalcTools.exec，需要后台执行与取消能力可用 WorkerTools，见 [Worker 架构](./architecture_and_worker.md)。数值规模保护、有限常数精度和级数收敛限制同样适用于这些入口。
