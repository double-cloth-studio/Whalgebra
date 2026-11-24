# 数学分析工具与格式化入口

同步实现位于 `src/js/core_computational_logic.js`。浏览器界面应优先使用同名 `WorkerTools` 方法；两者结果结构一致，Worker 版本返回 Promise。以下示例在计算器页面控制台运行。

## 多项式：PowerFunctionTools

`powerFunctionAnalysis([a,b,c,d,e])` 分析 `ax^4+bx^3+cx^2+dx+e`。固定传入 5 个实系数，低次多项式高位补零，前导零会自动降阶。支持零次至四次多项式，不是任意表达式的符号微积分接口。

```javascript
const analysis = PowerFunctionTools.powerFunctionAnalysis([0, 0, 1, 0, -1]);
console.log(analysis.roots);        // ["-1", "1"]
console.log(analysis.minimumPoint); // [["0", "-1"]]
console.log(analysis.range);        // ["-1", "+inf"]
```

| 字段 | 结构与含义 |
| --- | --- |
| `equation` | 格式化的多项式字符串 |
| `range` | 值域端点 `[left,right]` |
| `increasingInterval` / `decreasingInterval` | 递增 / 递减区间数组 |
| `maximumPoint` / `minimumPoint` | 极大 / 极小值点数组，每项为 `[x,y]` |
| `convexInterval` / `concaveInterval` | 按实现分别对应二阶导数小于 / 大于零的区间 |
| `inflectionPoint` | 拐点坐标数组 |
| `roots` | 实根与复根字符串数组 |

区间、坐标、根均为显示字符串；无穷端点使用 `-inf`、`+inf`，不适用的区间或点使用 `[["null","null"]]`。常数多项式等特殊输入的根也可能返回占位信息，消费结果时不要将所有字符串直接转成 Number。

## 复根：RadicalFunctionTools

`radicalFunctionAnalysis(z,n)` 求正整数次复根，返回 `z`、`n`、`formula`、`kRange`、`numericalResults`、`overflow`。

```javascript
const roots = RadicalFunctionTools.radicalFunctionAnalysis(1, 2);
console.log(roots.numericalResults); // ["1", "-1"]
console.log(roots.kRange);           // ["0", "1"]
```

`formula` 是包含 `[k]` 和 `[toPolar]` 的极坐标通式。非零被开方数的序号范围为 `0…n-1`，数值根最多返回 20 项，超出时 `overflow: true`，其余根可按通式计算。被开方数为零时只返回一个零根，`kRange` 为 `["0","0"]`，不截断。

## 数表：FuncValueListTools

`valueList(f,g,start,step,end)` 生成两个函数在同一自变量序列上的值。区间须为实数且 `start<=end`，步长须为正实数。按 `start+k*step` 取点，不为命中终点调整最后一步。

```javascript
const table = FuncValueListTools.valueList("[x]^2", "2[x]", -1, 0.5, 1);
console.log(table.varList); // ["-1", "-0.5", "0", "0.5", "1"]
console.log(table.f);       // ["1", "0.25", "0", "0.25", "1"]
console.log(table.g);       // ["-2", "-1", "0", "1", "2"]
```

返回 `{varList,f,g}`，三个数组按索引对齐。单点计算失败或函数为空时填入 `"error"`，不影响其他点。最多生成 999 个采样点，超限时 `varList` 追加 `[print_content_omit]`，两个函数数组同位置追加 `[not_applicable]`。

## 统计：StatisticsTools

`statisticsCalc(listA,listB)` 接收等长、非空的成对实数样本，不改写原数组。返回统计量及七种回归模型，数值字段均为字符串。

```javascript
const stats = StatisticsTools.statisticsCalc([1, 2, 3], [2, 4, 6]);
console.log(stats.averageA); // "2"
console.log(stats.r);        // "1"，皮尔逊相关系数
console.log(stats.linear.R2); // "1"
console.log(stats.linear.regressionEquation); // "2[x]"
```

### 统计字段

| 字段 | 含义 |
| --- | --- |
| `n` | 样本数量 |
| `averageA/B`、`sumA/B`、`sum2A/B` | 均值、总和、平方和，A/B 分别对应两列 |
| `totalVarianceA/B`、`sampleVarianceA/B` | 总体 / 样本**标准差**，历史字段名虽含 Variance，结果已开平方 |
| `maxA/B`、`minA/B` | 各列极值 |
| `dotAB`、`dotA2B` | Σxy、Σx²y |
| `totalCovariance`、`sampleCovariance` | 总体 / 样本协方差 |
| `r` | 皮尔逊相关系数 |

单样本的样本标准差、样本协方差以及不可计算的相关系数等使用 `"error"`。输入长度不符、为空或含非零虚部会抛错。

### 回归模型

| 键 | 方程 | 定义域要求 |
| --- | --- | --- |
| `linear` | y=a+bx | 实数样本 |
| `square` | y=a+bx+cx² | 足够样本和非奇异方程组 |
| `ln` | y=a+b·ln(x) | x 全部为正 |
| `exp` | y=a·e^(bx) | y 非零且同号，允许全负 |
| `abx` | y=a·b^x | y 非零且同号，允许全负 |
| `axb` | y=a·x^b | x 全正，y 非零且同号 |
| `reciprocal` | y=a+b/x | x 非零 |

各模型返回 `parameter`、`regressionEquation`、`R2` 和 `model`。定义域不满足、样本不足或方程组奇异时仍保留字段，以 `"error"` 占位。`bestModel` 按原始 y 尺度的 R² 比较选择；使用前仍需检查该模型的 `R2`，全部失败时不能把默认模型名视为拟合成功。

全零因变量也需要满足各模型的定义域及参数唯一性要求，不会无条件生成零系数。即使能够返回方程 `"0"`，因 y 的总离差为零，`R2` 仍为 `"error"`；例如 x 为 `[1,2,3]`、y 为 `[0,0,0]` 时，线性模型可返回零系数，而指数模型仍不适用。

```javascript
const best = stats[stats.bestModel];
if (best.R2 !== 'error') {
    console.log(best.regressionEquation);
}
```

## CalcTools.exec：同步格式化计算

```javascript
CalcTools.exec(expr, {
    printMode: CalcConfig.globalPrintMode,
    calcAcc: CalcConfig.globalCalcAccuracy,
    outputAcc: CalcConfig.outputAccuracy,
    calcMode: 'calc',
    outputMode: 'output',
    f, g
});
```

返回 `{result,expr}`。`calcAcc` 控制本次计算精度，不修改全局配置；`outputAcc>=1` 表示输出有效位数，`0<outputAcc<1` 表示比例，`outputAcc<=0` 表示沿用计算精度。`printMode` 为 `algebra` 或 `polar`；`calcMode` 为 `calc` 或 `syntaxCheck`。

```javascript
const r = CalcTools.exec("1/3", { calcAcc: 60, outputAcc: 8 });
console.log(r.result); // "0.33333333"

const mid = CalcTools.exec("1/3", { calcAcc: 30, outputMode: 'mid' });
const value = new ComplexNumber(mid.result);
console.log(value.toString({ acc: 8 })); // "0.33333333"
```

`outputMode: 'output'` 返回经过 `Public.idealizationToString` 归整的字符串；`'mid'` 返回实部、虚部的 `[power,bigintMantissa,acc]` 元组。元组保留当前数值精度，但不携带噪声追踪元数据，不能直接 JSON 序列化。若要继续组合运算并保留误差传播，应使用 `MathPlus.calc` 返回的数值对象，详见[数值构造器](./math_engine_and_constructors.md#噪声状态与对象传递)。
