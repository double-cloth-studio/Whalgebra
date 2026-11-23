# 测试手册

测试分为 Node 回归、浏览器计算控制台与人工界面检查。需要 Node.js 20+，命令在项目根目录运行。

## 运行与覆盖

```powershell
npm test
# 只运行某个 Node 测试文件
node --test test/node/statistics.test.js
```

`npm test` 覆盖工具链、服务器、路径边界、数学专项测试，并复用浏览器测试逻辑执行所有 `includeInAll: true` 的 JSON 测试集。计算核心从 **`dist/Whalgebra.html`** 抽取，在 Node vm 中运行；`WorkerTools` 被同步替身代替，**不覆盖真实 Worker、DOM 或界面交互**。仅修改 `src/` 不会改变这批计算测试的输入。

真实浏览器测试：运行 `npm start`，从工作台进入 `test/web/index.html`。控制台通过 iframe 加载发行版并使用真实 Worker，可单独运行测试集、定位失败用例及运行性能基准。UI 改动仍需人工检查受影响流程。

```text
test/
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

## 维护步骤

1. 在现有 case 文件追加能说明问题的用例；新增测试集时再更新唯一清单。
2. 核对 JSON 可解析、精度配置和规范化表达式，避免只为使测试通过而改期望值。
3. 同步计算核心的 `dist` 与 `src` 后运行 `npm test`。
4. Worker 生命周期或界面改动另在浏览器验证；性能变化单独运行基准，不把不同机器的耗时当作固定断言。
