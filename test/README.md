# 测试手册

测试分为 Node 回归、浏览器计算控制台与人工界面检查。需要 Node.js 20+，命令在项目根目录运行。

## 运行与覆盖

```powershell
npm test
# 只运行某个 Node 测试文件
node --test test/node/statistics.test.js
```

`npm test` 覆盖工具链、服务器、路径边界、数学专项测试，并复用浏览器测试逻辑执行所有 `includeInAll: true` 的 JSON 测试集。计算核心从 **`dist/Whalgebra.html`** 抽取，在 Node vm 中运行；`WorkerTools` 被同步替身代替，**不覆盖真实 Worker、DOM 或界面交互**。仅修改 `src/` 不会改变这批计算测试的输入。

专项测试包括：

- `big_number.test.js`、`noise_propagation.test.js`：数值构造、除法舍入、指数边界、噪声传播及 `mid` 响应恢复。
- `expression_compile.test.js`：复用逆波兰指令、数表只编译一次函数体及极小复数模长的舍入。
- `pow.test.js`、`power_function.test.js`：负实数的有理幂、复数整数幂和倒数、近似对称四次多项式的实根。
- `trigonometry.test.js`：36 / 220 位精度下的正负大角度（覆盖 `10^32` 至 `10^219` 中的代表值）、相位噪声判零、近似整周期及精确小角度。
- `statistics.test.js`：全零因变量时的回归定义域、样本数量和参数唯一性。
- `reverse_build.test.js`、`svg_compressor.test.js`、`server.test.js`：有效资源拆分、SVG 输出、目录清理边界和本地服务 API 约束。

