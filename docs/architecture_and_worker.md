# Worker 架构与任务生命周期

以下行为以 `dist/Whalgebra.html` 的发行版为准。界面通过 `WorkerTools` 将计算交给 Web Worker，避免同步大数运算长期占用主线程。

## 调用路径

```text
UI → WorkerTools → SyncWorker → Worker 中的 CalcTools / 分析工具
                        ← 带任务 ID 的结果或错误 ←
```

`SyncWorker` 把依赖类、静态状态和可调用函数序列化，生成 Blob URL 并启动 Worker，因此单文件版无需额外 `worker.js`。Worker 有独立上下文，参数和结果通过结构化克隆传输，不能直接访问主线程 DOM 或闭包变量。销毁时释放 Blob URL。

`SyncWorker` 在构造时校验配置并固化可调用函数名与 Worker 脚本。后续修改传入的配置对象不会改变此实例的函数表或重启后的脚本。

`WorkerTools` 首次调用时创建单例 Worker，等待 `initEnv` 同步当前配置后再派发任务。`isReady` 表示实例存在、未终止，且已完成当前轮环境同步；初始化或重启后的同步尚未完成时为 `false`。`isRestarting` 表示重启 Promise 仍在进行。公开方法会自行等待初始化或重启，调用方无需轮询就绪状态。

`_restoreState()` 使用状态标识区分每轮同步：同步期间若主线程配置改变，会补发最新快照；被新一轮重启取代的旧同步不能终止新 Worker。`CalcConfig` 在 Worker 尚未就绪或正在重启时跳过零散同步，由此流程恢复最新配置。

## 公开计算接口

```javascript
const r = await WorkerTools.exec("1+[i]", {
    calcAcc: 60,
    outputAcc: 8,
    printMode: 'polar'
});
console.log(r.result); // "1.4142136[toPolar]0.78539816"
```

`exec(expr, options)` 支持 `calcAcc`、`outputAcc`、`printMode`、`calcMode`、`outputMode`、`f`、`g`，只覆盖当前任务的参数。响应包含 `result` 和 `expr`。`outputMode: 'mid'` 时 `result` 是含 `bigint` 的内部元组，响应还包含实部、虚部的 `noiseMag`。默认输出的 `result` 为字符串。完整语义见 [CalcTools](./advanced_analysis_tools.md)。

以下方法与同步工具的参数、结果结构相同，仅增加 Promise：

| WorkerTools 方法 | 同步实现 |
| --- | --- |
| `powerFunctionAnalysis(list)` | `PowerFunctionTools.powerFunctionAnalysis` |
| `statisticsCalc(listA, listB)` | `StatisticsTools.statisticsCalc` |
| `radicalFunctionAnalysis(z, n)` | `RadicalFunctionTools.radicalFunctionAnalysis` |
| `valueList(f, g, start, step, end)` | `FuncValueListTools.valueList` |

配置接口包括 `setCalcAccuracy` / `getCalcAccuracy`、`setOutputAccuracy` / `getOutputAccuracy`、`setPrintMode` / `getPrintMode`，均返回 Promise。通常从主线程 `CalcConfig` 设置应用默认值；单次表达式计算优先使用 `exec` 选项。

## 超时、取消与恢复

- `SyncWorker.exec(name, {args, transfer, timeout, cancellable})` 默认 `timeout: 0`，不设超时；`WorkerTools` 业务派发使用 60 秒超时，环境同步使用 10 秒。
- `SyncWorker.cancel()` 拒绝可取消任务，并发送取消信号；同步数学运算运行期间无法处理消息，软取消本身不能立即停止它。
- 发行版的 `WorkerTools.valueList()` 约每 16 毫秒在采样点之间让出事件循环，使 Worker 能接收取消消息并停止后续采样。单点计算阻塞时仍由宽限期保障恢复。
- `await WorkerTools.cancelWorker()` 作废旧业务任务，包括尚未派发的任务。首次初始化期间只更新取消标识，环境同步继续进行。已有重启时，取消请求等待同一次重启完成，并传播重启错误。Worker 已就绪时，软取消已派发任务并在 150 毫秒宽限期内探测响应，超时则重启。取消后提交的新任务会等探测及可能触发的重启、环境同步完成后再派发。
- `await WorkerTools.restart()` 重建已有 Worker，并恢复主线程最新的计算精度、输出精度和显示模式；尚未创建 Worker 时不做操作。
- 并发请求共用当前重启。该次重启失败后，等待中的请求收到同一错误，下一次独立调用仍可尝试恢复。

意外终止或超时会触发恢复，但**失败任务不会自动重试**，调用方仍收到原错误。普通语法/数学错误、`CancellationError` 和主动终止产生的 `TerminationError` 直接报告，不因这些错误自动重启。

```javascript
try {
    const r = await WorkerTools.exec("100!");
    console.log(r.result);
} catch (error) {
    if (!['CancellationError', 'TerminationError'].includes(error.name)) {
        console.error(error.message);
    }
}
```

更新 UI 时还需检查请求标识，丢弃旧请求返回的结果。`PrintManager` 分别用 `_currentRequestId` 和 `exeRequestId` 管理实时预览与正式计算；`cancelMode0Preview()` 同时作废已启动的预览并丢弃防抖队列，本身不取消 Worker。调用方负责取消或重启 Worker、复位计算状态，详见[界面与交互](./ui_and_interaction.md)。

编辑区提交另由 `PageControlTools._inputSyncRequestId` 管理，语法检查返回后须核对原模式和子屏幕。取消或终止错误不应标记为语法错误；模式切换与 `cancelPrint()` 会作废当前提交。完整流程见[编辑区提交](./ui_and_interaction.md#编辑区提交到子屏幕)。
