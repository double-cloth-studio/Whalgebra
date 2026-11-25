/** 在计算器页面执行 Worker 与虚拟滚动生命周期的浏览器回归检查。 */
export async function runLifecycleRegressions() {
    const results = {};
    const check = (condition, message) => {
        if (!condition) {
            throw new Error(message);
        }
    };
    const run = async (name, verify) => {
        try {
            await verify();
            results[name] = '通过';
        } catch (error) {
            results[name] = error.message;
        }
    };
    const afterFrames = async (count = 10) => {
        for (let i = 0; i < count; i++) {
            await new Promise(requestAnimationFrame);
        }
    };
    function makeList(count = 200, renderItem = index => '<div style="height:20px">' + index + '</div>') {
        const container = document.createElement('div');
        container.id = 'regression-list';
        container.style.cssText = 'position:fixed;top:0;left:0;width:240px;height:100px;overflow:auto';
        document.body.append(container);
        const list = new VirtualScroll({container: '#regression-list', renderItem});
        list.load(null, count);
        return {
            container,
            list,
            dispose() {
                list.destroy();
                container.remove();
            }
        };
    }

    await run('Worker 正常计算', async () => {
        const response = await WorkerTools.exec('2+3');
        check(String(response.result) === '5', '计算结果为 ' + response.result);
    });

    await run('数表采样软取消后继续使用原 Worker', async () => {
        const worker = WorkerTools._mathWorker;
        const thread = worker._worker;
        const exec = worker.exec;
        let cancellation;
        worker.exec = function (name, options) {
            const task = exec.call(this, name, options);
            if (name === 'valueList') {
                cancellation = WorkerTools.cancelWorker();
            }
            return task;
        };
        try {
            const [job] = await Promise.allSettled([WorkerTools.valueList('sin[x]', 'cos[x]', 1, 1, 999)]);
            await cancellation;
            check(job.reason?.name === 'CancellationError', '数表任务未被取消');
            check(worker._worker === thread, '取消数表触发了硬重启');
        } finally {
            worker.exec = exec;
        }
        const table = await WorkerTools.valueList('g[x]+1', '[x]^2', 2, 1, 2);
        check(table.f[0] === '5' && table.g[0] === '4', '取消后的数表计算失败');
    });

    await run('重启失败不再次重启，取消等待同一次失败', async () => {
        const worker = WorkerTools._mathWorker;
        const restart = worker.restart;
        const failure = new Error('注入的重启失败');
        let attempts = 0;
        worker.restart = function () {
            attempts++;
            this.terminate();
            throw failure;
        };
        try {
            const jobs = [
                WorkerTools.restart(), WorkerTools.getCalcAccuracy(), WorkerTools.getOutputAccuracy(),
                WorkerTools.getPrintMode(), WorkerTools.cancelWorker()
            ];
            const settled = await Promise.allSettled(jobs);
            check(attempts === 1 && settled.every(item => item.reason === failure),
                JSON.stringify({attempts, results: settled.map(item => item.status)}));
        } finally {
            worker.restart = restart;
            await WorkerTools.getCalcAccuracy();
        }
    });

    await run('取消等待成功的重启完成', async () => {
        const worker = WorkerTools._mathWorker;
        const exec = worker.exec;
        let finish;
        const gate = new Promise(resolve => {
            finish = resolve;
        });
        worker.exec = async function (name, options) {
            if (name === 'initEnv') {
                await gate;
            }
            return exec.call(this, name, options);
        };
        const restart = WorkerTools.restart();
        let cancelled = false;
        const cancellation = WorkerTools.cancelWorker().then(() => {
            cancelled = true;
        });
        try {
            await afterFrames(2);
            check(!cancelled, '重启仍在同步配置时取消提前兑现');
        } finally {
            finish();
            worker.exec = exec;
            await Promise.all([restart, cancellation]);
        }
        check(WorkerTools.isReady && cancelled, '重启后 Worker 未就绪');
    });

    await run('SyncWorker 固化函数表和选项', async () => {
        const config = {callableFunctions: {answer: () => 42}, dependencies: [], injectCancelSignal: false};
        const worker = new SyncWorker(config);
        try {
            delete config.callableFunctions.answer;
            config.callableFunctions.added = () => 99;
            check(await worker.exec('answer') === 42, '原函数不可用');
            let rejected = false;
            try { await worker.exec('added'); }
            catch (error) { rejected = error.name === 'FunctionNotFoundError'; }
            check(rejected, '新增函数进入了注册表');
            config.dependencies = null;
            config.injectCancelSignal = 'invalid';
            worker.restart();
            check(await worker.exec('answer') === 42, '重启后丢失原注册表');
            for (const options of [{dependencies: null}, {injectCancelSignal: 'invalid'}]) {
                const key = Object.keys(options)[0];
                let error;
                try { new SyncWorker({callableFunctions: {answer: () => 42}, ...options}).terminate(); }
                catch (caught) { error = caught; }
                check(error?.message.includes(key), '未在构造时拒绝无效配置 ' + key);
            }
        } finally { worker.terminate(); }
    });

    await run('恢复期间采用最新滚动请求', async () => {
        const {container, list, dispose} = makeList();
        try {
            list.pause();
            list.scrollToIndex(6, {block: 'start'});
            container.style.display = 'none';
            list.resume();
            list.scrollToIndex(60, {block: 'start'});
            container.style.display = '';
            await afterFrames();
            check(container.scrollTop === 1200 && list.getMetrics().pendingScrollQueue.length === 0,
                '恢复后 scrollTop=' + container.scrollTop);
            list.pause();
            container.style.display = 'none';
            list.resume();
            list.scrollToBottom();
            container.style.display = '';
            await afterFrames();
            check(container.scrollTop === 3900, '底部定位失败，scrollTop=' + container.scrollTop);
        } finally { dispose(); }
    });

    await run('重测异常保留列表且可继续滚动', async () => {
        let fail = false;
        const {container, list, dispose} = makeList(200, index => {
            if (fail && index === 0) throw new Error('注入的采样失败');
            return '<div style="height:20px">' + index + '</div>';
        });
        try {
            container.scrollTop = 400;
            await afterFrames();
            const row = container.querySelector('[data-vs-spacer="top"]').nextElementSibling;
            fail = true;
            container.style.width = '280px';
            await afterFrames();
            check(row.isConnected && list.getMetrics().renderedCount > 0, '异常后原有行被移除');
            container.scrollTop = 1000;
            await afterFrames();
            check(list.getMetrics().anchorIndex === 50, '异常后滚动没有重绘');
            list.pause();
            list.scrollToIndex(80, {block: 'start'});
            list.resume();
            await afterFrames();
            check(container.scrollTop === 1600 && list.getMetrics().anchorIndex === 80, '恢复重测失败后未应用定位');
            fail = false;
            container.style.width = '300px';
            await afterFrames();
            check(list.getMetrics().containerHeight === 100 && list.getMetrics().anchorIndex === 80, '后续正常重测失败');
        } finally { dispose(); }
    });

    await run('压缩滚动报告负顶部占位', async () => {
        const {container, list, dispose} = makeList(10_000_000);
        try {
            container.scrollTop = 1;
            await afterFrames();
            const margin = parseFloat(container.querySelector('[data-vs-spacer="top"]').style.marginTop);
            check(margin < 0, '测试未进入负边距场景');
            check(list.getMetrics().spacerTop === margin, '指标没有记录负边距 ' + margin);
        } finally { dispose(); }
    });
    return results;
}