实时预览的请求作废、子屏幕提交的重复执行与取消、浮层关闭顺序等界面行为仍需浏览器人工检查，详见[界面与交互](../docs/ui_and_interaction.md#修改后的人工检查)。

通过本地服务器打开 `dist/Whalgebra.html` 后，可在新加载的页面控制台执行以下命令。各项应通过。生命周期用例覆盖数表软取消后继续计算、取消探测超时后向新 Worker 派发任务、并发等待同一次重启及配置同步。虚拟列表用例覆盖恢复期间采用最新定位请求、`nearest` 保持已可见行的位置、重测失败后继续滚动及压缩滚动的负占位。注入重测失败时，控制台会出现预期的错误日志。

```js
const {runLifecycleRegressions} = await import('../test/browser/lifecycle_regression.js');
console.table(await runLifecycleRegressions());
```

真实浏览器测试：运行 `npm start`，从工作台进入 `test/web/index.html`。控制台通过 iframe 加载发行版并使用真实 Worker，可单独运行测试集、定位失败用例及运行性能基准。UI 改动仍需人工检查受影响流程。

```text
test/
├── browser/lifecycle_regression.js # Worker 与虚拟列表回归
├── browser/test_logic.js  # JSON 用例执行与性能基准
├── cases/                # 测试清单和数据
├── node/                 # node:test 测试及 vm 辅助逻辑
└── web/index.html        # 浏览器测试控制台
```

## 测试集清单

唯一清单为 `cases/test_suites.json`，不要在 UI 或执行器中复制列表。

| ID | 内容 | case 文件 | 参与全部运行 |
| --- | --- | --- | --- |
| 1 | 表达式综合分支 | `test_mathplus_calc_complex_cases.json` | 是 |
| 2 | 表达式正确分支 | `test_mathplus_calc_normal_cases.json` | 是 |
| 3 | 表达式错误分支 | `test_mathplus_calc_error_cases.json` | 是 |
| 4 | MathPlus 静态函数 | `test_mathplus_functions.json` | 是 |
| 5 | 多项式分析 | `test_power_function.json` | 是 |
| 6 | 复根分析 | `test_radical_function.json` | 是 |
| 7 | 函数数表 | `test_func_value_list.json` | 是 |
| 8 | 统计回归 | `test_statistics.json` | 是 |
| 9 | 性能基准 | `null` | 否 |

清单条目包括 `id`、`title`、`file`、`description`、`includeInAll`；编号保持连续，文件位于 `cases/`。性能基准直接由 `runPerformanceBenchmark()` 定义，没有 JSON case 文件，不参与全量回归。

## 配置与文件格式

运行前采用核心默认配置 `220 / 0.9 / algebra`，结束后恢复原配置。覆盖优先级为：

```text
默认值 < 清单中的测试集配置 < case 文件级配置 < 单条 case 配置
```

case 文件可直接是数组；需要统一配置时，用对象包裹。推荐使用嵌套 `calcConfig`：

```json
{
  "calcConfig": {
    "globalCalcAccuracy": 120,
    "outputAccuracy": 16,
    "globalPrintMode": "algebra"
  },
  "cases": [
    {
      "description": ["[normal] 整数乘方"],
      "coeffs": ["2^3+1"],
      "expected": { "result": "9", "expr": "2^3+1" }
    }
  ]
}
```

`description[0]` 用于日志定位，应说明覆盖点。配置也兼容 `config` 以及旧字段 `calcAcc`、`outputAcc`、`printMode`。**MathPlus 函数测试的单条 case 只读取嵌套配置**，不要在顶层用旧字段覆盖精度；其他计算分支支持单条顶层配置。

## 表达式用例（1–3）

`test_mathplus_calc_normal_cases.json` 覆盖 36 / 220 位计算精度下 `sin`、`cos`、`sh`、`ch` 的微小实部和虚部、零与极小输入，以及双曲计算在 `0.099` 和 `0.1` 处的分支边界。微小分量通过 `re(...)` 或 `im(...)` 单独取出后断言，避免被复数的显示规则省略。

`coeffs` 按顺序传给 `WorkerTools.exec` 的表达式与选项：

| 索引 | 含义 | 缺省值 |
| --- | --- | --- |
| 0 | 表达式 | 必填 |
| 1 | `calcAcc` | 当前计算精度 |
| 2 | `outputAcc` | 当前输出精度 |
| 3 | `calcMode` | `calc` |
| 4 | `outputMode` | `output` |
| 5 / 6 | 自定义函数 f / g | 未定义 |

```json
{
  "description": ["[normal] 自定义函数求值"],
  "coeffs": ["f(3)", 60, 8, "calc", "output", "[x]^2+1"],
  "expected": { "result": "10", "expr": "f(3)" }
}
```

`expected.expr` 必须对应实际规范化表达式，不一定等于原始输入。显示模式通过 `calcConfig.globalPrintMode` 设置。错误用例的 `expected` 使用错误对象：

```json
{
  "description": ["[error] 空表达式"],
  "coeffs": [""],
  "expected": { "error": "[MathPlus] syntax error: Input is empty." }
}
```

新增的 `[parser-regression]` 用例覆盖 36 / 220 位精度下的绝对值前括号补全、隐式乘法分母、前中后缀运算优先级、右结合幂、嵌套二元函数、函数调用和语法检查；`[parser-regression:error]` 覆盖参数、逗号、空括号和非法词元的错误信息。

### 隐式乘法分母回归

已确认的历史缺陷已修复，对应 8 条 TODO 用例已迁入 `test_mathplus_calc_normal_cases.json`，并扩展为 70 条 `[implicit-denominator]` 用例，参与 Node 和真实 Worker 的全量测试。覆盖 36 / 220 位精度、连续正负号、右结合幂、显式乘除、函数参数边界，以及完整和缺失闭合符号的嵌套绝对值。另有 8 条 `[implicit-denominator:error]` 用例确认参数不完整时仍然报错。

这些问题曾在重构前的 `75a0bd3`、括号修复后的 `5805751` 和 Pratt 版本 `5ea8205` 上复现：

| 输入 | 修复后的行为 | 历史缺陷 |
| --- | --- | --- |
| `1/2abs-2` | 结果 `0.25`，回显可重新计算 | 回显 `1/(2[cdot]abs()-2)` 含空参数，重新计算报错 |
| `1/2abs2^-2`、`1/2(2)^-2` | 结果 `2` | 返回 `-2`，负指数前过早关闭分母 |
| `1/2\|-2\|` | 结果 `0.25`，回显可重新计算 | 回显 `1/(2[cdot]\|-2)\|` 中括号与竖线交叉，重新计算报错 |

这些用例还保存 `referenceExpr`，用显式乘法与括号独立核对数学期望。`expression_compile.test.js` 同时断言原输入与回显的完整逆波兰指令一致、回显可重新计算，以及语法检查模式和计算模式输出相同。可单独运行 `node --test test/node/expression_compile.test.js`。

## MathPlus 静态函数用例（4）

执行 `MathPlus[c.function](...args)`，再按当前配置序列化结果。

```json
{
  "description": ["[sqrt] 负实数的平方根，以极坐标显示"],
  "function": "sqrt",
  "args": ["-1"],
  "calcConfig": { "globalPrintMode": "polar", "outputAccuracy": 8 },
  "expected": "1[toPolar]1.5707963"
}
```

参数可用 `{"expr":"1+[i]"}` 表示先计算表达式，或 `{"constant":"pi"}` 表示从常数表构造参数。`expected` 为序列化值，错误分支仍使用 `{"error":"..."}`。

## 分析工具用例（5–8）

统一使用 `{description,coeffs,expected}`，其中 `expected` 按对应工具的实际返回对象填写；不要只写准备断言的局部字段。

| 测试集 | coeffs 示例 | 调用 |
| --- | --- | --- |
| 多项式 | `[0,0,1,0,-1]` | `WorkerTools.powerFunctionAnalysis(c.coeffs)` |
| 复根 | `[1,2]` | `WorkerTools.radicalFunctionAnalysis(...c.coeffs)` |
| 数表 | `["[x]^2","2[x]",-1,0.5,1]` | `WorkerTools.valueList(...c.coeffs)` |
| 统计 | `[[1,2,3],[2,4,6]]` | `WorkerTools.statisticsCalc(...c.coeffs)` |

数值结果通常是字符串，也可能包含 `error`、`null` 等业务哨兵。字段和边界说明见[分析工具文档](../docs/advanced_analysis_tools.md)。

统计用例包含不同 x 量级下的精确线性关系、线性 R² 为零的二次曲线，以及负科学记数法系数的回归方程。检查回归结果时，同时核对模型字段、参数顺序和 `bestModel`。

## 维护步骤

1. 在 `test/cases/` 的现有 JSON 文件中添加数值用例；新增测试集时再更新唯一清单。
2. 核对 JSON 可解析、精度配置和规范化表达式，避免只为使测试通过而改期望值。
3. 同步计算核心的 `dist` 与 `src` 后运行 `npm test`。
4. Worker 生命周期或界面改动另在浏览器验证；性能变化单独运行基准，不把不同机器的耗时当作固定断言。
