// 监听全局点击事件，按点击目标的 ID、类名和父容器分发页面操作。
document.addEventListener('click', (event) => {
    "use strict";

    // 从点击节点向上分发，首个匹配的控件负责处理事件。
    for (const target of event.composedPath()) {
        if (!(target instanceof Element)) {
            continue;
        }

        const targetID = target.id;
        const targetClass = target.getAttribute('class') || '';
        const firstChildClass = target.firstElementChild?.getAttribute('class') || '';
        const parentID = target.parentElement?.id || '';

        // 第一层按目标 ID 精确分发，处理全局唯一控件。
        switch (targetID) {
            case 'head_setting':
                PageControlTools.hideExplain();
                return PageControlTools.headChangeModes();

            case 'head_title':
                return PageControlTools.moveShip();

            case 'main_cover':
                return PageControlTools.clickMainCover();

            case 'print_close':
                return PageControlTools.closePrint();

            case 'head_explain':
            case 'explain_close':
                return PageControlTools.headChangeExplain();

            case 'input':
                PageControlTools.hideExplain();
                if (HtmlTools.isScrolledToRight(HtmlTools.getHtml('#input'))) {
                    InputManager.moveCursor('end');
                }
                return;

            case 'load_cancel':
                return PageControlTools.cancelPrint();

            case 'print_1_0_choose':
                return PageControlTools.clickPrint1Choose();

            case 'print_content_1_cover':
                return PageControlTools.clickPrint1Cover();

            case 'statistics_results_top_x':
            case 'statistics_results_top_y':
            case 'statistics_results_top_xy':
                PageControlTools.triggerSelection(target, event);
                return PageControlTools.switchStatisticsResults(targetID.slice(23));

            case 'back_btn':
            case 'back_btn_child1':
            case 'back_btn_child2':
            case 'back_btn_father':
                PageConfig.currentMode = '2_0';
                return;

            case 'setting_acc_control':
            case 'switch_knob_on':
            case 'switch_knob_off':
            case 'switch_knob':
            case 'switch_container':
            case 'switch_container_father':
                PageConfig.calcAccMode = 1 - PageConfig.calcAccMode;
                return;

            case 'sort_svg':
            case 'keyboard_top_more':
                return PageControlTools.changeSubKeyboard('SortSvg');
        }

        // 顶部快捷键由同一容器分组，按键帽的首个子节点识别动作。
        switch (parentID) {
            case 'keyboard_top': {
                const handlers = {
                    '_2nd_': () => PageConfig.keyboardType = 1 - PageConfig.keyboardType,
                    '_trigonometry_': () => PageControlTools.changeSubKeyboard('_trigonometry_'),
                    '_functions_': () => PageControlTools.changeSubKeyboard('_functions_')
                };

                if (handlers[firstChildClass]) {
                    handlers[firstChildClass]();
                } else {
                    PageControlTools.hideExplain();

                    const direction = firstChildClass.slice(13).toLowerCase();
                    if (direction) {
                        InputManager.moveCursor(direction);
                    }
                }
                return;
            }
        }

        // 第三层处理带规则命名的动态元素，避免为每个模式、单元格或按键逐一注册监听器。
        if (/^screen_input_(?:2_\d{2}|[34]\d)$/.test(targetID)) {
            PageControlTools.hideExplain();
            const modeIndex = targetID.slice(-1);
            PageConfig.subModes = {'default': modeIndex};
            PageControlTools.syncScreenToInput();
            return;
        }

        if (parentID === 'input') {
            PageControlTools.hideExplain();
            return InputManager.clickMoveCursor(target);
        }

        if (/^keyboard_cover(?:_ForMode1)?$/.test(targetID)) {
            return PageControlTools.changeSubKeyboard('allNotShow');
        }

        if (/^mode_[0-4]$/.test(targetID)) {
            const mode = targetID.slice(-1);
            PageConfig.currentMode = (mode === '2') ? '2_0' : mode;

            // 延迟 340ms 关闭模态遮罩，预留 CSS drawer 收起动画过渡时长。
            PageControlTools.delayCloseMainCover();
            return;
        }

        if (/Data[XY]/.test(targetClass)) {
            PageControlTools.hideExplain();

            const children = target.parentElement.children;
            const name = [];

            const classList = HtmlTools.getClassList(children[0].children[0]);
            name.push(classList ? Number(classList.join('').replace(/_/g, '')) - 1 : 0);
            name.push(target.classList.contains('DataX') ? 0 : 1);

            PageConfig.subModes = {'default': name};
            PageControlTools.syncScreenToInput();
            return;
        }

        if (/^print_[0-1]$/.test(targetID)) {
            PageConfig.printMode = targetID.slice(-1);
            return;
        }

        if (/KeyboardStyle(?:[123]|EXE)/.test(targetClass)) {
            PageControlTools.hideExplain();
            switch (firstChildClass) {
                case '_exe_':
                    return PrintManager.exe();
                case '_ac_':
                    return InputManager.ac();
                case '_del_':
                    InputManager.del();
                    if (PageConfig.currentMode === '0') {
                        PrintManager.mode0ShowOnScreen();
                    }
                    return;
                case '_add_line_':
                    const currentSubModes = PageConfig.subModes['1'];
                    const succeed = InputManager.statisticsAddLine({
                        location: currentSubModes[0] - 1,
                        inputX: currentSubModes[1] === 0 ? '0' : '',
                        inputY: currentSubModes[1] === 0 ? '' : '0'
                    });
                    if (succeed && !HtmlTools.getHtml('.InputTip')) {
                        InputManager.ac();
                    }
                    return HtmlTools.scrollToView();
                case '_del_line_':
                    InputManager.statisticsDelLine();
                    return HtmlTools.scrollToView();
                default: {
                    const input = HtmlTools.getClassList(target);
                    InputManager.input(input);
                    if (targetClass.includes('NeedParentheses') && PageConfig.keyboardType === 1) {
                        InputManager.input(['_parentheses_left_']);
                    }
                    if (PageConfig.currentMode === '0') {
                        PrintManager.mode0ShowOnScreen();
                    }
                    PageControlTools.showExplain(input);
                }
            }
            return;
        }

        if (/^(?:title_mode_(?:[0134]|2_0)|screen_title|print_title)$/.test(targetID)) {
            // 嵌入式环境关闭网页专属全屏；函数值结果页的标题也不作为全屏触发区。
            if (!Public.webMode || (targetID !== 'print_title' && PageConfig.currentMode === '2_1')) {
                return;
            }

            if (document.fullscreenElement) {
                document.exitFullscreen?.().catch(() => {
                });
            } else {
                document.documentElement.requestFullscreen?.().catch(() => {
                });
            }
            return;
        }

        if (/^choose_ra_[0-6]$/.test(targetID)) {
            return PageControlTools.changePrint1Ra(targetID);
        }

        if (/^export_[0-1]$/.test(targetID)) {
            return PageControlTools.exportRa(targetID);
        }
    }
});

