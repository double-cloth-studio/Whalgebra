# Worker 架构与任务生命周期

实现位于 `src/js/asynchronous_logic.js`。界面通过 `WorkerTools` 将计算交给 Web Worker，避免同步大数运算长期占用主线程。

## 调用路径

```text
UI → WorkerTools → SyncWorker → Worker 中的 CalcTools / 分析工具
                        ← 带任务 ID 的结果或错误 ←
```

`SyncWorker` 把依赖类、静态状态和可调用函数序列化，生成 Blob URL 并启动 Worker，因此单文件版无需额外 `worker.js`。Worker 有独立上下文，参数和结果通过结构化克隆传输，不能直接访问主线程 DOM 或闭包变量。销毁时释放 Blob URL。

`WorkerTools` 首次调用时创建单例 Worker，等待 `initEnv` 同步当前配置后再派发任务。`isReady` 表示实例存在且未终止，不保证环境同步已完成；公开方法会自行等待同步。

## 公开计算接口

```javascript
const r = await WorkerTools.exec("1+[i]", {
    calcAcc: 60,
    outputAcc: 8,
    printMode: 'polar'
});
console.log(r.result); // "1.4142136[toPolar]0.78539816"
```

`exec(expr, options)` 支持 `calcAcc`、`outputAcc`、`printMode`、`calcMode`、`outputMode`、`f`、`g`，只覆盖当前任务，不修改默认配置。返回 `Promise<{result, expr}>`；`outputMode: 'mid'` 时 `result` 是含 `bigint` 的内部元组，其他常用情况下是字符串。完整语义见 [CalcTools](./advanced_analysis_tools.md)。

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
- `await WorkerTools.cancelWorker()` 取消业务任务，包括等待初始化后尚未派发的旧任务；保留配置同步。随后以 150 毫秒宽限期探测 Worker，仍无响应时重启以中断长计算。
- `await WorkerTools.restart()` 重建已有 Worker，并恢复主线程最新的计算精度、输出精度和显示模式；尚未创建 Worker 时不做操作。

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

更新 UI 时还需检查请求标识，丢弃旧请求返回的结果；现有 `PrintManager` 使用该方式避免连续输入和切换模式时显示过期内容。