// 监听全局物理键盘按键事件，将按键输入分发至对应的计算器操作。
document.addEventListener('keydown', (event) => {
    "use strict";

    // macOS 的 Option 组合键可能产生死键或特殊字符，使用物理键位识别数学符号。
    const altLetter = event.altKey ? /^Key([A-Z])$/.exec(event.code)?.[1].toLowerCase() : null;
    const altInput = altLetter && TokenConfig.codeNumbers.has(`[${altLetter}]`) ? altLetter : null;
    const key = altInput || event.key;

    // 除配置中的数学符号输入外，Alt 组合键交由浏览器处理。
    if (event.ctrlKey || event.metaKey || (event.altKey && !altInput)) {
        return;
    }

    PageControlTools.hideExplain();

    const coverShown = !HtmlTools.getHtml('#main_cover').classList.contains('NoDisplay');
    const inputMode = HtmlTools.getHtml('#main').classList.contains('Input');

    // 输入同步期间遮罩同样拦截物理键盘，Escape 仍可取消当前任务。
    if (inputMode && !HtmlTools.getHtml('#load_cover').classList.contains('NoDisplay')) {
        event.preventDefault();
        if (key === 'Escape') {
            return PageControlTools.cancelPrint();
        }
        return;
    }

    // 按 UI 层级关闭模态遮罩或退出/取消结果页；Escape 在输入态不执行计算。
    if (key === 'Enter' || key === 'Escape') {
        if (coverShown) {
            event.preventDefault();
            return PageControlTools.clickMainCover();
        }

        // Escape 优先收起当前页面的浮层，每次只关闭一层。
        if (key === 'Escape' && inputMode && (
            HtmlTools.getHtml('#keyboard_cover').classList.contains('KeyboardCover') ||
            HtmlTools.getHtml('#keyboard_cover_ForMode1').classList.contains('KeyboardCover')
        )) {
            event.preventDefault();
            return PageControlTools.changeSubKeyboard('allNotShow');
        }
        if (key === 'Escape' && !inputMode &&
            !HtmlTools.getHtml('#print_content_1_cover').classList.contains('NoDisplay')) {
            event.preventDefault();
            return PageControlTools.clickPrint1Cover();
        }

        if (!inputMode) {
            event.preventDefault();
            if (!HtmlTools.getHtml('#load_cover').classList.contains('NoDisplay')) {
                return PageControlTools.cancelPrint();
            }
            return PageControlTools.closePrint();
        }

        if (key === 'Enter') {
            event.preventDefault();
            return PrintManager.exe();
        }
        return;
    }

    // 非输入态保留按键默认行为，禁止修改隐藏的输入内容或光标。
    if (coverShown || !inputMode) {
        return;
    }

    switch (key) {
        case 'Backspace':
            event.preventDefault();
            InputManager.del('left', event.shiftKey);
            if (PageConfig.currentMode === '0') {
                PrintManager.mode0ShowOnScreen();
            }
            return;

        case 'Delete':
            event.preventDefault();
            InputManager.del('right', event.shiftKey);
            if (PageConfig.currentMode === '0') {
                PrintManager.mode0ShowOnScreen();
            }
            return;

        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown':
            event.preventDefault();

            return InputManager.moveCursor(key.slice(5).toLowerCase(), event.shiftKey);
    }

    if (/^([a-z0-9E])$/.test(key)) {
        event.preventDefault();

        const input = [altInput ? `_${key}_mathit_` : `_${key}_`];
        InputManager.input(input);
        PageControlTools.showExplain(input);
        if (PageConfig.currentMode === '0') {
            PrintManager.mode0ShowOnScreen();
        }
        return;
    }

    if (/^[+\-*/^|!,.()]$/.test(key)) {
        event.preventDefault();

        InputManager.input(HtmlTools.textToHtmlClass(HtmlTools.deleteIllegal(key)));
        if (PageConfig.currentMode === '0') {
            PrintManager.mode0ShowOnScreen();
        }
    }
});

// 监听窗口加载事件，按依赖顺序恢复持久化状态。
window.addEventListener('load', () => {
    "use strict";

    /**
     * 安全读取 LocalStorage 中的键值，规避隐私模式或禁用存储时的异常。
     * @param {string} key - 存储键名。
     * @returns {string|null} 存储值或 null。
     */
    const getStore = (key) => {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    };

    /**
     * 恢复单项本地数据，并清除无法解析的值。
     *
     * @param {string} dataName - 要读取、校验并在损坏时删除的精确 `localStorage` 键名；缺失键不会删除
     *   其他状态，也不会把字符串 `null` 当作缺失值。
     * @param {function(string): void} func - 键存在时同步执行的恢复函数；参数是存储中的原始字符串，
     *   JSON 解析或业务校验由回调负责。回调抛错即视为该项损坏并触发清理与缺省恢复。
     * @param {function()} [defaultFunc=null] - 键缺失或恢复失败时调用的无参初始化函数；
     *   `null` 表示无需额外初始化。失败路径最多调用一次，不接收已损坏的原值。
     * @returns {void}
     */
    const recoverData = (dataName, func, defaultFunc = null) => {
        const currentData = getStore(dataName);

        if (currentData === null) {
            defaultFunc?.();
            return;
        }

        try {
            func(currentData);
        } catch (e) {
            console.warn(`[GLOBAL] LocalStorage ${dataName} corrupted, resetting.`);
            try {
                localStorage.removeItem(dataName);
            } catch {
                // 存储不可用时忽略删除失败。
            }
            defaultFunc?.();
        }
    };

    // 恢复顺序不可交换：模式先建立页面上下文，输入数据随后决定子模式的合法范围，最后恢复显示选项。
    recoverData('currentMode', (data) => {
        PageConfig.setCurrentMode(data, {initialize: true});
    });

    recoverData('screenData', (data) => {
        data = JSON.parse(data);
        if (!data || Object.getPrototypeOf(data) !== Object.prototype) {
            throw new Error('[GLOBAL] Invalid screenData structure.');
        }

        // 校验完整的存储记录，并在脱离页面的片段中准备各子屏幕的节点。
        const fields = [];
        for (const [key, value] of Object.entries(data)) {
            if (!Object.hasOwn(PageConfig.screenData, key)) {
                throw new Error('[GLOBAL] Invalid screenData field.');
            }

            if (key === '1') {
                if (!Array.isArray(value) || !value.every(row =>
                    Array.isArray(row) && row.length === 2 && row.every(cell => typeof cell === 'string')
                )) {
                    throw new Error('[GLOBAL] Invalid statistics data.');
                }
                const rows = value.slice(0, InputManager.MAX_STATISTICS_ROW);
                const lastRow = rows.at(-1);
                if (rows.length < InputManager.MAX_STATISTICS_ROW && (!lastRow || lastRow.some(Boolean))) {
                    rows.push(['', '']);
                }
                data[key] = rows;
                continue;
            }

            if (typeof value !== 'string') {
                throw new Error('[GLOBAL] Invalid screenData expression.');
            }
            const place = document.getElementById(`screen_input_inner_${key}`);
            if (!place) {
                throw new Error('[GLOBAL] Missing screenData field.');
            }
            const fragment = document.createDocumentFragment();
            HtmlTools.appendDOMs(fragment, HtmlTools.textToHtmlClass(value));
            fields.push([place, fragment]);
        }

        for (const [place, fragment] of fields) {
            place.replaceChildren(fragment);
        }
        PageConfig.screenData = data;
    });

    recoverData('subModes', (data) => {
        data = JSON.parse(data);
        if (!data || Object.getPrototypeOf(data) !== Object.prototype) {
            throw new Error('[GLOBAL] Invalid subModes structure.');
        }

        for (const [key, value] of Object.entries(data)) {
            if (key === '1') {
                if (!Array.isArray(value) || value.length !== 2 ||
                    !Number.isInteger(value[0]) || value[0] < 0 || ![0, 1].includes(value[1])) {
                    throw new Error('[GLOBAL] Invalid statistics position.');
                }
                // 统计表可能已被截断，将原行号限制到恢复后的范围。
                data[key] = [Math.min(value[0], PageConfig.screenData['1'].length - 1), value[1]];
            } else if (!Object.hasOwn(PageConfig.subModeOptions, key) || !PageConfig.subModeOptions[key].includes(value)) {
                throw new Error('[GLOBAL] Invalid subModes field.');
            }
        }
        PageConfig.subModes = data;
    });

    recoverData('keyboardType', (data) => {
        PageConfig.keyboardType = Number(data);
    });

    recoverData('printMode', (data) => {
        PageConfig.printMode = data;
    });

    recoverData(
        'calcAccMode',
        (data) => PageConfig.calcAccMode = Number(data),
        () => PageConfig.calcAccMode = 0
    );

    HtmlTools.scrollToView();
});