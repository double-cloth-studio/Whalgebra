/** 初始化并导出高精度计算、分析和数据处理工具。 */
(function () {
    "use strict";

    /**
     * 代表一个不可变的、任意精度的十进制数。
     * 内部表示为 `[power, mantissa]`，即 `mantissa * 10^power`。
     *
     * @class BigNumber
     */
    class BigNumber {
        /**
         * 线性缓存 `10^exp` 的最大指数上限。
         * 512 足以覆盖全局最高计算精度（220）和 Lanczos 最高内部精度（420），
         * 常规舍入全部 O(1) 命中，且常驻内存上限仅约 55 KB。
         * @private
         */
        static _MAX_POW10_CACHE_EXP = 512;
        /**
         * 线性缓存表：`_pow10Cache[i] === 10n ** BigInt(i)`，长度不超过 `_MAX_POW10_CACHE_EXP + 1`。
         * @private
         */
        static _pow10Cache = [1n];

        /**
         * 二次幂指数缓存上限：`k = 14` 对应 `10^(2^14) = 10^16384`。
         * 15 项合计常驻内存仅约 14 KB；超过此规模的超大数在单次调用内临时计算，用完即由 GC 回收。
         * @private
         */
        static _MAX_POW10_TWO_POW_K = 14;
        /**
         * 二次幂指数缓存表：`_pow10TwoPowCache[k] === 10n ** (2n ** BigInt(k))`。
         * 即 `[10^1, 10^2, 10^4, 10^8, ...]`。
         * @private
         */
        static _pow10TwoPowCache = [10n];

        /**
         * 从数值、字符串、同类对象或内部元组创建高精度十进制数。
         *
         * @param {string|number|bigint|BigNumber|Array|object} x - 要转换为高精度十进制数的值。
         *   字符串可使用普通或科学记数法；`number` 会先按其可见十进制值解析；`bigint` 保持整数精度。
         *   `BigNumber` 会按目标精度复制（不支持直接传入 `ComplexNumber`，需显式传入其实部分量 `re`）。
         *   数组/对象应提供内部 `[power, mantissa, acc?]` 信息，其中尾数必须是整数且指数必须安全可表示。
         * @param {{
         *   acc?: number,
         *   pow?: number,
         *   noiseMag?: number
         * }} [options={}] - 构造选项。
         * @param {number} [options.acc] - 结果保留的有效数字位数；应为正整数。省略时优先沿用输入携带的
         *   精度，其余输入采用 `CalcConfig.globalCalcAccuracy`。
         * @param {number} [options.pow=0] - 在解析后的十进制指数上额外增加的安全整数，等价于将输入
         *   整体乘以 `10 ** pow`；它不改变 `acc`，常用于构造科学记数法的中间值。
         * @param {number} [options.noiseMag] - 舍入前的噪声量级上界；省略时沿用输入对象的噪声并计入缩放，
         *   不携带噪声的输入以 `-Infinity` 为基准。
         * @throws {Error} 输入格式、长度、数值范围或指数无效时抛出。
         */
        constructor(x, {acc, pow = 0, noiseMag} = {}) {
            const type = Public.typeOf(x);
            switch (type) {
                case 'array': {
                    const len = x.length;
                    if (![2, 3].includes(len)) {
                        throw new Error('[BigNumber] Input error: Array length must be 2 or 3.');
                    }

                    const arrayAcc = (len === 3 && x[2] > 0) ? x[2] : undefined;
                    const finalAcc = acc ?? arrayAcc ?? CalcConfig.globalCalcAccuracy;
                    const {mantissa, power, noiseMag: finalNoiseMag} =
                        BigNumber._roundAndNormalize(x[1], x[0] + pow, finalAcc, noiseMag ?? -Infinity);

                    if (!Number.isSafeInteger(power)) {
                        throw new Error('[BigNumber] Input error: Power too large or too small');
                    }
                    this.power = power;
                    /** @type {bigint} */
                    this.mantissa = mantissa;
                    this.acc = finalAcc;
                    this.noiseMag = finalNoiseMag;
                    return;
                }

                case 'bignumber':
                case 'object': {
                    if ([x.power, x.mantissa, x.acc].includes(undefined) && type === 'object') {
                        throw new Error('[BigNumber] Unsupported input type or invalid number format.');
                    }

                    const finalAcc = acc ?? x.acc;
                    const baseNoiseMag = noiseMag ?? (x.noiseMag === -Infinity || x.noiseMag === undefined ? -Infinity : x.noiseMag + pow);
                    let realNum;

                    if (x instanceof BigNumber && finalAcc === x.acc) {
                        realNum = {mantissa: x.mantissa, power: x.power + pow, noiseMag: baseNoiseMag};
                    } else {
                        realNum = BigNumber._roundAndNormalize(x.mantissa, x.power + pow, finalAcc, baseNoiseMag);
                    }

                    if (realNum.mantissa !== 0n && !Number.isSafeInteger(realNum.power)) {
                        throw new Error('[BigNumber] Input error: Power too large or too small');
                    }
                    this.power = realNum.mantissa === 0n ? 0 : realNum.power;
                    this.mantissa = realNum.mantissa;
                    this.acc = finalAcc;
                    this.noiseMag = realNum.mantissa === 0n ? -Infinity : realNum.noiseMag;
                    return;
                }

                case 'bigint': {
                    acc = acc ?? CalcConfig.globalCalcAccuracy;
                    const {
                        mantissa: mantissaFromBigInt,
                        power: powerFromBigInt,
                        noiseMag: noiseFromBigInt
                    } = BigNumber._roundAndNormalize(x, pow, acc, noiseMag ?? -Infinity);

                    if (mantissaFromBigInt !== 0n && !Number.isSafeInteger(powerFromBigInt)) {
                        throw new Error('[BigNumber] Input error: Power too large or too small');
                    }
                    this.power = mantissaFromBigInt === 0n ? 0 : powerFromBigInt;
                    this.mantissa = mantissaFromBigInt;
                    this.acc = acc;
                    this.noiseMag = mantissaFromBigInt === 0n ? -Infinity : noiseFromBigInt;
                    return;
                }

                case 'number': {
                    if (!Number.isFinite(x)) {
                        throw new Error('[BigNumber] Input error: Non-finite numbers (Infinity, NaN) are not supported.');
                    }
                    // 仅安全整数直接走 BigInt 快速路径；超过 2^53 - 1 的浮点整数交给 toExponential() 按十进制解析。
                    if (Number.isSafeInteger(x)) {
                        acc = acc ?? CalcConfig.globalCalcAccuracy;
                        const {
                            mantissa: mantissaFromInt,
                            power: powerFromInt,
                            noiseMag: noiseFromInt
                        } = BigNumber._roundAndNormalize(x, pow, acc, noiseMag ?? -Infinity);

                        if (mantissaFromInt !== 0n && !Number.isSafeInteger(powerFromInt)) {
                            throw new Error('[BigNumber] Input error: Power too large or too small');
                        }
                        this.power = mantissaFromInt === 0n ? 0 : powerFromInt;
                        this.mantissa = mantissaFromInt;
                        this.acc = acc;
                        this.noiseMag = mantissaFromInt === 0n ? -Infinity : noiseFromInt;
                        return;
                    }
                    x = x.toExponential();
                    break;
                }

                case 'string':
                    if (x.length > CalcConfig.MAX_INPUT_STRING_LENGTH) {
                        throw new Error(`[BigNumber] Input string length exceeds maximum allowed length of ${CalcConfig.MAX_INPUT_STRING_LENGTH}.`);
                    }
                    break;

                default:
                    throw new Error('[BigNumber] Unsupported input type or invalid number format.');
            }
            acc = acc ?? CalcConfig.globalCalcAccuracy;

            let mantissaStr = x.replace(/[\s_]/g, '').toLowerCase();

            if (mantissaStr.includes('e')) {
                const parts = mantissaStr.split('e');
                if (parts.length !== 2 || !/^[+-]?\d+$/.test(parts[1])) {
                    throw new Error('[BigNumber] Unsupported input type or invalid number format.');
                }
                const exponent = Number(parts[1]);
                if (!Number.isFinite(exponent)) {
                    throw new Error('[BigNumber] Input error: Exponent is too large and results in Infinity.');
                }
                pow += exponent;
                mantissaStr = parts[0];
            }

            if (BigNumber._isInvalidNumericString(mantissaStr)) {
                throw new Error('[BigNumber] Unsupported input type or invalid number format.');
            }

            const [rawPower, rawMantissa] = BigNumber._parseNumericString(mantissaStr);

            const {
                mantissa: finalMantissa,
                power: middlePower,
                noiseMag: finalNoiseMag
            } = BigNumber._roundAndNormalize(rawMantissa, rawPower + pow, acc, noiseMag ?? -Infinity);

            // 指数低于下限时，还要计入尾数位数才能判断数量级是否下溢。
            if (finalMantissa === 0n || (middlePower < CalcConfig.MIN_INPUT_EXPONENT &&
                middlePower + BigNumber.decimalLengthBigInt(finalMantissa) - 1 < CalcConfig.MIN_INPUT_EXPONENT)) {
                this.power = 0;
                this.mantissa = 0n;
                this.acc = acc;
                this.noiseMag = -Infinity;
                return;
            } else if (middlePower > CalcConfig.MAX_INPUT_EXPONENT) { // 过大的指数按溢出处理。
                throw new Error('[BigNumber] Range error: Input number too large.');
            }

            this.power = middlePower;
            this.mantissa = finalMantissa;
            this.acc = acc;
            this.noiseMag = finalNoiseMag;
        }

        /**
         * 自定义 `Object.prototype.toString.call()` 的返回值。
         * 这使得 `Public.typeOf` 对 `BigNumber` 实例返回 `bignumber`。
         *
         * @readonly
         * @type {string}
         */
        get [Symbol.toStringTag]() {
            return 'BigNumber';
        }

        /**
         * 将有限位近似常量转为实数，并保留存储末位引入的噪声。
         * @param {[number, bigint] | [number, bigint, number]} tuple - 常量的内部元组。
         * @param {number} [acc] - 目标有效位数。
         * @returns {BigNumber}
         */
        static approximateConstant(tuple, acc) {
            return new BigNumber(tuple, {acc, noiseMag: tuple[0] - 1});
        }

        /**
         * 获取 `10` 的指定非负整数次幂。
         * 缓存上限内按需扩展十次幂表，超出上限时使用原生 BigInt 幂运算。
         *
         * @param {number} exp - 十进制幂指数。
         * @returns {bigint} 精确的 `10n ** BigInt(exp)`。
         * @throws {Error} 指数不是非负整数时抛出。
         */
        static pow10(exp) {
            if (!Number.isInteger(exp) || exp < 0) {
                throw new Error('[BigNumber] Input error: exponent for pow10 must be a non-negative integer.');
            }

            if (exp > BigNumber._MAX_POW10_CACHE_EXP) {
                return 10n ** BigInt(exp);
            }

            const cache = BigNumber._pow10Cache;

            // 按需扩展缓存，避免重复计算十的幂。
            while (cache.length <= exp) {
                cache.push(cache[cache.length - 1] * 10n);
            }

            return cache[exp];
        }

        /**
         * 计算数值绝对值的十进制数量级。
         *
         * @param {BigNumber|null|undefined} bn - 待检查的实数。
         * @returns {number} `floor(log10(|bn|))`；零值或空值返回 `-Infinity`。
         */
        static getMag(bn) {
            if (!bn || bn.isZero()) {
                return -Infinity;
            }
            return bn.power + BigNumber.decimalLengthBigInt(bn.mantissa) - 1;
        }

        /**
         * 计算一个 BigInt 的十进制位数。
         * 利用 `10^(2^k)` 倍增定位上界，再按二进制位从高到低整除缩减，
         * 无需构造任何中间的 `10^mid`，内存占用严格有界。
         *
         * @param {bigint} n - 待统计位数的整数；负值先取绝对值。
         * @returns {number} 十进制数字位数；`0n` 计为一位。
         */
        static decimalLengthBigInt(n) {
            if (n < 0n) {
                n = -n;
            }
            if (n < 10n) {
                return 1;
            }

            const cache = BigNumber._pow10TwoPowCache;
            const maxK = BigNumber._MAX_POW10_TWO_POW_K;

            // 超过常驻上限时，把临时平方结果放进局部变量，函数返回后立即释放。
            let extraPows = null;
            /**
             * 获取 10^(2^k) 的 BigInt 实例，优先读取常驻缓存，超出部分查阅局部临时缓存。
             * @param {number} k - 阶数索引。
             * @returns {bigint} 对应的 10^(2^k) 幂次。
             */
            const getPow = (k) => {
                if (k < cache.length) {
                    return cache[k];
                }
                return extraPows[k - maxK - 1];
            };

            // 1. 倍增找到最小 k，使 n < 10^(2^k)
            let k = 0;
            while (true) {
                let p;
                if (k < cache.length) {
                    p = cache[k];
                } else if (k <= maxK) {
                    const prev = cache[k - 1];
                    p = prev * prev;
                    cache.push(p);
                } else {
                    if (extraPows === null) {
                        extraPows = [];
                    }
                    const prev = getPow(k - 1);
                    p = prev * prev;
                    extraPows.push(p);
                }

                if (n < p) {
                    break;
                }
                k++;
            }

            // 2. 从高位向低位逐次折半逼近精确位数
            let len = 1;
            for (let j = k - 1; j >= 0; j--) {
                const p = getPow(j);
                if (n >= p) {
                    n /= p;
                    len += 2 ** j;
                }
            }

            return len;
        }

        /**
         * 检查一个字符串是否是无效的数字格式。
         *
         * @private
         * @param {string} input - 待验证的完整数值字面量；允许符号、小数和科学记数法，但不接受
         *   前后空白、单位、复数部分或仅含指数标记的不完整形式。
         * @returns {boolean} 如果字符串不是有效的数字格式，则返回 true，否则返回 false。
         */
        static _isInvalidNumericString(input) {
            // 此正则表达式匹配一个可选的[+/-]符号，后跟数字。
            // 它可以正确处理像 ".1" 和 "1." 这样的格式。
            const regex = /^([-+])?((\d+(\.\d*)?)|(\.\d+))$/;
            return ['', '.', '+', '-'].includes(input) || !regex.test(input);
        }

        /**
         * 将尾数舍入（银行家舍入）到指定精度，并通过调整指数来进行规范化。
         * 此函数使用高效的 BigInt 算术运算来处理大数。
         *
         * @private
         * @param {bigint|number} mantissa - 带符号整数尾数；`number` 仅用于能无损转为 BigInt 的整数，
         *   零值会规范化为统一的零表示。
         * @param {number} power - 与尾数配套的十进制安全整数指数；舍入移除的位数会补偿到该指数。
         * @param {number} acc - 舍入后最多保留的正整数有效位数；半舍情形按当前整数规则进位，
         *   末尾十进制零随后继续并入 `power`。
         * @param {number} [prevNoiseMag=-Infinity] - 舍入前已有的噪声量级上界。
         * @returns {{mantissa:bigint,power:number,noiseMag:number}} 规范化结果；`mantissa` 是舍入到 `acc` 位并移除
         *   十进制尾随零后的带符号整数，`power` 是补偿舍入位数和尾随零后对应的十进制指数，`noiseMag` 是更新后的噪声上界。
         *   输入尾数为零时返回统一的 `{mantissa:0n,power:0,noiseMag:-Infinity}`。
         */
        static _roundAndNormalize(mantissa, power, acc, prevNoiseMag = -Infinity) {
            if (typeof mantissa === 'number') {
                mantissa = BigInt(mantissa);
            }

            if (mantissa === 0n) {
                return {mantissa: 0n, power: 0, noiseMag: -Infinity};
            }

            const sign = mantissa < 0n ? -1n : 1n;
            let absMantissa = sign < 0n ? -mantissa : mantissa;
            let finalPower = power;
            let noiseMag = prevNoiseMag ?? -Infinity;

            // 构造精度阈值：10^acc
            // 当 absMantissa 大于该值时，说明尾数很可能超过目标有效位数，需要进一步计算实际位数
            const threshold = BigNumber.pow10(acc);

            if (absMantissa > threshold) {
                const mantissaLength = BigNumber.decimalLengthBigInt(absMantissa);
                const digitsToShift = mantissaLength - acc;

                if (digitsToShift > 0) {
                    const divisor = BigNumber.pow10(digitsToShift);

                    // 截断得到基础部分
                    let roundedMantissa = absMantissa / divisor;

                    // 获取被舍弃的余数部分
                    const remainder = absMantissa % divisor;

                    // 计算阈值：除数的一半
                    const halfDivisor = divisor / 2n;

                    if (remainder > halfDivisor) {
                        roundedMantissa++;
                    } else if (remainder === halfDivisor) {
                        // 恰好位于中点时使用向偶数舍入。
                        if ((roundedMantissa & 1n) === 1n) {
                            roundedMantissa++;
                        }
                    }

                    if (remainder !== 0n) {
                        const roundNoise = power + digitsToShift - 1;
                        noiseMag = Math.max(noiseMag, roundNoise);
                    }

                    absMantissa = roundedMantissa;
                    finalPower += digitsToShift;
                }
            }

            if (absMantissa === 0n) {
                return {mantissa: 0n, power: 0, noiseMag: -Infinity};
            }

            // 移除尾数末尾的零并补偿指数，使同一个数尽量只有一种内部表示，便于比较和后续运算。
            // 奇数不可能是 10 的倍数，常规热路径直接跳过取模。
            if ((absMantissa & 1n) === 0n) {
                while (absMantissa % 10n === 0n) {
                    absMantissa /= 10n;
                    finalPower++;
                }
            }

            return {mantissa: absMantissa * sign, power: finalPower, noiseMag};
        }

        /**
         * 解析一个数字字符串，并将其分解为指数和带符号的尾数。
         * 例如，"-123.45" 将被解析为 [-2, -12345n]。
         *
         * 逻辑解释:
         *   1. 找到第一个非零数字 (firstNonZero) 、最后一个非零数字 (lastNonZero) 和小数点 (decimalIndex) 的位置。
         *   2. 从 firstNonZero 到 lastNonZero 提取所有数字（忽略小数点）作为尾数 (mantissaStr)。
         *   3. 计算科学记数法的指数。这表示小数点需要移动多少位才能放到第一个有效数字的后面。
         *      例如 "123.45" 的 scientificExponent 是 2，
         *      而 "0.0123" 的 scientificExponent 是 -2。
         *   4. 最终的 power 是 scientificExponent 减去尾数的小数部分长度。
         *      例如 "123.45", mantissa="12345", scientificExponent=2.
         *      power = 2 - (5 - 1) = -2. 最终表示为 12345 * 10^-2.
         *
         * @private
         * @param {string} numStr - 已通过格式校验的普通或科学记数法字符串；方法提取符号、小数位和
         *   显式指数，返回规范化前的十进制指数与整数尾数，不负责最终精度舍入。
         * @returns {[number, bigint]} 解析后的 `[power, mantissa]`；第 0 项已合并小数位数与科学计数
         *   指数，第 1 项是移除小数点后的带符号整数尾数。此阶段不附加精度，也不删除尾随零。
         */
        static _parseNumericString(numStr) {
            const len = numStr.length;
            if (len === 0) {
                return [0, 0n];
            }

            let isNegative = false;
            let startIndex = 0;
            const firstChar = numStr[0];
            if (firstChar === '-') {
                isNegative = true;
                startIndex = 1;
            } else if (firstChar === '+') {
                startIndex = 1;
            }

            let firstNonZero = -1, lastNonZero = -1, decimalIndex = -1;
            for (let i = startIndex; i < len; i++) {
                const char = numStr[i];
                if (char > '0' && char <= '9') {
                    if (firstNonZero === -1) {
                        firstNonZero = i;
                    }
                    lastNonZero = i;
                } else if (char === '.') {
                    decimalIndex = i;
                }
            }

            if (firstNonZero === -1) {
                return [0, 0n];
            }

            // 通过提取第一个和最后一个非零数字之间的所有数字（并移除小数点）来构建尾数。
            const mantissaStr = (decimalIndex > firstNonZero && decimalIndex < lastNonZero)
                                ? numStr.slice(firstNonZero, decimalIndex) + numStr.slice(decimalIndex + 1, lastNonZero + 1)
                                : numStr.slice(firstNonZero, lastNonZero + 1);

            // 根据小数点相对于有效数字的位置来确定指数。
            const effectiveDecimalIndex = (decimalIndex === -1) ? len : decimalIndex;
            const scientificExponent = (firstNonZero < effectiveDecimalIndex)
                                       ? (effectiveDecimalIndex - firstNonZero - 1)
                                       : (effectiveDecimalIndex - firstNonZero);

            const power = scientificExponent - (mantissaStr.length - 1);

            let mantissa = BigInt(mantissaStr);
            if (isNegative) {
                mantissa = -mantissa;
            }

            return [power, mantissa];
        }

        /**
         * 获取当前 BigNumber 实例的十进制数量级。
         *
         * @returns {number}
         */
        getMag() {
            return BigNumber.getMag(this);
        }

        /**
         * 判断当前 BigNumber 实例的值是否等于零。
         * 该方法通过检查内部的尾数是否为 `0n` 来实现。
         * 在高精度计算中，这是判断数值是否为绝对零的最快方式。
         * @returns {boolean} 如果值为零返回 `true`，否则返回 `false`。
         */
        isZero() {
            return this.mantissa === 0n;
        }

        /**
         * 判断当前 BigNumber 实例的值是否大于零。
         * 注意：此方法仅在值严格大于零时返回 `true`。
         * 如果实例的值为零或负数，将返回 `false`。
         * @returns {boolean} 如果值为正数返回 `true`，否则返回 `false`。
         */
        isPositive() {
            return this.mantissa > 0n;
        }

        /**
         * 判断当前 BigNumber 实例的值是否小于零。
         * 该方法用于检测数值的符号位。
         * 值得注意的是，对于某些科学记数法实现，零通常被视为既非正也非负。
         * @returns {boolean} 如果值为负数返回 `true`，否则返回 `false`。
         */
        isNegative() {
            return this.mantissa < 0n;
        }

        /**
         * 返回 BigNumber 实例的内部数组表示。
         * 值得注意的是，由于它返回一个数组（一个对象）而非一个原始类型（如 number 或 string），
         * 因此它不会像原生 Number 类型那样在标准的算术运算中触发自动类型转换。
         * 例如，`new BigNumber(2) + new BigNumber(3)` 不会因为此方法而直接得到一个数字结果，
         * 而是会触发默认的对象到字符串的转换行为。
         * @returns {[number, bigint, number]} 当前值的 `[power, mantissa, acc]` 快照；三项分别表示
         *   十进制指数、带符号整数尾数和有效位数。返回新数组，但其中均为原始值，可安全传给新构造器。
         */
        valueOf() {
            return [this.power, this.mantissa, this.acc];
        }

        /**
         * 将 BigNumber 实例转换为十进制字符串。
         *
         * @param {object} [options={}] - 本次转换的格式化选项。
         * @param {number} [options.acc=this.acc] - 希望保留的正整数有效位数；低于当前尾数位数时会舍入。
         * @param {'auto'|'normal'|'scientific'} [options.mode='auto'] - `normal` 输出普通小数，`scientific`
         *   输出科学记数法。`auto` 在舍入后按小数点位置与 `CalcConfig.TO_STRING_AUTOMATIC_SWITCH_LENGTH` 选择。
         * @returns {string} 格式化后的实数字符串。
         * @throws {Error} `acc` 转为数值后不是正整数、`mode` 无效或普通写法超出 `CalcConfig.MAX_TO_STRING_LENGTH` 限制时抛出。
         */
        toString({acc = this.acc, mode = 'auto'} = {}) {
            acc = Number(acc);
            if (!Number.isInteger(acc) || acc <= 0) {
                throw new Error('[BigNumber] Input error: Accuracy for toString must be a positive integer.');
            }

            const {
                mantissa: finalMantissa,
                power: finalPower
            } = BigNumber._roundAndNormalize(this.mantissa, this.power, acc);

            let resultString;
            const isNegative = finalMantissa < 0n;
            const mantissaStr = (isNegative ? -finalMantissa : finalMantissa).toString();
            const mantissaLength = mantissaStr.length;

            if (mode === 'auto') {
                mode = Math.abs(mantissaLength + finalPower) > CalcConfig.TO_STRING_AUTOMATIC_SWITCH_LENGTH ? 'scientific' : 'normal';
            }

            switch (mode) {
                case 'normal':
                    if (finalMantissa === 0n) {
                        return '0';
                    }

                    if (finalPower >= 0) {
                        if (mantissaLength + finalPower > CalcConfig.MAX_TO_STRING_LENGTH) {
                            throw new Error('[BigNumber] Range error: Number is too large to be represented as a string.');
                        }
                        resultString = mantissaStr + '0'.repeat(finalPower);
                    } else {
                        const absPower = -finalPower;
                        if (mantissaLength > absPower) {
                            // 小数点位于尾数内部
                            if (mantissaLength > CalcConfig.MAX_TO_STRING_LENGTH) {
                                throw new Error('[BigNumber] Range error: Number is too large to be represented as a string.');
                            }
                            const decimalPosition = mantissaLength - absPower;
                            resultString = mantissaStr.slice(0, decimalPosition) + '.' + mantissaStr.slice(decimalPosition);
                        } else {
                            // 数字小于 1；前置 "0." 和引导零
                            const leadingZeros = absPower - mantissaLength;
                            if (2 + leadingZeros + mantissaLength > CalcConfig.MAX_TO_STRING_LENGTH) {
                                throw new Error('[BigNumber] Range error: Number is too small to be represented as a string.');
                            }
                            resultString = '0.' + '0'.repeat(leadingZeros) + mantissaStr;
                        }
                    }

                    if (isNegative) {
                        return '-' + resultString;
                    }
                    return resultString;

                case 'scientific': {
                    if (finalMantissa === 0n) {
                        return '0E+0';
                    }

                    const midString = mantissaStr.slice(1);
                    const midLength = midString.length;
                    const scientificPower = BigInt(midLength === 0 ? finalPower : (finalPower + midLength));
                    if (midLength === 0) {
                        resultString = `${mantissaStr}${scientificPower < 0n ? 'E' : 'E+'}${scientificPower.toString()}`;
                    } else {
                        resultString = `${mantissaStr[0]}.${midString}${scientificPower < 0n ? 'E' : 'E+'}${scientificPower.toString()}`;
                    }

                    if (isNegative) {
                        return '-' + resultString;
                    }
                    return resultString;
                }

                default:
                    throw new Error(`[BigNumber] Input error: Invalid mode '${mode}'.`);
            }
        }
    }

    /**
     * 以两个不可变 `BigNumber` 表示的任意精度复数。
     *
     * @class ComplexNumber
     */
    class ComplexNumber {
        /**
         * 预编译的复数完整语法正则：
         * - 允许空白出现在首尾、项间 +/- 两侧及 * 两侧，禁止出现在数字内部；
         * - 虚部支持 NUM[*]?i、i[*]?NUM、单独 i，杜绝 NUM i NUM 拼接；
         * - 存在第二项时，中间必须有显式的 + 或 - 分隔。
         * @private
         */
        static _COMPLEX_REGEX = (() => {
            const NUM = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
            const IMAG = `(?:(?:${NUM})(?:\\s*\\*\\s*)?i|i(?:\\s*\\*\\s*)?(?:${NUM})|i)`;
            const TERM = `(?:${IMAG}|${NUM})`;
            return new RegExp(`^\\s*([+-]?)\\s*(${TERM})(?:\\s*([+-])\\s*(${TERM}))?\\s*$`);
        })();

        /**
         * 从代数字符串、实数、同类对象或内部数组创建复数。
         *
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array|object} x - 要转换的实数或复数。
         *   字符串支持代数形式 `a+bi`；二元数组表示 `[real, imag]`，三元数值数组表示
         *   `[power, mantissa, acc]`；已有实例按指定精度复制。含歧义或多个虚数单位的字符串会被拒绝。
         * @param {object} [options={}] - 构造精度与缩放选项；对象本身不会被修改。
         * @param {number} [options.acc] - 实部和虚部共同采用的正整数计算精度；省略时优先沿用输入精度，
         *   未自带精度的分量采用 `CalcConfig.globalCalcAccuracy`。`[real, imag]` 的两分量对齐至较低精度。
         * @param {number} [options.pow=0] - 同时施加于实部、虚部的十进制指数偏移，等价于整体乘以
         *   `10 ** pow`；必须满足底层 `BigNumber` 的安全指数约束。
         * @param {number|[number, number]} [options.noiseMag] - 噪声量级上界；单值用于实数或共同基准，二元数组用于分别指定实部与虚部。
         * @throws {Error} 输入类型或格式无效时抛出。
         */
        constructor(x, {acc, pow = 0, noiseMag} = {}) {
            const hasComponentNoise = Array.isArray(noiseMag);
            const noiseR = hasComponentNoise ? noiseMag[0] : noiseMag;
            const noiseI = hasComponentNoise ? noiseMag[1] : noiseMag;

            switch (Public.typeOf(x)) {
                case 'array': {
                    // 长度为 2: [real, imag]
                    // 长度为 3: [power, mantissa, acc] (一个 BigNumber 序列化数组。若 acc 小于等于0，则按照默认精度构造)
                    const len = x.length;
                    if (![2, 3].includes(len)) {
                        throw new Error('[ComplexNumber] Input error: Array length must be 2 or 3.');
                    }
                    if (len === 2) {
                        let r = new BigNumber(x[0], {acc: acc, pow: pow, noiseMag: noiseR});
                        let i = new BigNumber(x[1], {acc: acc, pow: pow, noiseMag: noiseI});

                        const finalAcc = Math.min(r.acc, i.acc);

                        // 复数的实部和虚部对齐到较低精度，防止低精度分量被误当更高有效位数参与后续运算。
                        if (r.acc > finalAcc) {
                            r = new BigNumber(r, {acc: finalAcc});
                        }
                        if (i.acc > finalAcc) {
                            i = new BigNumber(i, {acc: finalAcc});
                        }

                        this.re = r;
                        this.im = i;
                    } else {
                        this.re = new BigNumber(x, {acc: acc, pow: pow, noiseMag: noiseR});
                        this.im = new BigNumber([0, 0n, this.re.acc]);
                    }
                    break;
                }

                case 'bignumber':
                    this.re = new BigNumber(x, {
                        acc: acc,
                        pow: pow,
                        noiseMag: noiseR
                    });
                    this.im = new BigNumber([0, 0n, this.re.acc]);
                    break;

                case 'complexnumber':
                case 'object': {
                    const realAccuracy = acc ?? x.acc;
                    this.re = new BigNumber(x.re, {acc: realAccuracy, pow: pow, noiseMag: noiseR});
                    this.im = new BigNumber(x.im, {acc: realAccuracy, pow: pow, noiseMag: noiseI});
                    break;
                }

                case 'string': {
                    if (x.length > CalcConfig.MAX_INPUT_STRING_LENGTH) {
                        throw new Error(`[ComplexNumber] Input string length exceeds maximum allowed length of ${CalcConfig.MAX_INPUT_STRING_LENGTH}.`);
                    }

                    const ParseComplex = ComplexNumber._parseComplex(x);
                    this.re = new BigNumber(ParseComplex.re, {acc: acc, pow: pow, noiseMag: noiseR});
                    this.im = new BigNumber(ParseComplex.im, {acc: acc, pow: pow, noiseMag: noiseI});
                    break;
                }

                case 'number':
                case 'bigint':
                    this.re = new BigNumber(x, {acc: acc, pow: pow, noiseMag: noiseR});
                    this.im = new BigNumber([0, 0n, this.re.acc]);
                    break;

                default:
                    throw new Error('[ComplexNumber] Unsupported input type or invalid number format.');
            }

            this.onlyReal = this.im.mantissa === 0n;
            this.acc = Math.min(this.re.acc, this.im.acc);
        }

        /**
         * 自定义 `Object.prototype.toString.call()` 的返回值。
         * 这使得 `Public.typeOf` 对 `ComplexNumber` 实例返回 `complexnumber`。
         *
         * @readonly
         * @type {string}
         */
        get [Symbol.toStringTag]() {
            return 'ComplexNumber';
        }

        /**
         * 一个健壮的复数解析器，能从字符串中提取实部和虚部。
         * 此方法设计用于处理多种常见的复数格式，包括：
         *   - 标准代数形式: "a+bi", "a-bi", "a + bi"
         *   - 纯实数或纯虚数: "a", "bi", "-bi"
         *   - 科学记数法: "-1.23e-4 + 5.67e+8i"
         *   - J/j 作为虚数单位: "3+4j"
         *   - 乘号和顺序变化: "3+i*4", "i*4+3"
         *   - 隐式系数为 1: "a+i", "a-i", "i", "-i"
         *
         * @private
         *
         * @param {string} complexString - 代数形式的完整复数字符串；支持实数、纯虚数、`a±bi` 及
         *   科学记数法分量。正负号只有在不属于指数时才分隔实部和虚部，多个 `i` 或空分量会抛错。
         * @returns {{re:string,im:string}} 已分离但尚未构造高精度数的两个十进制分量；`re` 不含
         *   虚数单位，`im` 去除末尾 `i` 并保留正负号。纯实数补 `im:'0'`，纯虚数补 `re:'0'`，
         *   裸 `i`/`-i` 分别把虚部规范化为 `1`/`-1`。
         * @throws {Error} 如果输入字符串的格式无效或不明确。
         */
        static _parseComplex(complexString) {
            // 仅统一虚数单位并移除数字间的千分位下划线，不盲目删空白、不做字符置换。
            const normalized = complexString
                .replace(/[JjI]/g, 'i')
                .replace(/\[i]/g, 'i')
                .replace(/(?<=\d)_(?=\d)/g, '');

            const match = normalized.match(ComplexNumber._COMPLEX_REGEX);
            if (!match) {
                throw new Error(`[ComplexNumber] Invalid complex number format: '${complexString}'.`);
            }

            const [, sign1, term1, sign2, term2] = match;
            const terms = term2 !== undefined
                          ? [[sign1, term1], [sign2, term2]]
                          : [[sign1, term1]];

            let realPart = '0', hasReal = false;
            let imagPart = '0', hasImag = false;

            for (const [sign, rawTerm] of terms) {
                const prefix = sign === '-' ? '-' : '';
                if (rawTerm.includes('i')) {
                    if (hasImag) {
                        throw new Error(`[ComplexNumber] Invalid complex number format: '${complexString}'.`);
                    }
                    hasImag = true;
                    const mag = rawTerm === 'i' ? '1' : rawTerm.replace(/[i*\s]/g, '');
                    imagPart = prefix + mag;
                } else {
                    if (hasReal) {
                        throw new Error(`[ComplexNumber] Invalid complex number format: '${complexString}'.`);
                    }
                    hasReal = true;
                    realPart = prefix + rawTerm;
                }
            }

            return {re: realPart, im: imagPart};
        }

        /**
         * 判断当前 ComplexNumber 实例的值是否等于零。
         * 该方法要求此示例实部和虚部都必须为 0。
         * 在高精度计算中，这是判断数值是否为绝对零的最快方式。
         * @returns {boolean} 如果值为零返回 `true`，否则返回 `false`。
         */
        isZero() {
            return this.re.mantissa === 0n && this.im.mantissa === 0n;
        }

        /**
         * 返回 ComplexNumber 实例的内部嵌套数组表示。
         * 它通过递归调用其 `re` 和 `im` 组件（它们是 BigNumber 实例）的 `valueOf` 方法来工作。
         * @returns {[[number,bigint,number], [number,bigint,number]]} `[realTuple, imagTuple]` 快照；
         *   两个三元组都采用 `BigNumber.valueOf()` 的 `[power, mantissa, acc]` 顺序。外层和内层均为新数组，
         *   可直接构造等值 `ComplexNumber` 而不会共享可变容器。
         */
        valueOf() {
            return [this.re.valueOf(), this.im.valueOf()];
        }

        /**
         * 将 ComplexNumber 实例转换为内部数学词元字符串。
         *
         * @param {object} [options={}] - 本次转换的格式化选项。
         * @param {number} [options.acc=this.acc] - 传给实部、虚部或极坐标分量的正整数有效位数。
         * @param {'algebra'|'polar'} [options.printMode=CalcConfig.globalPrintMode] - `algebra` 使用 `[i]` 输出代数形式，
         *   `polar` 以 `[toPolar]` 连接模与主辐角。纯实输入直接格式化实部。
         * @param {'auto'|'normal'|'scientific'} [options.mode='auto'] - 传给各 `BigNumber` 分量的记数法；
         *   `auto` 可分别为各分量选择普通或科学记数法。
         * @returns {string} 可供词元解析器读取的数值表达式。
         * @throws {Error} 非实输入的 `printMode` 无效，或分量转换失败时抛出。
         */
        toString({acc = this.acc, printMode = CalcConfig.globalPrintMode, mode = 'auto'} = {}) {
            if (this.onlyReal) {
                return this.re.toString({acc: acc, mode: mode});
            }

            switch (printMode) {
                case 'algebra': {
                    const reStr = this.re.toString({acc: acc, mode: mode});
                    const rawImStr = this.im.toString({acc: acc, mode: mode});
                    const isOne = ['1', '1E+0'].includes(rawImStr);
                    const isNegOne = ['-1', '-1E+0'].includes(rawImStr);
                    const imStr = rawImStr.includes('E') ? `${rawImStr}*` : rawImStr;

                    if (['0', '0E+0'].includes(reStr)) {
                        if (isOne) {
                            return '[i]';
                        }
                        if (isNegOne) {
                            return '-[i]';
                        }
                        return `${imStr}[i]`;
                    }

                    if (this.im.isNegative()) {
                        return isNegOne ? `${reStr}-[i]` : `${reStr}${imStr}[i]`;
                    } else {
                        return isOne ? `${reStr}+[i]` : `${reStr}+${imStr}[i]`;
                    }
                }

                case 'polar': {
                    // 计算模长和辐角
                    const modulus = MathPlus.abs(this).re.toString({acc: acc, mode: mode});
                    let argument = MathPlus.arg(this).re.toString({acc: acc, mode: mode});
                    if (argument.includes('E')) {
                        argument = `(${argument})`;
                    }

                    if (['0', '0E+0'].includes(argument)) {
                        return modulus;
                    }
                    return `${modulus}[toPolar]${argument}`;
                }

                default:
                    throw new Error(`[ComplexNumber] Input error: Invalid printMode '${printMode}'.`);
            }
        }
    }

    /**
     * 提供基于 `BigNumber` 和 `ComplexNumber` 的数学运算。
     *
     * @class MathPlus
     */
    class MathPlus {
        /** @private */
        static _ExpressionSyntaxError = class extends SyntaxError {
            name = 'ExpressionSyntaxError';
        };

        /**
         * 阻止实例化静态工具类。
         *
         * @throws {Error} 始终抛出。
         */
        constructor() {
            throw new Error('[MathPlus] MathPlus is a static class and should not be instantiated.');
        }

        /**
         * 解析复数输入；已有实例仅在需要统一或变更分量精度时重新构造。
         *
         * @private
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array|object} x - `ComplexNumber` 可接受的数值表示。
         * @param {number} [acc] - 目标有效位数；省略时沿用输入精度或构造器默认规则。
         * @returns {ComplexNumber} 解析后的复数；两分量已满足目标精度时直接返回原复数实例。
         */
        static _complexInput(x, acc) {
            if (x instanceof ComplexNumber) {
                acc ??= x.acc;
                if (x.re.acc === acc && x.im.acc === acc) {
                    return x;
                }
            }
            return new ComplexNumber(x, {acc});
        }

        /**
         * 合并新增的噪声上界，并复用无需更新的实数实例。
         *
         * @private
         * @param {BigNumber} value - 携带现有噪声上界的实数。
         * @param {number} noiseMag - 新估算出的十进制噪声量级上界。
         * @returns {BigNumber} 采用较大噪声上界的新实数实例，或已满足该上界的原实例。
         */
        static _withNoise(value, noiseMag) {
            return noiseMag > value.noiseMag ? new BigNumber(value, {noiseMag}) : value;
        }

        /**
         * 复用不可变数值实例；仅在入口解析外部输入，纯实数不装箱为复数。
         * @private
         * @param {*} x - 与公开算术接口相同的输入。
         * @returns {BigNumber|ComplexNumber} 实数分量或非实复数。
         */
        static _arithmeticInput(x) {
            if (x instanceof BigNumber) {
                return x;
            }
            if (typeof x === 'number' || typeof x === 'bigint' || (Array.isArray(x) && x.length === 3)) {
                return new BigNumber(x);
            }
            const parsed = x instanceof ComplexNumber ? x : new ComplexNumber(x);
            const input = MathPlus._complexInput(parsed);
            return input.onlyReal ? input.re : input;
        }

        /**
         * 在输入的工作精度下同时计算实数双曲正弦和双曲余弦。
         * @private
         * @param {BigNumber} x - 实数自变量。
         * @returns {[BigNumber, BigNumber]} 依次为 sinh(x) 和 cosh(x)。
         */
        static _realSinhCosh(x) {
            const acc = x.acc;
            const one = new BigNumber(1n, {acc});
            if (x.isZero()) {
                return [x, one];
            }

            const mag = BigNumber.getMag(x);
            // 由 |x| < 10^(mag+1) 可知，极小时平方修正低于工作精度，也无需构造可能下溢的 x²。
            if (2 * (mag + 1) <= -acc) {
                const maxMag = Math.max(mag, x.noiseMag) + 1;
                return [MathPlus._withNoise(x, 3 * maxMag), MathPlus._withNoise(one, 2 * maxMag)];
            }

            if (mag < -1) {
                const square = MathPlus.realTimes(x, x);
                const minMag = mag - acc - 1;
                let sinh = x;
                let term = x;
                let i = 1;
                // 相邻项同号，每次至少缩小两个数量级，按 sinh 的相对精度停止。
                while (BigNumber.getMag(term) > minMag) {
                    term = MathPlus.realDivide(
                        MathPlus.realTimes(term, square),
                        new BigNumber(BigInt(2 * i) * BigInt(2 * i + 1), {acc})
                    );
                    sinh = MathPlus.realPlus(sinh, term);
                    i++;
                }
                const cosh = MathPlus.sqrt(MathPlus.realPlus(one, MathPlus.realTimes(sinh, sinh))).re;
                return [sinh, cosh];
            }

            const negative = x.isNegative();
            const exp = MathPlus.exp(negative ? MathPlus.oppositeNumber(x) : x).re;
            const inverse = MathPlus.realDivide(one, exp);
            const half = new BigNumber(5n, {pow: -1, acc});
            const sinh = MathPlus.realTimes(half, MathPlus.realMinus(exp, inverse));
            const cosh = MathPlus.realTimes(half, MathPlus.realPlus(exp, inverse));

            return [negative ? MathPlus.oppositeNumber(sinh) : sinh, cosh];
        }

        /**
         * 计算一个 BigNumber 或 ComplexNumber 的相反数。
         *
         * @param {BigNumber|ComplexNumber|string|number} x - 需要取反的值；`BigNumber` 返回同类型新实例，
         *   其余可转换输入统一返回 `ComplexNumber`，传入对象本身不会被修改。
         * @returns {BigNumber|ComplexNumber} 输入值的相反数。
         */
        static oppositeNumber(x) {
            switch (Public.typeOf(x)) {
                case 'bignumber':
                    return new BigNumber(-x.mantissa, {pow: x.power, acc: x.acc, noiseMag: x.noiseMag});

                case 'complexnumber':
                    return new ComplexNumber([MathPlus.oppositeNumber(x.re), MathPlus.oppositeNumber(x.im)]);

                default: {
                    const input = MathPlus._complexInput(x);
                    return MathPlus.oppositeNumber(input);
                }
            }
        }

        /**
         * 纯实数加法核，保留原有舍入、精度和噪声传播规则。
         * @param {BigNumber} reA - 第一个操作数。
         * @param {BigNumber} reB - 第二个操作数。
         * @returns {BigNumber} 新的实数结果。
         */
        static realPlus(reA, reB) {
            const resultAcc = Math.min(reA.acc, reB.acc);
            const combinedNoiseMag = Math.max(reA.noiseMag ?? -Infinity, reB.noiseMag ?? -Infinity);

            if (reA.isZero()) {
                return new BigNumber(reB, {acc: resultAcc});
            }
            if (reB.isZero()) {
                return new BigNumber(reA, {acc: resultAcc});
            }

            let mantissaA = reA.mantissa;
            let mantissaB = reB.mantissa;
            const powerDifference = reB.power - reA.power;

            const guardAcc = resultAcc + 5;
            if (powerDifference > guardAcc) {
                // 快路径：即使 mA 占满 reA.acc 位也追不上，O(1) 直接返回
                if (powerDifference > reA.acc + guardAcc) {
                    return new BigNumber(reB, {
                        acc: resultAcc,
                        noiseMag: Math.max(combinedNoiseMag, reA.power + reA.acc - 1)
                    });
                }
                const magA = BigNumber.getMag(reA);
                const magB = BigNumber.getMag(reB);
                if (magB - magA > guardAcc) {
                    return new BigNumber(reB, {
                        acc: resultAcc,
                        noiseMag: Math.max(combinedNoiseMag, magA)
                    });
                }
            } else if (powerDifference < -guardAcc) {
                if (-powerDifference > reB.acc + guardAcc) {
                    return new BigNumber(reA, {
                        acc: resultAcc,
                        noiseMag: Math.max(combinedNoiseMag, reB.power + reB.acc - 1)
                    });
                }
                const magA = BigNumber.getMag(reA);
                const magB = BigNumber.getMag(reB);
                if (magA - magB > guardAcc) {
                    return new BigNumber(reA, {
                        acc: resultAcc,
                        noiseMag: Math.max(combinedNoiseMag, magB)
                    });
                }
            }

            if (powerDifference < 0) {
                // 对齐到较小的十进制指数后再相加尾数，保持 `mantissa * 10^power` 表示一致。
                mantissaA *= BigNumber.pow10(-powerDifference);
            } else if (powerDifference > 0) {
                mantissaB *= BigNumber.pow10(powerDifference);
            }

            const resultMantissa = mantissaA + mantissaB;
            const resultPower = Math.min(reA.power, reB.power);

            return new BigNumber(resultMantissa, {
                pow: resultPower,
                acc: resultAcc,
                noiseMag: combinedNoiseMag
            });
        }

        /**
         * 纯实数乘法核，保留原有舍入、精度和噪声传播规则。
         * @param {BigNumber} reA - 第一个操作数。
         * @param {BigNumber} reB - 第二个操作数。
         * @returns {BigNumber} 新的实数结果。
         */
        static realTimes(reA, reB) {
            // (m1 * 10^p1)(m2 * 10^p2) = (m1m2) * 10^(p1+p2)。
            const resultMantissa = reA.mantissa * reB.mantissa;
            const resultPower = reA.power + reB.power;
            const resultAcc = Math.min(reA.acc, reB.acc);

            const noiseA = reA.noiseMag ?? -Infinity;
            const noiseB = reB.noiseMag ?? -Infinity;
            const propagatedNoise = (reA.isZero() || reB.isZero()) ? -Infinity : Math.max(
                noiseA === -Infinity ? -Infinity : noiseA + BigNumber.getMag(reB),
                noiseB === -Infinity ? -Infinity : noiseB + BigNumber.getMag(reA),
                noiseA === -Infinity || noiseB === -Infinity ? -Infinity : noiseA + noiseB
            );

            return new BigNumber(resultMantissa, {
                pow: resultPower,
                acc: resultAcc,
                noiseMag: propagatedNoise
            });
        }

        /**
         * 纯实数除法核，按目标精度执行银行家舍入并传播噪声。
         * @param {BigNumber} reA - 第一个操作数。
         * @param {BigNumber} reB - 第二个操作数。
         * @returns {BigNumber} 新的实数结果。
         */
        static realDivide(reA, reB) {
            if (reB.isZero()) {
                throw new Error('[MathPlus] mathematical error: Division by zero.');
            }

            const resultAcc = Math.min(reA.acc, reB.acc);
            if (reA.isZero()) {
                return new BigNumber(0n, {acc: resultAcc});
            }

            const lenA = BigNumber.decimalLengthBigInt(
                (reA.isNegative() ? -reA.mantissa : reA.mantissa)
            );
            const lenB = BigNumber.decimalLengthBigInt(
                (reB.isNegative() ? -reB.mantissa : reB.mantissa)
            );

            // BigInt 除法会截断，因此先按目标精度、尾数位数差和保护位放大被除数。
            const scalingDigits = resultAcc + lenB - lenA + 4;
            const finalScalingDigits = Math.max(0, scalingDigits);
            const scaledMantissaA = reA.mantissa * BigNumber.pow10(finalScalingDigits);
            let resultMantissa = scaledMantissaA / reB.mantissa;
            let resultPower = reA.power - reB.power - finalScalingDigits;
            const remainder = scaledMantissaA - resultMantissa * reB.mantissa;

            const noiseA = reA.noiseMag ?? -Infinity;
            const noiseB = reB.noiseMag ?? -Infinity;
            const magA = BigNumber.getMag(reA);
            const magB = BigNumber.getMag(reB);
            const termA = noiseA === -Infinity ? -Infinity : noiseA - magB;
            const termB = noiseB === -Infinity ? -Infinity : noiseB + magA - 2 * magB;
            let divisionNoise = Math.max(termA, termB);

            if (remainder !== 0n) {
                const magRes = BigNumber.decimalLengthBigInt(resultMantissa) + resultPower - 1;
                const roundNoise = magRes - resultAcc;
                divisionNoise = Math.max(divisionNoise, roundNoise);

                // 在保护位之后补上与商同号的粘滞位，防止非零余数被误判为精确中点。
                resultMantissa = resultMantissa * 10n + (resultMantissa < 0n ? -1n : 1n);
                resultPower--;
            }

            return new BigNumber(resultMantissa, {
                pow: resultPower,
                acc: resultAcc,
                noiseMag: divisionNoise
            });
        }

        /**
         * 纯实数减法，不经过复数接口。
         * @param {BigNumber} a - 被减数。
         * @param {BigNumber} b - 减数。
         * @returns {BigNumber} 差。
         */
        static realMinus(a, b) {
            return MathPlus.realPlus(a, MathPlus.oppositeNumber(b));
        }

        /**
         * 提取复数的实部。
         *
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 可由 `ComplexNumber` 构造的输入；
         *   返回值复制其实部并将虚部置零，不修改原实例。
         * @returns {ComplexNumber} 以纯实数表示的实部。
         */
        static re(x) {
            const input = MathPlus._complexInput(x);
            return new ComplexNumber(input.re);
        }

        /**
         * 提取复数的虚部。
         *
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 可由 `ComplexNumber` 构造的输入；
         *   返回值把原虚部作为纯实数保存，而不是返回带虚数单位的分量。
         * @returns {ComplexNumber} 以纯实数表示的虚部。
         */
        static im(x) {
            const input = MathPlus._complexInput(x);
            return new ComplexNumber(input.im);
        }

        /**
         * 计算复数在 (-π, π] 内的辐角，等价于 atan2(im, re)。
         *
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 非零实数或复数；结果采用
         *   `(-π, π]` 内的主辐角。零值没有唯一辐角，调用方不应依赖其结果。
         * @returns {ComplexNumber} 以弧度表示的辐角。
         */
        static arg(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            const zero = new ComplexNumber([0, 0n, acc]);

            if (input.re.isZero()) {
                if (input.onlyReal) {
                    throw new Error('[MathPlus] The argument of 0 is undefined.');
                }
                return MathPlus.divide(
                    BigNumber.approximateConstant(CalcConfig.constants.pi),
                    [0, input.im.isNegative() ? -2n : 2n, acc]
                );
            }
            if (input.onlyReal) {
                return input.re.isPositive() ? zero : new ComplexNumber(BigNumber.approximateConstant(CalcConfig.constants.pi, acc));
            }

            // 按实部符号修正 arctan(im/re) 的象限。
            const result = MathPlus.arctan(MathPlus.divide(input.im, input.re));

            if (input.re.isNegative()) {
                return MathPlus[input.im.isNegative() ? 'minus' : 'plus'](result, BigNumber.approximateConstant(CalcConfig.constants.pi));
            }

            return result;
        }

        /**
         * 计算一个复数的共轭复数。
         * 共轭复数的实部与原数相同，虚部符号相反 (a + bi → a - bi)。
         * 这个实现通过复用 oppositeNumber 辅助方法来提高代码的抽象性和可读性。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 输入值。可以是表示复数或实数的任何受支持的类型。
         * @returns {ComplexNumber} 一个新的 ComplexNumber 实例，代表输入值的共轭复数。
         */
        static conj(x) {
            const input = MathPlus._complexInput(x);

            return new ComplexNumber([input.re, MathPlus.oppositeNumber(input.im)]);
        }

        /**
         * 将极坐标 (r, θ) 转换为笛卡尔坐标下的复数 (x + yi)。
         * - 计算公式为：r * (cos(θ) + i * sin(θ))。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} a - 极坐标模长 `r`；应为非负实数，
         *   其精度参与最终实部、虚部的有效位数计算。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} b - 以弧度表示的辐角 `θ`；应为实数，
         *   可超出一个周期，三角函数会自行归约。
         * @returns {ComplexNumber} 代表转换后笛卡尔坐标的 ComplexNumber 实例。
         */
        static toPolar(a, b) {
            const inputA = MathPlus._arithmeticInput(a);
            const inputB = MathPlus._complexInput(b);
            const acc = Math.min(inputA.acc, inputB.acc);
            const cosTheta = MathPlus.cos(inputB);
            const sinTheta = MathPlus.sin(inputB);
            const complexExponential = MathPlus.plus(
                cosTheta,
                [MathPlus.oppositeNumber(sinTheta.im), sinTheta.re]
            );
            const result = MathPlus.times(inputA, complexExponential);
            return MathPlus._complexInput(result, acc);
        }

        /**
         * 计算两个数的和。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} a - 第一个加数。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} b - 第二个加数。
         * @returns {ComplexNumber} 代表两个数之和的 ComplexNumber 实例。
         */
        static plus(a, b) {
            const numberA = MathPlus._arithmeticInput(a);
            const numberB = MathPlus._arithmeticInput(b);
            if (numberA instanceof BigNumber && numberB instanceof BigNumber) {
                return new ComplexNumber(MathPlus.realPlus(numberA, numberB));
            }

            const inputA = numberA instanceof ComplexNumber ? numberA : new ComplexNumber(numberA);
            const inputB = numberB instanceof ComplexNumber ? numberB : new ComplexNumber(numberB);

            const resultRe = MathPlus.realPlus(inputA.re, inputB.re);
            const resultIm = MathPlus.realPlus(inputA.im, inputB.im);
            return new ComplexNumber([resultRe, resultIm]);
        }

        /**
         * 计算两个数的差 (a - b)。
         * 纯实数直接调用实数核，复数分别计算实部和虚部的差。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} a - 被减数。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} b - 减数。
         * @returns {ComplexNumber} 代表两个数之差的 ComplexNumber 实例。
         */
        static minus(a, b) {
            const numberA = MathPlus._arithmeticInput(a);
            const numberB = MathPlus._arithmeticInput(b);
            if (numberA instanceof BigNumber && numberB instanceof BigNumber) {
                return new ComplexNumber(MathPlus.realMinus(numberA, numberB));
            }

            const inputA = numberA instanceof ComplexNumber ? numberA : new ComplexNumber(numberA);
            const inputB = numberB instanceof ComplexNumber ? numberB : new ComplexNumber(numberB);

            const resultRe = MathPlus.realMinus(inputA.re, inputB.re);
            const resultIm = MathPlus.realMinus(inputA.im, inputB.im);
            return new ComplexNumber([resultRe, resultIm]);
        }

        /**
         * 计算两个数的乘积。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} a - 第一个乘数。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} b - 第二个乘数。
         * @returns {ComplexNumber} 代表两个数乘积的 ComplexNumber 实例。
         */
        static times(a, b) {
            const numberA = MathPlus._arithmeticInput(a);
            const numberB = MathPlus._arithmeticInput(b);
            if (numberA instanceof BigNumber && numberB instanceof BigNumber) {
                return new ComplexNumber(MathPlus.realTimes(numberA, numberB));
            }

            const inputA = numberA instanceof ComplexNumber ? numberA : new ComplexNumber(numberA);
            const inputB = numberB instanceof ComplexNumber ? numberB : new ComplexNumber(numberB);

            const ac = MathPlus.realTimes(inputA.re, inputB.re);
            const bd = MathPlus.realTimes(inputA.im, inputB.im);
            const ad = MathPlus.realTimes(inputA.re, inputB.im);
            const bc = MathPlus.realTimes(inputA.im, inputB.re);

            // (a+bi)(c+di) = (ac-bd) + (ad+bc)i。
            return new ComplexNumber([MathPlus.realMinus(ac, bd), MathPlus.realPlus(ad, bc)]);
        }

        /**
         * 计算两个数的商 (a / b)。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} a - 被除数，可为实数或复数；
         *   结果精度由两个操作数的可用精度共同限制。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} b - 非零除数；复数分支通过共轭有理化，
         *   实数零和复数零都会在执行除法前被拒绝。
         * @returns {ComplexNumber} 代表两个数之商的 ComplexNumber 实例。
         * @throws {Error} 如果除数为零。
         */
        static divide(a, b) {
            const numberA = MathPlus._arithmeticInput(a);
            const numberB = MathPlus._arithmeticInput(b);
            if (numberA instanceof BigNumber && numberB instanceof BigNumber) {
                return new ComplexNumber(MathPlus.realDivide(numberA, numberB));
            }

            const inputA = numberA instanceof ComplexNumber ? numberA : new ComplexNumber(numberA);
            const inputB = numberB instanceof ComplexNumber ? numberB : new ComplexNumber(numberB);

            if (inputB.isZero()) {
                throw new Error('[MathPlus] mathematical error: Division by zero.');
            }
            const conjB = MathPlus.conj(inputB);
            // 复数除法乘以分母的共轭，使分母化为实数。
            const numerator = MathPlus.times(inputA, conjB);
            const denominator = MathPlus.times(inputB, conjB);
            return new ComplexNumber([
                MathPlus.realDivide(numerator.re, denominator.re),
                MathPlus.realDivide(numerator.im, denominator.re)
            ]);
        }

        /**
         * 按向下取整的商计算实数余数；非零余数沿用除数符号。
         * 被除数指数较大时用模幂约简；对齐除数时所需的位数由被除数尾数长度限定。
         *
         * @private
         * @param {BigNumber} a - 被除数。
         * @param {BigNumber} b - 非零除数。
         * @param {number} acc - 结果的有效位数。
         * @returns {BigNumber} 实数余数；除数的噪声按商的数量级传播，可靠除数的上边界附近可按容差归零。
         */
        static _realMod(a, b, acc) {
            if (a.isZero()) {
                return new BigNumber(0n, {acc});
            }

            const oppositeSigns = a.isNegative() !== b.isNegative();
            const absA = a.isNegative() ? -a.mantissa : a.mantissa;
            const absB = b.isNegative() ? -b.mantissa : b.mantissa;
            const lenA = BigNumber.decimalLengthBigInt(absA);
            const lenB = BigNumber.decimalLengthBigInt(absB);
            const powerA = BigInt(a.power);
            const powerB = BigInt(b.power);

            const magB = powerB + BigInt(lenB - 1);
            const magDiff = powerA + BigInt(lenA - 1) - magB;
            const effectiveDigits = Math.max(1, Math.floor(0.9 * acc), acc - 8);
            const margin = Math.min(4, Math.max(0, acc - effectiveDigits));
            const edgeMargin = Math.min(2, margin);
            const divisorIsReliable = b.noiseMag === -Infinity || b.noiseMag + margin < Number(magB);

            // 除数噪声乘以商后的量级与被除数噪声取较大值，零商无需传播除数噪声。
            const noiseForQuotient = (quotientMag) => Math.max(
                a.noiseMag,
                quotientMag === -Infinity || b.noiseMag === -Infinity ? -Infinity : quotientMag + b.noiseMag
            );
            const nearUpperEdge = (distance, quotientMag) => {
                const noise = noiseForQuotient(quotientMag);
                if (!Number.isFinite(noise) || !divisorIsReliable) {
                    return false;
                }
                const tolerancePower = BigInt(Math.floor(noise + edgeMargin)) + 1n;
                // 容差至少比除数低两个数量级，以免把正常余数吸附为零。
                if (tolerancePower > magB - 2n) {
                    return false;
                }

                return MathPlus._modSign([...distance, [-1n, tolerancePower]]) < 0n;
            };

            if (magDiff < 0n) {
                // 此时商只可能是 0 或 -1；直接保留尾量，避免按巨大的指数差对齐。
                if (oppositeSigns) {
                    if (nearUpperEdge([[absA, powerA]], 0)) {
                        return new BigNumber(0n, {acc});
                    }
                    return MathPlus._modWithTail(b.mantissa, b.power, a.mantissa, a.power, acc, noiseForQuotient(0));
                }
                if (nearUpperEdge([[absB, powerB], [-absA, powerA]], 0)) {
                    return new BigNumber(0n, {acc});
                }
                return new BigNumber(a, {acc});
            }

            const power = Math.min(a.power, b.power);
            const shiftA = powerA - BigInt(power);
            const shiftB = powerB - BigInt(power);
            // 数量级较小的被除数已提前处理；仅在 shiftB > 0 时对齐除数，位数最多为 lenA。
            const divisor = shiftB === 0n ? absB : absB * BigNumber.pow10(Number(shiftB));
            let remainder;
            let quotientMag = -Infinity;

            if (shiftA > 0n) {
                remainder = MathPlus._modScale(absA, shiftA, divisor);
                if (b.noiseMag !== -Infinity && remainder !== 0n) {
                    // 仅在传播除数噪声时精确确定商的数量级，无需构造完整商。
                    let mag = magDiff;
                    if (MathPlus._modSign([[absA, powerA], [-absB, powerB + mag]]) < 0n) {
                        mag--;
                    }
                    if (oppositeSigns && MathPlus._modSign([
                        [absA, powerA], [-absB, powerB + mag + 1n], [absB, powerB]
                    ]) > 0n) {
                        mag++;
                    }
                    quotientMag = mag < 0n ? -Infinity : Number(mag);
                }
            } else {
                remainder = absA % divisor;
                if (b.noiseMag !== -Infinity && remainder !== 0n) {
                    const quotient = absA / divisor + (oppositeSigns ? 1n : 0n);
                    quotientMag = quotient === 0n ? -Infinity : BigNumber.decimalLengthBigInt(quotient) - 1;
                }
            }

            if (remainder === 0n) {
                return new BigNumber(0n, {acc});
            }
            const magnitude = oppositeSigns ? divisor - remainder : remainder;
            if (nearUpperEdge([[divisor - magnitude, BigInt(power)]], Math.max(0, quotientMag))) {
                return new BigNumber(0n, {acc});
            }

            return new BigNumber(b.isNegative() ? -magnitude : magnitude, {
                pow: power,
                acc,
                noiseMag: noiseForQuotient(quotientMag)
            });
        }

        /**
         * 用模快速幂计算缩放后的余数，避免展开十进制幂。
         * @private
         * @param {bigint} mantissa - 待缩放的尾数。
         * @param {bigint} shift - 非负十进制指数。
         * @param {bigint} modulus - 正整数模数。
         * @returns {bigint} 缩放后的余数。
         */
        static _modScale(mantissa, shift, modulus) {
            let result = mantissa % modulus;
            let base = 10n % modulus;
            while (shift > 0n && result !== 0n) {
                if ((shift & 1n) !== 0n) {
                    result = (result * base) % modulus;
                }
                shift >>= 1n;
                base = (base * base) % modulus;
            }
            return result;
        }

        /**
         * 比较至多三个十进制项的和与零，只对齐数量级接近的项。
         * @private
         * @param {Array<[bigint, bigint]>} terms - 各项的尾数和十进制指数。
         * @returns {bigint} 和的符号，为 -1n、0n 或 1n。
         */
        static _modSign(terms) {
            let remaining = terms
                .filter(([mantissa]) => mantissa !== 0n)
                .map(([mantissa, power]) => [mantissa, power, power + BigInt(BigNumber.decimalLengthBigInt(mantissa) - 1)]);

            while (remaining.length > 1) {
                remaining.sort((a, b) => a[2] === b[2] ? 0 : a[2] > b[2] ? -1 : 1);
                const [a, b] = remaining;
                if (a[2] - b[2] >= 2n) {
                    return a[0] < 0n ? -1n : 1n;
                }
                const power = a[1] < b[1] ? a[1] : b[1];
                const sum = a[0] * BigNumber.pow10(Number(a[1] - power)) +
                    b[0] * BigNumber.pow10(Number(b[1] - power));
                remaining = remaining.slice(2);
                if (sum !== 0n) {
                    remaining.push([sum, power, power + BigInt(BigNumber.decimalLengthBigInt(sum) - 1)]);
                }
            }

            const mantissa = remaining[0]?.[0] ?? 0n;
            return mantissa < 0n ? -1n : mantissa > 0n ? 1n : 0n;
        }

        /**
         * 将整数残差与小数尾合并，在返回时统一舍入。
         * @private
         * @param {bigint} mantissa - 整数残差的尾数。
         * @param {number} power - 整数残差的十进制指数。
         * @param {bigint} tail - 小数尾的尾数。
         * @param {number} tailPower - 小数尾的十进制指数。
         * @param {number} acc - 结果精度。
         * @param {number} noiseMag - 已传播的噪声量级上界。
         * @returns {BigNumber} 合并后的实数余数。
         */
        static _modWithTail(mantissa, power, tail, tailPower, acc, noiseMag) {
            if (mantissa === 0n) {
                return new BigNumber(tail, {acc, pow: tailPower, noiseMag});
            }

            if (tail !== 0n) {
                const commonPower = Math.min(power, tailPower);
                const gap = BigInt(power) - BigInt(tailPower);
                const digits = BigNumber.decimalLengthBigInt(mantissa);
                const tailDigits = BigNumber.decimalLengthBigInt(tail);

                if (gap <= BigInt(acc + tailDigits + 1)) {
                    mantissa = mantissa * BigNumber.pow10(power - commonPower) +
                        tail * BigNumber.pow10(tailPower - commonPower);
                    power = commonPower;
                } else {
                    noiseMag = Math.max(noiseMag, tailPower + tailDigits - 1);
                    if (digits > acc) {
                        const unit = BigNumber.pow10(digits - acc);
                        const remainder = mantissa % unit;
                        // 极小尾项只会改变恰好落在舍入中点时的取舍方向。
                        if (remainder * 2n === unit || remainder * 2n === -unit) {
                            mantissa += tail < 0n ? -1n : 1n;
                        }
                    }
                }
            }

            return new BigNumber(mantissa, {acc, pow: power, noiseMag});
        }

        /**
         * 按 `a - b * floor(a / b)` 取模，复数的商按实部和虚部分别向下取整。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} a - 被除数。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} b - 非零除数。
         * @returns {ComplexNumber} a mod b。
         * @throws {Error} b 为零时抛出。
         * @throws {RangeError} 复数除数的分量指数差超过上限时抛出。
         */
        static mod(a, b) {
            const numberA = MathPlus._arithmeticInput(a);
            const numberB = MathPlus._arithmeticInput(b);
            if (numberB.isZero()) {
                throw new Error('[MathPlus] Modulo by zero error.');
            }

            const resultAcc = Math.min(numberA.acc, numberB.acc);
            if (numberA instanceof BigNumber && numberB instanceof BigNumber) {
                return new ComplexNumber(MathPlus._realMod(numberA, numberB, resultAcc));
            }
            if (numberA.isZero()) {
                return new ComplexNumber(0n, {acc: resultAcc});
            }

            const inputA = numberA instanceof ComplexNumber ? numberA : new ComplexNumber(numberA);
            const inputB = numberB instanceof ComplexNumber ? numberB : new ComplexNumber(numberB);

            if (inputB.onlyReal) {
                const resultRe = MathPlus._realMod(inputA.re, inputB.re, resultAcc);
                const resultIm = MathPlus._realMod(inputA.im, inputB.re, resultAcc);
                return new ComplexNumber([resultRe, resultIm]);
            }
            if (inputB.re.isZero()) {
                const negativeRe = MathPlus.oppositeNumber(inputA.re);
                const resultRe = MathPlus.oppositeNumber(MathPlus._realMod(negativeRe, inputB.im, resultAcc));
                const resultIm = MathPlus._realMod(inputA.im, inputB.im, resultAcc);
                return new ComplexNumber([resultRe, resultIm]);
            }

            const power = Math.min(inputB.re.power, inputB.im.power);
            const spread = BigInt(Math.max(inputB.re.power, inputB.im.power)) - BigInt(power);
            if (spread > 2n * BigInt(CalcConfig.MAX_INPUT_EXPONENT)) {
                throw new RangeError('[MathPlus] mathematical error: Modulo inputs are too extreme to compute safely.');
            }

            const br = inputB.re.mantissa * BigNumber.pow10(inputB.re.power - power);
            const bi = inputB.im.mantissa * BigNumber.pow10(inputB.im.power - power);
            const norm = br * br + bi * bi;
            // norm 是高斯整数除数的整倍数，约简两个整数分量不改变余数。
            const split = (part) => {
                if (part.isZero()) {
                    return [0n, 0n];
                }
                const shift = BigInt(part.power) - BigInt(power);
                if (shift >= 0n) {
                    return [MathPlus._modScale(part.mantissa, shift, norm), 0n];
                }
                if (-shift >= BigInt(BigNumber.decimalLengthBigInt(part.mantissa))) {
                    return [0n, part.mantissa];
                }
                const scale = BigNumber.pow10(Number(-shift));
                return [(part.mantissa / scale) % norm, part.mantissa % scale];
            };
            const [ar, tailRe] = split(inputA.re);
            const [ai, tailIm] = split(inputA.im);

            // 在模数约简后的整数部分上计算商，并计入两分量的小数尾。
            const floorQuotient = (intNumerator, factorRe, factorIm) => {
                const fraction = (intNumerator % norm + norm) % norm;
                const quotient = (intNumerator - fraction) / norm;
                // 两个小数尾的加权和的绝对值小于 |br| + |bi|，而该和不超过 norm。
                // 精确比较余量与两个取整边界，修正整数部分求得的商。
                const tails = [
                    [tailRe * factorRe, BigInt(inputA.re.power)],
                    [tailIm * factorIm, BigInt(inputA.im.power)]
                ];
                if (MathPlus._modSign([[fraction, BigInt(power)], ...tails]) < 0n) {
                    return quotient - 1n;
                }
                if (MathPlus._modSign([[fraction - norm, BigInt(power)], ...tails]) >= 0n) {
                    return quotient + 1n;
                }
                return quotient;
            };
            const qr = floorQuotient(ar * br + ai * bi, br, bi);
            const qi = floorQuotient(ai * br - ar * bi, -bi, br);
            const magA = Math.max(BigNumber.getMag(inputA.re), BigNumber.getMag(inputA.im));
            const magB = Math.max(BigNumber.getMag(inputB.re), BigNumber.getMag(inputB.im));

            // 若被除数已经过约简，约简后的零商仍可能对应原商非零。
            const hasQuotient = magA >= magB || qr !== 0n || qi !== 0n;
            const divisorNoise = Math.max(inputB.re.noiseMag, inputB.im.noiseMag);
            const scaledNoise = !hasQuotient || divisorNoise === -Infinity
                                ? -Infinity
                                : divisorNoise + Math.max(0, magA - magB + 2);
            const resultRe = MathPlus._modWithTail(
                ar - qr * br + qi * bi, power, tailRe, inputA.re.power,
                resultAcc, Math.max(inputA.re.noiseMag, scaledNoise)
            );
            const resultIm = MathPlus._modWithTail(
                ai - qr * bi - qi * br, power, tailIm, inputA.im.power,
                resultAcc, Math.max(inputA.im.noiseMag, scaledNoise)
            );

            return new ComplexNumber([resultRe, resultIm]);
        }

        /**
         * 计算 a 的 b 次方 (a^b)。
         * - 该函数能够处理实数和复数作为底数和指数。
         * - 核心原理：a^b = exp(b * ln(a))。
         * - 对于复数 z = r(cosθ + isinθ), z^b = r^b * (cos(bθ) + isin(bθ))。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} a - 实数或复数底数；负实数配非整数
         *   实指数时，若能识别出约分后分母为奇数的有理数 p/q，则返回实数幂，符号由 p 的奇偶性决定。
         *   其余非整数指数按复对数主值求幂，零底数仅允许正实指数。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} b - 实数或复数指数；整数指数优先走
         *   整数幂路径。有限小数按精确分数处理，也可在舍入误差或原生 number 精度范围内识别简单分数。
         * @returns {ComplexNumber} 代表 a^b 结果的 ComplexNumber 实例。
         * @throws {Error} 如果出现数学上未定义的情况 (例如 0^0)。
         * @throws {Error} 如果结果的位数估算值过大，可能导致内存溢出。
         * @throws {Error} 如果底数为零且指数为负。
         */
        static pow(a, b) {
            /**
             * (内部辅助函数) 估算 BigInt 的以 10 为底的对数值。
             * @private
             * @param {bigint} bi - 正 BigInt。
             * @returns {number} log10(bi) 的浮点近似值。
             */
            function _estimateLog10BigInt(bi) {
                if (bi <= 0n) {
                    return -Infinity;
                }
                const hex = bi.toString(16);
                const len = hex.length;
                const headLen = Math.min(len, 13);
                const head = parseInt(hex.slice(0, headLen), 16);
                return Math.log10(head) + (len - headLen) * Math.log10(16);
            }

            /**
             * (内部辅助函数) 估算底数 a 的对数尺度信息。
             * 当 ||a| - 1| <= 10^-5 时改用 |log10(1 ± δ)| ≈ δ / ln 10，避免双精度精度丢失和下溢。
             * @private
             * @param {BigNumber} reA - 实数底数（保证非零且模不为 1）。
             * @returns {{isGreaterThanOne: boolean, log10Log10A: number}}
             */
            function _estimateBaseLog10Info(reA) {
                const absMantissa = reA.mantissa < 0n ? -reA.mantissa : reA.mantissa;
                const absA = new BigNumber([reA.power, absMantissa, reA.acc]);
                const magA = BigNumber.getMag(absA);
                // 调用前已排除 |a| === 1 及 |a| === 10^p，因此 magA >= 0 恒等价于 |a| > 1，magA < 0 恒等价于 |a| < 1
                const isGreaterThanOne = magA >= 0;

                if (magA === 0 || magA === -1) {
                    const one = new BigNumber([0, 1n, absA.acc]);
                    const delta = MathPlus.minus(absA, one).re;

                    // 切换阈值设为 getMag(delta) <= -6（即 |delta| <= 10^-5），进一步压低泰勒截断误差
                    if (!delta.isZero() && BigNumber.getMag(delta) <= -6) {
                        const absDeltaMantissa = delta.mantissa < 0n ? -delta.mantissa : delta.mantissa;
                        const log10Delta = _estimateLog10BigInt(absDeltaMantissa) + delta.power;
                        const log10Log10A = log10Delta - Math.log10(Math.LN10);
                        return {isGreaterThanOne, log10Log10A};
                    }
                }

                const log10AbsA = _estimateLog10BigInt(absMantissa) + reA.power;
                const log10Log10A = Math.log10(Math.abs(log10AbsA));
                return {isGreaterThanOne, log10Log10A};
            }

            /**
             * (内部辅助函数) 估算 a^b 结果的十进制位数，其中 a 和 b 都是 BigInt。
             * 用于在执行原生 BigInt 乘方运算前进行位数检查。
             *
             * @private
             * @param {bigint} a - 底数，一个 BigInt。
             * @param {bigint} b - 指数，一个正的 BigInt。
             * @returns {number} a^b 结果位数的估算值。
             */
            function _estimateDigitCount(a, b) {
                if (a < 0n) {
                    a = -a;
                }
                if (a === 0n || a === 1n || b === 0n) {
                    return 1;
                }

                const log10a = _estimateLog10BigInt(a);
                const bAsNumber = Number(b);
                const log10Result = bAsNumber * log10a;

                return Math.floor(log10Result) + 1;
            }

            /**
             * 快速幂运算
             * 使用 MathPlus 的乘法逻辑来计算 base^exponent (base 为完整数值实例，如 BigNumber/ComplexNumber)
             * 目的：在计算超大结果或多步运算时，每步乘法自动规范化，只保留需要的保护有效位数以避免内存溢出与指数爆炸。
             * @param {BigNumber|ComplexNumber|bigint} base - 底数
             * @param {bigint} exponent - 非负整数指数
             * @param {number} workAcc - 包含保护位的内部工作精度
             * @returns {ComplexNumber} 结果 (ComplexNumber 实例)
             */
            function fastPow(base, exponent, workAcc) {
                if (exponent === 0n) {
                    return new ComplexNumber([0, 1n, workAcc]);
                }

                let b = MathPlus._complexInput(base, workAcc);
                const innerAcc = b.acc;
                let result = new ComplexNumber([0, 1n, innerAcc]);

                // 二进制平方-乘：指数每次减半，只在当前二进制位为 1 时乘入结果。
                while (exponent > 0n) {
                    if ((exponent & 1n) === 1n) {
                        result = MathPlus.times(result, b);
                    }

                    if (exponent > 1n) {
                        b = MathPlus.times(b, b);
                    }

                    exponent >>= 1n;
                }

                return result;
            }

            /**
             * 识别正小数指数的奇分母约分形式；精确小数直接约分，有噪声时检查连分数收敛分数。
             * @param {BigNumber} exponent - 正的非整数指数
             * @param {number} noiseMag - 允许的舍入误差量级
             * @returns {{numerator: bigint, denominator?: bigint}|undefined} 奇分母分数；精确小数无需重算分母
             */
            function oddDenominatorFraction(exponent, noiseMag) {
                const scale = -exponent.power;
                const shift = BigInt(scale);
                const numerator = exponent.mantissa >> shift;
                if (numerator !== 0n && (numerator << shift) === exponent.mantissa) {
                    // 10^scale = 2^scale × 5^scale；移除全部因子 2 后，剩余的约分不影响分子的奇偶性。
                    return {numerator};
                }
                if (noiseMag === -Infinity) {
                    return;
                }

                // 只考虑分母长度远小于可靠小数位数的分数，避免把无理数的高阶近似当成实根。
                const denominatorDigits = Math.min(exponent.acc, Math.ceil((-noiseMag - 1) / 3));
                const noiseShift = noiseMag - exponent.power;
                if (denominatorDigits < 1 || BigNumber.getMag(exponent) < -denominatorDigits - 1 ||
                    noiseShift < -denominatorDigits - 1) {
                    return;
                }
                const limit = BigNumber.pow10(denominatorDigits);
                const decimalDenominator = BigNumber.pow10(scale);
                const tolerance = 5n * BigNumber.pow10(Math.max(0, noiseShift));
                const errorScale = BigNumber.pow10(Math.max(0, -noiseShift));
                let a = exponent.mantissa, b = decimalDenominator;
                let p0 = 0n, p1 = 1n, q0 = 1n, q1 = 0n;
                while (b !== 0n) {
                    const integerPart = a / b;
                    const p = integerPart * p1 + p0;
                    const q = integerPart * q1 + q0;
                    if (q > limit || q ** 3n * tolerance >= decimalDenominator * errorScale) {
                        return;
                    }
                    const error = exponent.mantissa * q - decimalDenominator * p;
                    if ((error < 0n ? -error : error) * errorScale <= tolerance * q) {
                        // 接受第一个匹配的分数；偶分母和整数仍走通常的小数幂路径。
                        return q > 1n && (q & 1n) === 1n ? {numerator: p, denominator: q} : undefined;
                    }
                    [a, b] = [b, a - integerPart * b];
                    [p0, p1, q0, q1] = [p1, p, q1, q];
                }
            }

            const inputA = MathPlus._complexInput(a);
            const inputB = MathPlus._complexInput(b);
            const resultAcc = Math.min(inputA.acc, inputB.acc);

            if (!inputB.onlyReal && inputA.onlyReal) {
                const instanceE = BigNumber.approximateConstant(CalcConfig.constants.e, inputA.re.acc);
                if (
                    inputA.re.power === instanceE.power &&
                    inputA.re.mantissa === instanceE.mantissa &&
                    inputA.re.noiseMag <= instanceE.noiseMag
                ) {
                    // e 的复数幂由 exp 专用实现计算，避免经通用 ln/pow 路径损失精度。
                    return MathPlus.exp(inputB);
                }
            }

            // --- 分支 1: 底数、指数都是纯实数 ---
            if (inputA.onlyReal && inputB.onlyReal) {
                const reA = inputA.re;
                const reB = inputB.re;

                if (reB.isZero()) {
                    if (reA.isZero()) {
                        throw new Error('[MathPlus] mathematical error: 0^0 is undefined.');
                    }
                    return new ComplexNumber([0, 1n, resultAcc]);
                }

                if (reA.isZero()) {
                    if (reB.isNegative()) {
                        throw new Error('[MathPlus] mathematical error: 0 to a negative power is undefined.');
                    }
                    return new ComplexNumber([0, 0n, resultAcc]);
                }

                // 快路径计算名义值，再用 a^b 对底数和指数的变化率传播噪声。
                const withInputNoise = (result) => {
                    if (result.isZero() || (reA.noiseMag === -Infinity && reB.noiseMag === -Infinity)) {
                        return result;
                    }

                    const part = result.onlyReal ? result.re : result.im;
                    const resultMag = BigNumber.getMag(part);

                    let baseNoise = -Infinity;
                    if (reA.noiseMag !== -Infinity) {
                        const absMantissaA = reA.isNegative() ? -reA.mantissa : reA.mantissa;
                        const absMantissaB = reB.isNegative() ? -reB.mantissa : reB.mantissa;
                        const logRatio = (reB.power - reA.power) +
                            (_estimateLog10BigInt(absMantissaB) - _estimateLog10BigInt(absMantissaA));
                        baseNoise = reA.noiseMag + resultMag + Math.ceil(logRatio);
                    }

                    let exponentNoise = -Infinity;
                    if (reB.noiseMag !== -Infinity) {
                        const unitBase = reA.power === 0 && (reA.mantissa === 1n || reA.mantissa === -1n);
                        const logDerivative = unitBase ? -Infinity
                                                       : _estimateBaseLog10Info(reA).log10Log10A + Math.log10(Math.LN10);
                        exponentNoise = reB.noiseMag + resultMag + Math.ceil(logDerivative);
                        if (reA.isNegative()) {
                            // 快路径的结果在坐标轴上，相位变化仅以二阶影响该分量。
                            // |1 - cos(πδ)| ≤ π²δ²/2 < 10δ²。
                            const phaseNoise = resultMag + 2 * reB.noiseMag + 1;
                            exponentNoise = Math.max(exponentNoise, phaseNoise);
                        }
                    }

                    const noiseMag = Math.max(part.noiseMag, baseNoise, exponentNoise);
                    if (noiseMag === part.noiseMag) {
                        return result;
                    }

                    return new ComplexNumber(result, {
                        noiseMag: result.onlyReal ? [noiseMag, undefined] : [undefined, noiseMag]
                    });
                };

                // 特判底数为 1：1^b 恒为 1，近似底数仍有噪声。
                if (reA.mantissa === 1n && reA.power === 0) {
                    return withInputNoise(new ComplexNumber([0, 1n, resultAcc]));
                }

                // --- 路径 1.1: 指数 b 是整数 ---
                if (reB.power >= 0) {
                    const LOG10_MAX_SAFE_INTEGER = Math.log10(Number.MAX_SAFE_INTEGER);

                    // 1. 前置 O(1) 特殊底数判断：特判 (-1)^n，凭指数奇偶性 O(1) 判定，杜绝大指数展开与卡死。
                    if (reA.mantissa === -1n && reA.power === 0) {
                        const isEven = reB.power > 0 || (reB.mantissa & 1n) === 0n;
                        return withInputNoise(new ComplexNumber([0, isEven ? 1n : -1n, resultAcc]));
                    }

                    const isExponentNegative = reB.isNegative();
                    const absB = isExponentNegative ? MathPlus.oppositeNumber(reB) : reB;
                    const isBEven = absB.power > 0 || (absB.mantissa & 1n) === 0n;
                    const log10B = _estimateLog10BigInt(absB.mantissa) + absB.power;

                    // 2. 特判 ±10^p (absMantissa === 1n)：走 O(1) 指数乘法，完全规避幂运算迭代。
                    const absMantissaA = reA.mantissa < 0n ? -reA.mantissa : reA.mantissa;
                    if (absMantissaA === 1n) {
                        const sign = reA.mantissa < 0n ? (isBEven ? 1n : -1n) : 1n;
                        const p = reA.power;
                        const log10FinalPower = Math.log10(Math.abs(p)) + log10B;
                        const isFinalPowerPositive = (p > 0) !== isExponentNegative;

                        if (log10B > LOG10_MAX_SAFE_INTEGER || log10FinalPower > LOG10_MAX_SAFE_INTEGER) {
                            if (isFinalPowerPositive) {
                                throw new Error('[MathPlus] mathematical error: Result of power is too large to compute safely.');
                            } else {
                                return new ComplexNumber([0, 0n, resultAcc]);
                            }
                        }

                        const realB = absB.power === 0 ? absB.mantissa : absB.mantissa * BigNumber.pow10(absB.power);
                        const signedB = isExponentNegative ? -realB : realB;
                        const finalPowerBigInt = BigInt(p) * signedB;

                        if (finalPowerBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
                            throw new Error('[MathPlus] mathematical error: Result of power is too large to compute safely.');
                        }
                        if (finalPowerBigInt < BigInt(Number.MIN_SAFE_INTEGER)) {
                            return new ComplexNumber([0, 0n, resultAcc]);
                        }

                        return withInputNoise(new ComplexNumber([0, sign, resultAcc], {pow: Number(finalPowerBigInt)}));
                    }

                    // 3. 用对数尺度整体预估最终数量级：log10(|b| * |log10|a||) = log10|b| + log10|log10|a||
                    // 在不展开 BigNumber.pow10(absB.power) 的前提下完成溢出/下溢判断。
                    const baseInfo = _estimateBaseLog10Info(reA);
                    const log10FinalMag = log10B + baseInfo.log10Log10A;
                    const willOverflow = baseInfo.isGreaterThanOne !== isExponentNegative;

                    if (log10FinalMag > LOG10_MAX_SAFE_INTEGER) {
                        if (willOverflow) {
                            throw new Error('[MathPlus] mathematical error: Result of power is too large to compute safely.');
                        } else {
                            return new ComplexNumber([0, 0n, resultAcc]);
                        }
                    }

                    // 4. 按指数规模动态分配保护位：Math.ceil(log10B) + 10
                    const guardDigits = Math.max(10, Math.ceil(log10B) + 10);
                    const workAcc = resultAcc + guardDigits;

                    try {
                        const realB = absB.power === 0 ? absB.mantissa : absB.mantissa * BigNumber.pow10(absB.power);

                        // 5. 将完整 reA 交给 fastPow：仅当原生 BigInt 幂位数小于阈值且指数安全时走原生幂
                        let canUseNativeBigInt = false;
                        let resultPowerBigInt = 0n;
                        if (absB.power <= 16 && realB <= BigInt(Number.MAX_SAFE_INTEGER)) {
                            resultPowerBigInt = BigInt(reA.power) * realB;
                            if (
                                resultPowerBigInt >= BigInt(Number.MIN_SAFE_INTEGER) &&
                                resultPowerBigInt <= BigInt(Number.MAX_SAFE_INTEGER)
                            ) {
                                const orderOfMagnitude = _estimateDigitCount(reA.mantissa, realB);
                                if (orderOfMagnitude < CalcConfig.CRITICAL_MAGNITUDE_FAST_EXP) {
                                    canUseNativeBigInt = true;
                                }
                            }
                        }

                        let result;
                        if (canUseNativeBigInt) {
                            const resultMantissa = reA.mantissa ** realB;
                            result = new ComplexNumber(resultMantissa, {
                                pow: Number(resultPowerBigInt),
                                acc: workAcc
                            });
                        } else {
                            result = fastPow(reA, realB, workAcc);
                        }

                        // 6. 负指数在高精度中间态取倒数后再统一舍入到 resultAcc，避免双次舍入误差
                        if (isExponentNegative) {
                            result = MathPlus.divide([0, 1n, workAcc], result);
                        }
                        return withInputNoise(MathPlus._complexInput(result, resultAcc));
                    } catch (err) {
                        if (
                            err &&
                            err.message &&
                            (err.message.includes('Power too large or too small') ||
                                err.message.includes('too large to compute safely'))
                        ) {
                            if (willOverflow) {
                                throw new Error('[MathPlus] mathematical error: Result of power is too large to compute safely.');
                            } else {
                                return new ComplexNumber([0, 0n, resultAcc]);
                            }
                        }
                        throw err;
                    }
                }

                // --- 路径 1.2: 底数 a > 0, 指数 b 是小数 ---
                if (reA.isPositive()) {
                    // 正底数小数幂采用 a^b = exp(b·ln(a))，平方根走专用牛顿迭代。
                    if (reB.power === -1 && reB.mantissa === 5n) {
                        return withInputNoise(MathPlus.sqrt(reA));
                    }
                    return MathPlus.exp(
                        MathPlus.times(MathPlus.ln(reA), reB)
                    );
                }

                // --- 路径 1.3: 底数 a < 0, 指数 b 是小数 ---
                let isExponentNegative = false;
                let absB = reB;
                if (reB.isNegative()) {
                    isExponentNegative = true;
                    absB = MathPlus.oppositeNumber(reB);
                }

                // 原生 number 无法保留 2/3 等分数的精确值，按双精度的有效位数检查。
                const noiseMag = typeof b === 'number' ? Math.max(absB.noiseMag, BigNumber.getMag(absB) - 15) :
                                 absB.noiseMag;
                const fraction = oddDenominatorFraction(absB, noiseMag);
                if (fraction) {
                    const workAcc = resultAcc + 10;
                    const numerator = isExponentNegative ? -fraction.numerator : fraction.numerator;
                    const workExponent = fraction.denominator === undefined ? new BigNumber(reB, {acc: workAcc}) : MathPlus.realDivide(
                        new BigNumber(numerator, {acc: workAcc}),
                        new BigNumber(fraction.denominator, {acc: workAcc})
                    );
                    const absBase = MathPlus._complexInput(MathPlus.oppositeNumber(reA), workAcc);
                    const magnitude = MathPlus.pow(absBase, workExponent);
                    const result = (numerator & 1n) === 1n ? MathPlus.oppositeNumber(magnitude) : magnitude;
                    return withInputNoise(MathPlus._complexInput(result, resultAcc));
                }

                let result = MathPlus.pow(MathPlus.oppositeNumber(inputA), absB);
                // 无实根时取复数主值。
                if (absB.power === -1 && absB.mantissa === 5n) {
                    // 负实数的 0.5 次幂走纯虚数分支，保持与主值方根解析连续并规避通用复数幂误差。
                    const zero = new BigNumber([0, 0n, resultAcc]);
                    result = withInputNoise(new ComplexNumber([zero, result.re]));
                } else {
                    const angle = MathPlus.times(absB, BigNumber.approximateConstant(CalcConfig.constants.pi));
                    result = new ComplexNumber([
                        MathPlus.times(result, MathPlus.cos(angle)).re,
                        MathPlus.times(result, MathPlus.sin(angle)).re
                    ]);
                }

                if (isExponentNegative) {
                    result = MathPlus.divide([0, 1n, resultAcc], result);
                }
                return result;
            }

            // --- 分支 2: 底数是复数, 指数是纯实数 ---
            if (inputB.onlyReal) {
                const reB = inputB.re;
                if (reB.power >= 0) {
                    if (reB.isZero()) {
                        return new ComplexNumber([0, 1n, resultAcc]);
                    }
                    const isNegative = reB.isNegative();
                    const im = inputA.im;
                    if (inputA.re.isZero() && im.power === 0 &&
                        (im.mantissa === 1n || im.mantissa === -1n) &&
                        im.noiseMag === -Infinity && reB.noiseMag === -Infinity) {
                        // ±i 的整数幂以 4 为周期，无需展开超大指数。
                        const residue = reB.power >= 2 ? 0n :
                                        (reB.mantissa * (reB.power === 0 ? 1n : 10n)) & 3n;
                        return fastPow(inputA, residue, resultAcc);
                    }

                    const log10B = _estimateLog10BigInt(isNegative ? -reB.mantissa : reB.mantissa) + reB.power;
                    const mag = Math.max(BigNumber.getMag(inputA.re), BigNumber.getMag(im));
                    // 缩放后估算 log10|a|，避免对原底数直接平方溢出。
                    const scaledLog = (part) => part.isZero() ? -Infinity :
                                                _estimateLog10BigInt(part.isNegative() ? -part.mantissa : part.mantissa) + (part.power - mag);
                    const scaledRe = 10 ** scaledLog(inputA.re);
                    const scaledIm = 10 ** scaledLog(im);
                    const log10Norm = mag + Math.log10(Math.hypot(scaledRe, scaledIm));
                    let normGrows = log10Norm > 0;
                    let log10AbsLog = Math.log10(Math.abs(log10Norm));
                    if (log10B > 16 && Math.abs(log10Norm) <= 1e-5) {
                        // 模长接近 1 时，将较大的分量平方减 1 写成平方差，避免丢失小量。
                        const precision = 2 * inputA.acc + 4;
                        const [major, minor] = scaledRe >= scaledIm ? [inputA.re, im] : [im, inputA.re];
                        const absMajor = new BigNumber(major.isNegative() ? -major.mantissa : major.mantissa,
                            {pow: major.power, acc: precision});
                        const one = new BigNumber(1n, {acc: precision});
                        const scaledMinor = Math.abs(minor.power) <= Number.MAX_SAFE_INTEGER / 2
                                            ? new BigNumber(minor, {acc: precision})
                                            : new BigNumber(0n, {acc: precision});
                        const delta = MathPlus.realPlus(
                            MathPlus.realTimes(MathPlus.realMinus(absMajor, one), MathPlus.realPlus(absMajor, one)),
                            MathPlus.realTimes(scaledMinor, scaledMinor)
                        );
                        normGrows = delta.isPositive();
                        const log10Delta = delta.isZero() ? -Infinity :
                                           _estimateLog10BigInt(delta.isNegative() ? -delta.mantissa : delta.mantissa) +
                                               delta.power;
                        log10AbsLog = log10Delta < -10 ? log10Delta - Math.log10(2 * Math.LN10) :
                                      Math.log10(Math.abs(Math.log1p((normGrows ? 1 : -1) * 10 ** log10Delta)) / (2 * Math.LN10));
                    }

                    const sizeError = '[MathPlus] mathematical error: Result of power is too large to compute safely.';
                    const willOverflow = normGrows !== isNegative;
                    if (log10B + log10AbsLog > Math.log10(Number.MAX_SAFE_INTEGER)) {
                        if (willOverflow) {
                            throw new Error(sizeError);
                        }
                        return new ComplexNumber(0n, {acc: resultAcc});
                    }
                    // 限制平方乘的迭代次数，并让常规精度下的保护位留在十次幂缓存范围内。
                    if (BigNumber.getMag(reB) >= 250) {
                        throw new Error(sizeError);
                    }

                    const workAcc = resultAcc + Math.max(10, Math.ceil(log10B) + 10);
                    const absMantissa = isNegative ? -reB.mantissa : reB.mantissa;
                    const exponent = absMantissa * BigNumber.pow10(reB.power);
                    let base = inputA;
                    try {
                        if (isNegative) {
                            // 先对缩放后的底数取倒数，使中间量级与最终结果同向变化。
                            // 跳过缩放后连平方指数都无法表示的分量，避免次要分量导致整个倒数归零。
                            const minScaledPower = -Math.floor(Number.MAX_SAFE_INTEGER / 2) + workAcc;
                            const scale = (part, minPower) => new BigNumber(
                                part.power - mag < minPower ? 0n : part,
                                {acc: workAcc, pow: -mag}
                            );
                            const scaledBase = new ComplexNumber([
                                scale(inputA.re, minScaledPower), scale(im, minScaledPower)
                            ]);
                            const inverse = MathPlus.divide([0, 1n, workAcc], scaledBase);
                            // 还原量级时也分别处理分量下溢，保留仍可表示的分量。
                            base = new ComplexNumber([
                                scale(inverse.re, -Number.MAX_SAFE_INTEGER), scale(inverse.im, -Number.MAX_SAFE_INTEGER)
                            ]);
                        }
                        const result = fastPow(base, exponent, workAcc);
                        if (reB.noiseMag === -Infinity) {
                            return MathPlus._complexInput(result, resultAcc);
                        }
                        // 指数噪声按 a^b·Log(a) 的模长上界传播。
                        const noise = reB.noiseMag +
                            Math.max(BigNumber.getMag(result.re), BigNumber.getMag(result.im)) +
                            1 + Math.ceil(Math.log10(Math.max(Math.PI, Math.abs(log10Norm) * Math.LN10)));
                        return new ComplexNumber(result, {
                            acc: resultAcc,
                            noiseMag: [Math.max(noise, result.re.noiseMag), Math.max(noise, result.im.noiseMag)]
                        });
                    } catch (err) {
                        if (!err?.message?.includes('Power too large or too small')) {
                            throw err;
                        }
                        if (willOverflow) {
                            throw new Error(sizeError);
                        }
                        return new ComplexNumber(0n, {acc: resultAcc});
                    }
                }

                // 复底数、实指数：z^b = |z|^b(cos(b·arg z)+i·sin(b·arg z))。
                const module = MathPlus.pow(MathPlus.abs(inputA), inputB);
                const angle = MathPlus.times(inputB, MathPlus.arg(inputA));
                const cosAngle = MathPlus.cos(angle);
                const sinAngle = MathPlus.sin(angle);

                return new ComplexNumber([
                    MathPlus.times(module, cosAngle).re,
                    MathPlus.times(module, sinAngle).re
                ]);
            }

            // --- 分支 3: 通用情况 (通常是复数指数) ---
            // 通用复数幂由 exp(b·Log(a)) 展开；模为 r^c·e^(-dθ)，辐角为 d·ln(r)+cθ。
            const c = inputB.re;
            const d = inputB.im;
            const r = MathPlus.abs(inputA);
            const angle = MathPlus.arg(inputA);
            const resultAngle = MathPlus.plus(
                MathPlus.times(d, MathPlus.ln(r)),
                MathPlus.times(c, angle)
            );
            const module = MathPlus.times(
                MathPlus.pow(r, c),
                MathPlus.exp(
                    MathPlus.oppositeNumber(MathPlus.times(d, angle))
                )
            );
            const cosAngle = MathPlus.cos(resultAngle);
            const sinAngle = MathPlus.sin(resultAngle);

            return new ComplexNumber([
                MathPlus.times(module, cosAngle).re,
                MathPlus.times(module, sinAngle).re
            ]);
        }

        /**
         * 计算 a 乘以 10 的 b 次方 (a * 10^b)。这常用于处理科学记数法。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} a - 被缩放的实数或复数系数。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} b - 以 10 为底的缩放指数；必须能
         *   修正为纯实整数，否则无法作为内部十进制 `power` 使用。
         * @returns {ComplexNumber} 代表 a * 10^b 结果的 ComplexNumber 实例。
         * @example
         * // 1.23 * 10³ -> 1230
         * MathPlus.exponential(1.23, 3);
         */
        static exponential(a, b) {
            const inputA = MathPlus._arithmeticInput(a);
            const inputB = MathPlus._arithmeticInput(b);
            const acc = Math.min(inputA.acc, inputB.acc);
            return MathPlus.times(
                inputA,
                MathPlus.pow([1, 1n, acc], inputB)
            );
        }

        /**
         * 计算 x 的平方根 (√x)，并返回主值。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 被开方数；非负实数走牛顿迭代，
         *   负实数及一般复数按主辐角返回主平方根，输入零精确返回零。
         * @returns {ComplexNumber} 代表 √x 结果的 ComplexNumber 实例。
         */
        static sqrt(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;

            if (input.onlyReal) {
                const re = input.re;
                let useAlternative = false;
                let result;

                if (re.isZero()) {
                    return new ComplexNumber([0, 0n, acc]);
                }

                let isBaseNegative = false;
                let absInput = re;
                if (re.isNegative()) {
                    isBaseNegative = true;
                    absInput = MathPlus.oppositeNumber(re);
                }

                // 十进制指数归约：|x| = scaled * 10^(2k)，使 scaled ∈ [1, 100)
                const mantissaLen = BigNumber.decimalLengthBigInt(absInput.mantissa);
                const sciExpBig = BigInt(absInput.power) + BigInt(mantissaLen - 1);
                const r = Number(sciExpBig & 1n); // r ∈ {0, 1}
                const k = Number((sciExpBig - BigInt(r)) >> 1n);
                const scaledPower = r - mantissaLen + 1;

                const workAcc = acc + 6;
                const scaledNoiseMag = absInput.noiseMag === -Infinity ? -Infinity : absInput.noiseMag - 2 * k;
                const scaledBig = new BigNumber([scaledPower, absInput.mantissa], {
                    acc: workAcc,
                    noiseMag: scaledNoiseMag
                });
                // 原生 Math.sqrt 在 [1, 100) 范围内永远安全且不溢出，提供约 15 位精度的初值
                const lowAccuracyScaled = new BigNumber(scaledBig, {acc: 15});
                const numberRe = Number(lowAccuracyScaled.mantissa) * (10 ** lowAccuracyScaled.power);

                if (!Number.isFinite(numberRe) || numberRe <= 0) {
                    useAlternative = true;
                }

                if (!useAlternative) {
                    result = new BigNumber(Math.sqrt(numberRe), {acc: workAcc});

                    let i = 0;
                    const max = Math.max(20, Math.ceil(Math.log2(workAcc)) + 10);
                    const const_2 = new BigNumber(2n, {acc: workAcc});
                    let difference, mid;
                    let diffMag = Infinity;

                    // 进行牛顿迭代：x_(n+1) = (x_n + scaled/x_n) / 2
                    do {
                        const prevDiffMag = diffMag;
                        mid = result;
                        result = MathPlus.realDivide(
                            MathPlus.realPlus(mid, MathPlus.realDivide(scaledBig, mid)),
                            const_2
                        );

                        difference = MathPlus.realMinus(mid, result);
                        diffMag = BigNumber.getMag(difference);
                        i++;

                        if (diffMag <= -(acc + 2) || (diffMag <= -acc && diffMag >= prevDiffMag)) {
                            break;
                        }
                    } while (i < max);

                    if (i >= max && diffMag > -acc) {
                        console.warn(`[MathPlus] Square root (${input.toString()}) calculation takes too long.`);
                        useAlternative = true;
                    }
                }

                // 如果牛顿法收敛异常，则使用 ln/exp 方法作为备用
                // 公式: √x = x^0.5 = e^(0.5 * ln(x))
                if (useAlternative) {
                    result = MathPlus.exp(
                        MathPlus.times(MathPlus.ln(absInput), [-1, 5n, acc])
                    ).re;
                }

                const finalReal = useAlternative
                                  ? result
                                  : new BigNumber(result, {acc: acc, pow: k});

                if (isBaseNegative) {
                    return new ComplexNumber([[0, 0n, acc], finalReal]);
                }
                return new ComplexNumber(finalReal, {acc: acc});
            }

            return MathPlus.pow(input, [-1, 5n, acc]);
        }

        /**
         * 计算主立方根；实数使用牛顿迭代，复数使用幂运算。
         *
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 被开方数；纯实数返回保持实数符号的
         *   实立方根，一般复数返回主立方根，二者在负实数上的分支约定不同。
         * @returns {ComplexNumber} 主立方根。
         */
        static cbrt(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;

            if (input.onlyReal) {
                const re = input.re;
                let useAlternative = false;
                let result;

                if (re.isZero()) {
                    return new ComplexNumber([0, 0n, acc]);
                }

                let isBaseNegative = false;
                let absInput = re;
                if (re.isNegative()) {
                    isBaseNegative = true;
                    absInput = MathPlus.oppositeNumber(re);
                }

                // 十进制指数归约：|x| = scaled * 10^(3k)，使 scaled ∈ [1, 1000)
                const mantissaLen = BigNumber.decimalLengthBigInt(absInput.mantissa);
                const sciExpBig = BigInt(absInput.power) + BigInt(mantissaLen - 1);
                const r = Number(((sciExpBig % 3n) + 3n) % 3n); // r ∈ {0, 1, 2}
                const k = Number((sciExpBig - BigInt(r)) / 3n);
                const scaledPower = r - mantissaLen + 1;

                const workAcc = acc + 6;
                const scaledNoiseMag = absInput.noiseMag === -Infinity ? -Infinity : absInput.noiseMag - 3 * k;
                const scaledBig = new BigNumber([scaledPower, absInput.mantissa], {
                    acc: workAcc,
                    noiseMag: scaledNoiseMag
                });
                // 原生 Math.cbrt 在 [1, 1000) 范围内永远安全且不溢出，提供约 15 位精度的初值
                const lowAccuracyScaled = new BigNumber(scaledBig, {acc: 15});
                const numberRe = Number(lowAccuracyScaled.mantissa) * (10 ** lowAccuracyScaled.power);

                if (!Number.isFinite(numberRe) || numberRe <= 0) {
                    useAlternative = true;
                }

                if (!useAlternative) {
                    result = new BigNumber(Math.cbrt(numberRe), {acc: workAcc});

                    // 立方根的牛顿迭代：x_(n+1) = (2 * x_n + scaled / x_n²) / 3
                    let i = 0;
                    const max = Math.max(20, Math.ceil(Math.log2(workAcc)) + 10);
                    const const_2 = new BigNumber(2n, {acc: workAcc});
                    const const_3 = new BigNumber(3n, {acc: workAcc});
                    let difference, mid;
                    let diffMag = Infinity;

                    do {
                        const prevDiffMag = diffMag;
                        mid = result;
                        const squareOfMid = MathPlus.realTimes(mid, mid);
                        result = MathPlus.realDivide(
                            MathPlus.realPlus(
                                MathPlus.realTimes(mid, const_2),
                                MathPlus.realDivide(scaledBig, squareOfMid)
                            ),
                            const_3
                        );

                        difference = MathPlus.realMinus(mid, result);
                        diffMag = BigNumber.getMag(difference);
                        i++;

                        if (diffMag <= -(acc + 2) || (diffMag <= -acc && diffMag >= prevDiffMag)) {
                            break;
                        }
                    } while (i < max);

                    if (i >= max && diffMag > -acc) {
                        console.warn(`[MathPlus] Cube root (${input.toString()}) calculation takes too long.`);
                        useAlternative = true;
                    }
                }

                // 如果迭代法收敛异常，回退到 pow 备用方法
                if (useAlternative) {
                    const alt = MathPlus.pow(absInput, MathPlus.divide([0, 1n, acc], [0, 3n, acc]));
                    return isBaseNegative ? MathPlus.oppositeNumber(alt) : alt;
                }

                const finalReal = new BigNumber(result, {acc: acc, pow: k});

                if (isBaseNegative) {
                    return new ComplexNumber(MathPlus.oppositeNumber(finalReal));
                }
                return new ComplexNumber(finalReal, {acc: acc});
            }

            return MathPlus.pow(input, MathPlus.divide([0, 1n, acc], [0, 3n, acc]));
        }

        /**
         * 计算 a 的 b 次方根 (ᵇ√a)。
         * - 该方法通过计算 a 的 1/b 次方来实现，即 `a^(1/b)`。
         * - 它能够自动处理实数和复数作为底数和根指数。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} a - 被开方数；可为实数或复数，
         *   返回 `pow(a, 1 / b)` 选定的一个根，负实数开奇次根可得到实根。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} b - 非零根指数；可为复数，
         *   但零会使倒数不存在。需要全部正整数次根时应使用 `RadicalFunctionTools`。
         * @returns {ComplexNumber} 代表选定的 a 的 b 次方根。
         */
        static nroot(a, b) {
            const inputA = MathPlus._arithmeticInput(a);
            const inputB = MathPlus._arithmeticInput(b);
            const acc = Math.min(inputA.acc, inputB.acc);
            const oneOverB = MathPlus.divide([0, 1n, acc], inputB);
            return MathPlus.pow(inputA, oneOverB);
        }

        /**
         * 计算 e 的 x 次方 (e^x)。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数指数；实部控制模长、
         *   虚部控制旋转。过大的实部可能触发结果规模保护，迭代精度取自输入计算上下文。
         * @returns {ComplexNumber} 代表 e^x 结果的 ComplexNumber 实例。
         * @throws {Error} 如果泰勒级数未能收敛。
         */
        static exp(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            // 级数累加和参数还原保留 6 位保护位，返回时统一舍入到输入精度。
            const workAcc = acc + 6;
            const workInput = MathPlus._complexInput(input, workAcc);

            if (input.onlyReal) {
                const re = workInput.re;

                if (re.isZero()) {
                    return new ComplexNumber([0, 1n, acc]);
                }

                if (re.power >= 0) {
                    return new ComplexNumber(MathPlus.pow(BigNumber.approximateConstant(CalcConfig.constants.e), workInput), {acc: acc});
                }

                // 将 x 拆为整数和小数部分：e^x = e^floor(x) · e^(x-floor(x))。
                let resultMid, iterationMantissa;
                const pow = -re.power;
                if (re.acc < pow) {
                    resultMid = new ComplexNumber([0, 1n, workAcc]);
                    iterationMantissa = re.mantissa;
                } else {
                    const realPower = BigNumber.pow10(-re.power);
                    const intPart = re.mantissa / realPower;
                    resultMid = MathPlus.pow(
                        BigNumber.approximateConstant(CalcConfig.constants.e, workAcc),
                        [0, intPart, workAcc]
                    );
                    iterationMantissa = re.mantissa - intPart * realPower;
                }

                // 先计算更小参数的泰勒级数 e^t = Σ(t^n/n!)，随后取十次幂还原小数部分。
                const iteration = new BigNumber(iterationMantissa, {
                    pow: re.power - 1,
                    acc: workAcc,
                    noiseMag: re.noiseMag - 1
                });

                const max = Math.max(workAcc, CalcConfig.globalCalcAccuracy, 16) + 5;
                const minMag = 0 - workAcc - 1;

                let mid = new BigNumber(1n, {pow: 0, acc: workAcc});
                let result = new BigNumber(0n, {pow: 0, acc: workAcc});
                let i = 1;

                for (; BigNumber.getMag(mid) > minMag && !mid.isZero() && i < max; i++) {
                    result = MathPlus.realPlus(result, mid);
                    mid = MathPlus.realDivide(
                        MathPlus.realTimes(iteration, mid),
                        new BigNumber(BigInt(i), {pow: 0, acc: workAcc})
                    );
                }

                if (i >= max) {
                    throw new Error(`[MathPlus] mathematical error: Unreliable result, error source: exp. Input: ${input.toString()}`);
                }

                result = MathPlus._withNoise(result, Math.max(BigNumber.getMag(mid), mid.noiseMag));
                // 组合最终结果：e^x = e^i * e^f
                return new ComplexNumber(MathPlus.times(
                    MathPlus.pow(result, [1, 1n, workAcc]),
                    resultMid
                ), {acc: acc});
            }

            const module = MathPlus.exp(workInput.re);

            // 欧拉公式：e^(a+bi) = e^a(cos b + i·sin b)。
            const cosAngle = MathPlus.cos(workInput.im);
            const sinAngle = MathPlus.sin(workInput.im);

            return new ComplexNumber([
                MathPlus.times(module, cosAngle).re,
                MathPlus.times(module, sinAngle).re
            ], {acc: acc});
        }

        /**
         * 计算 x 的自然对数 (ln(x))。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 非零实数或复数；正实数返回实对数，
         *   负实数与一般复数按主辐角返回主值，零因对数发散而抛错。
         * @returns {ComplexNumber} 代表 ln(x) 结果的 ComplexNumber 实例。
         * @throws {Error} 如果输入为 0，或者内部计算未能收敛。
         */
        static ln(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            // 级数累加和参数还原保留 6 位保护位，返回时统一舍入到输入精度。
            const workAcc = acc + 6;
            const workInput = MathPlus._complexInput(input, workAcc);

            if (input.onlyReal && !input.re.isNegative()) {
                const re = workInput.re;

                if (re.isZero()) {
                    throw new Error('[MathPlus] mathematical error: ln(0) is undefined.');
                }
                if (re.power === 0 && re.mantissa === 1n) {
                    return new ComplexNumber([0, 0n, acc]);
                }

                // 先用 10 和 1.2 缩放到 0.9～1.1，再计算 y=(x-1)/(x+1)。
                // ln(x) = 2·(y + y³/3 + y⁵/5 + ...)，最后补回缩放产生的 ln(10) 与 ln(1.2)。
                const const_1_2 = new BigNumber(12n, {pow: -1, acc: workAcc});
                const const_1_1 = new BigNumber(11n, {pow: -1, acc: workAcc});
                const const_0_9 = new BigNumber(9n, {pow: -1, acc: workAcc});
                // 接近 1 时直接展开，避免缩放后相消使合法小对数落入常数量级的底噪。
                const nearOne = MathPlus.realMinus(re, const_1_1).isNegative() && MathPlus.realMinus(re, const_0_9).isPositive();
                const mantissaLen = BigNumber.decimalLengthBigInt(re.mantissa);
                const mantissaChangedBy10 = nearOne ? 0 : mantissaLen + re.power;
                let mid = new BigNumber(re, {pow: -mantissaChangedBy10, acc: workAcc});

                // 将 x 进一步标准化到 [0.9, 1.1) 范围内
                let mantissaChangedBy1_2 = 0;
                let j = 0;
                for (; !(MathPlus.realMinus(mid, const_1_1).isNegative() && MathPlus.realMinus(mid, const_0_9).isPositive()) && j < 14; j++) {
                    mid = MathPlus.realTimes(mid, const_1_2);
                    mantissaChangedBy1_2 -= 1;
                }

                if (j === 14) {
                    throw new Error(`[MathPlus] mathematical error: Unreliable result, error source: ln. Input: ${input.toString()}`);
                }

                if (nearOne) {
                    mid = MathPlus.realDivide(
                        MathPlus.realMinus(mid, new BigNumber(1n, {pow: 0, acc: workAcc})),
                        MathPlus.realPlus(mid, new BigNumber(1n, {pow: 0, acc: workAcc}))
                    );
                } else {
                    mid = MathPlus.realPlus(
                        new BigNumber(1n, {pow: 0, acc: workAcc}),
                        MathPlus.realDivide(
                            new BigNumber(-2n, {pow: 0, acc: workAcc}),
                            MathPlus.realPlus(new BigNumber(1n, {pow: 0, acc: workAcc}), mid)
                        )
                    );
                }

                const squareOfMid = MathPlus.realTimes(mid, mid);
                const max = Math.max(workAcc, CalcConfig.globalCalcAccuracy, 16) * 2 + 5;
                const minMag = BigNumber.getMag(mid) - workAcc - 1;

                let result = new BigNumber(0n, {pow: 0, acc: workAcc});
                let i = 1;

                for (; BigNumber.getMag(mid) > minMag && !mid.isZero() && i < max; i += 2) {
                    result = MathPlus.realPlus(result, mid);
                    mid = MathPlus.realTimes(
                        MathPlus.realTimes(squareOfMid, mid),
                        MathPlus.realDivide(new BigNumber(BigInt(i), {
                            pow: 0,
                            acc: workAcc
                        }), new BigNumber(BigInt(i + 2), {pow: 0, acc: workAcc}))
                    );
                }

                if (i >= max) {
                    throw new Error(`[MathPlus] mathematical error: Unreliable result, error source: ln. Input: ${input.toString()}`);
                }

                // 首个省略项以及各范围缩减常量的误差均进入最终噪声。
                result = MathPlus._withNoise(result, Math.max(BigNumber.getMag(mid), mid.noiseMag));
                result = MathPlus.realTimes(new BigNumber(2n, {pow: 0, acc: workAcc}), result);
                result = MathPlus.realPlus(result, MathPlus.realTimes(
                    BigNumber.approximateConstant(CalcConfig.constants.ln_10, workAcc),
                    new BigNumber(BigInt(mantissaChangedBy10), {pow: 0, acc: workAcc})
                ));
                result = MathPlus.realPlus(result, MathPlus.realTimes(
                    BigNumber.approximateConstant(CalcConfig.constants.ln_1_2, workAcc),
                    new BigNumber(BigInt(mantissaChangedBy1_2), {pow: 0, acc: workAcc})
                ));

                return MathPlus._complexInput(result, acc);
            }

            // 复对数主值：Log(z) = ln|z| + i·arg(z)。
            const absValue = MathPlus.abs(workInput);
            const lnAbsValue = MathPlus.ln(absValue);
            const argValue = MathPlus.arg(workInput);
            return new ComplexNumber([lnAbsValue.re, argValue.re], {acc: acc});
        }

        /**
         * 计算 x 的常用对数（以 10 为底的对数，log₁₀(x)）。
         * - 该方法基于对数换底公式：lg(x) = ln(x) / ln(10)。
         * - 它能够自动处理实数和复数输入，因为其依赖的 `ln` 和 `divide` 方法已经具备此能力。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 非零实数或复数；按
         *   `ln(x) / ln(10)` 返回主值，因此负实数的结果包含由主辐角产生的虚部。
         * @returns {ComplexNumber} 代表 lg(x) 结果的 ComplexNumber 实例。
         */
        static lg(x) {
            return MathPlus.divide(MathPlus.ln(x), BigNumber.approximateConstant(CalcConfig.constants.ln_10));
        }

        /**
         * 计算以 a 为底，b 的对数 (logₐ(b))。
         * - 该方法基于对数换底公式：logₐ(b) = ln(b) / ln(a)。
         * - 它能够自动处理实数和复数作为底数和真数。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} a - 非零且不为一的对数底；允许复数，
         *   因此结果遵循主复对数的换底分支，而不局限于实数对数域。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} b - 非零真数；允许负实数或复数，
         *   这类输入返回复数主值，零会在计算 `ln(b)` 时抛错。
         * @returns {ComplexNumber} 代表 logₐ(b) 结果的 ComplexNumber 实例。
         * @throws {Error} 如果 a=1，或者 a,b 的某些组合导致 ln(a) 或 ln(b) 未定义（例如 ln(0)）。
         */
        static log(a, b) {
            // 按对数自身的噪声判零，保留接近 1 的合法底数产生的小对数。
            const lnA = Public.zeroCorrect(MathPlus.ln(a));
            return MathPlus.divide(MathPlus.ln(b), lnA);
        }

        /**
         * 利用周期和对称性将角度归约到 [0, π/2]，同时记录符号。
         *
         * @private
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} angle - 以弧度表示的纯实角度；
         *   使用其实部进行周期归约，调用方负责分派非实数输入。
         * @param {'sin'|'cos'} name - 选择需要保留的象限符号规则；只接受 `sin` 或 `cos`。
         * @returns {[BigNumber, 1n|-1n]} 二元组：第 0 项是落在 `[0, π/2]` 的纯实弧度值，
         *   第 1 项是依据原角度象限和 `name` 得到的符号乘子；调用方将级数结果乘以该因子复原。
         * @throws {Error} 角度过大而无法保证精度时抛出。
         */
        static _toLessThanHalfPi(angle, name) {
            const input = MathPlus._arithmeticInput(angle);
            angle = input instanceof BigNumber ? input : input.re;
            const acc = angle.acc;

            const typeFactor = name === 'sin' ? 1n : -1n;
            let changeSign = 1n;

            if (angle.isNegative()) {
                angle = MathPlus.oppositeNumber(angle);

                // sin(-x) = -sin(x) -> 变号 (1 * -1)
                // cos(-x) =  cos(x) -> 不变 (-1 * -1 = 1)
                changeSign = -typeFactor;
            }

            const originalAngle = angle;
            let reduced = false;

            const highPrecisionAcc = -CalcConfig.constants.invTwoPi[0];
            if (!MathPlus.minus(angle, [highPrecisionAcc >> 1, 1n, acc]).re.isNegative()) {
                if (!MathPlus.minus(angle, [highPrecisionAcc, 1n, acc]).re.isNegative()) {
                    throw new Error(`[MathPlus] Input value (${angle.toString()}) is too large.`);
                }
                console.warn('[MathPlus] Unexpected loss of precision occurred in trigonometric calculations.');
            }
            const highPrecisionRe = new BigNumber(angle, {acc: highPrecisionAcc});
            const highPrecisionTwo = new BigNumber(2n, {acc: highPrecisionAcc});
            const highPrecisionPi = BigNumber.approximateConstant(CalcConfig.constants.pi, highPrecisionAcc);
            const twoPi = MathPlus.realTimes(highPrecisionTwo, highPrecisionPi);
            const inversePeriod = BigNumber.approximateConstant(CalcConfig.constants.invTwoPi, highPrecisionAcc);
            const n = MathPlus.floor(MathPlus.realTimes(highPrecisionRe, inversePeriod));
            angle = highPrecisionRe;
            if (!n.isZero()) {
                reduced = true;
                angle = MathPlus.realMinus(angle, MathPlus.realTimes(n.re, twoPi));
            }

            // invTwoPi 的末位舍入可能令商相差一个周期；在高精度下把残余值校正回 [0, 2π)。
            while (angle.isNegative()) {
                reduced = true;
                angle = MathPlus.realPlus(angle, twoPi);
            }
            while (!MathPlus.realMinus(angle, twoPi).isNegative()) {
                reduced = true;
                angle = MathPlus.realMinus(angle, twoPi);
            }

            // 利用 cos(x) = cos(2π - x)，将 re 从 (π, 2π) 映射到 (0, π)
            if (MathPlus.realMinus(angle, highPrecisionPi).isPositive()) {
                reduced = true;
                angle = MathPlus.realMinus(twoPi, angle);

                // sin(2π - x) = -sin(x) -> 变号
                // cos(2π - x) =  cos(x) -> 不变
                // 逻辑推导：
                // if sin (1):  -1 * 1 * current = -current (变)
                // if cos (-1): -1 * -1 * current = current (不变)
                changeSign = -typeFactor * changeSign;
            }

            // 利用 cos(x) = -cos(π - x)，将 re 从 [π/2, π] 映射到 [0, π/2]
            if (!MathPlus.realMinus(MathPlus.realTimes(angle, highPrecisionTwo), highPrecisionPi).isNegative()) {
                reduced = true;
                angle = MathPlus.realMinus(highPrecisionPi, angle);

                // sin(π - x) = sin(x)  -> 不变
                // cos(π - x) = -cos(x) -> 变号
                // 逻辑推导：
                // if sin (1):  1 * current = current (不变)
                // if cos (-1): -1 * current = -current (变)
                changeSign = typeFactor * changeSign;
            }

            if (reduced) {
                angle = new BigNumber(angle, {acc: acc});
                // 只清理相位误差内的残差，精确大角度的量级不能作为相对判零基准。
                const noiseMag = Math.max(
                    originalAngle.noiseMag,
                    angle.noiseMag,
                    BigNumber.getMag(originalAngle) - highPrecisionAcc
                );
                if (!angle.isZero() && BigNumber.getMag(angle) <= noiseMag + 4) {
                    angle = new BigNumber([0, 0n, acc]);
                }
            } else {
                // 未归约时保留原角度的精度和噪声信息。
                angle = originalAngle;
            }

            return [angle, changeSign];
        }

        /**
         * 计算一个数的正弦。
         * - 该方法能够处理实数和复数输入，并返回主值。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 以弧度表示的实数或复数角；
         *   实数先按周期与象限归约，复数分别计算实部和虚部。
         * @returns {ComplexNumber} 代表 sin(x) 结果的 ComplexNumber 实例。
         */
        static sin(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            // 级数累加和参数还原保留 6 位保护位，返回时统一舍入到输入精度。
            const workAcc = acc + 6;
            const workInput = MathPlus._complexInput(input, workAcc);

            if (input.onlyReal) {
                // 将实数参数归约到 [0, π/4]，再用三倍角继续缩减。
                let [re, sign] = MathPlus._toLessThanHalfPi(workInput.re, 'sin');

                if (re.isZero()) {
                    return new ComplexNumber([0, 0n, acc]);
                }

                const threshold = new BigNumber(1n, {pow: -1, acc: workAcc});
                const three = new BigNumber(3n, {pow: 0, acc: workAcc});
                const four = new BigNumber(4n, {pow: 0, acc: workAcc});
                let divideBy3 = 0;
                // 继续除以 3 可加快级数收敛，计算后用 sin(3x)=3sin(x)-4sin³(x) 逐层还原。
                for (; !MathPlus.realMinus(re, threshold).isNegative() && divideBy3 < 4; divideBy3++) {
                    re = MathPlus.realDivide(re, three);
                }
                if (divideBy3 === 4) {
                    throw new Error(`[MathPlus] mathematical error: Unreliable result, error source: sin. Input: ${input.toString()}`);
                }

                const squareOfRe = MathPlus.realTimes(re, re);
                const max = Math.max(workAcc, CalcConfig.globalCalcAccuracy, 16) + 5;
                const minMag = BigNumber.getMag(re) - workAcc - 1;
                let mid = re;
                let result = new BigNumber(0n, {acc: workAcc});
                let i = 0;

                // sin(x)=x-x³/3!+x⁵/5!-...，相邻项递推可避免重复计算幂和阶乘。
                for (; BigNumber.getMag(mid) > minMag && !mid.isZero() && i < max; i++) {
                    result = MathPlus[i % 2 === 0 ? 'realPlus' : 'realMinus'](result, mid);
                    mid = MathPlus.realDivide(
                        MathPlus.realTimes(mid, squareOfRe),
                        new BigNumber(BigInt(2 * i + 2) * BigInt(2 * i + 3), {acc: workAcc})
                    );
                }

                if (i >= max) {
                    throw new Error(`[MathPlus] mathematical error: Unreliable result, error source: sin. Input: ${input.toString()}`);
                }

                result = MathPlus._withNoise(result, Math.max(BigNumber.getMag(mid), mid.noiseMag));
                // 反复应用三倍角公式 sin(3x) = 3sin(x) - 4sin³(x) 来还原结果
                for (; divideBy3 !== 0; divideBy3--) {
                    const squareOfResult = MathPlus.realTimes(result, result);
                    result = MathPlus.realTimes(
                        MathPlus.realMinus(
                            three,
                            MathPlus.realTimes(four, squareOfResult)
                        ),
                        result
                    );
                }

                return new ComplexNumber(new BigNumber(sign * result.mantissa, {
                    pow: result.power,
                    acc: acc,
                    noiseMag: result.noiseMag
                }));
            }

            // sin(a+bi) = sin(a)cosh(b) + i cos(a)sinh(b)。
            const [sinh, cosh] = MathPlus._realSinhCosh(workInput.im);
            return new ComplexNumber([
                MathPlus.realTimes(MathPlus.sin(workInput.re).re, cosh),
                MathPlus.realTimes(MathPlus.cos(workInput.re).re, sinh)
            ], {acc});
        }

        /**
         * 计算 x 的反正弦。
         * - 该函数能够处理实数和复数输入，并返回主值。
         * - 对于实数 `x` 且 `|x| <= 1`，使用 `arcsin(x) = arg(sqrt(1 - x²) + ix)` 计算，数值稳定性好。
         * - 对于实数 `x` 且 `|x| > 1`，结果为复数，使用基于对数的恒等式计算。
         * - 对于复数 `z`，使用通用公式 `arcsin(z) = -i * ln(iz + sqrt(1 - z²))`。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数；实数区间
         *   `[-1, 1]` 返回 `[-π/2, π/2]` 内主值，区间外以及复数输入按主对数分支返回复数。
         * @returns {ComplexNumber} 代表 arcsin(x) 结果的 ComplexNumber 实例。
         */
        static arcsin(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;

            if (input.onlyReal) {
                const re = input.re;
                const one = new ComplexNumber([0, 1n, acc]);
                const absInput = MathPlus.abs(input);

                // 使用恒等式 arcsin(x) = arg(sqrt(1 - x²) + ix)
                // 该恒等式在 x 接近 ±1 时比泰勒级数稳定。
                if (!MathPlus.minus(absInput, one).re.isPositive()) {
                    return MathPlus.arg([
                        MathPlus.sqrt(MathPlus.minus(one, MathPlus.times(re, re))).re,
                        re
                    ]);
                }

                const term = MathPlus.sqrt(MathPlus.minus(MathPlus.times(re, re), one));
                const piOver2 = MathPlus.divide(BigNumber.approximateConstant(CalcConfig.constants.pi), [0, 2n, acc]);

                if (re.isPositive()) { // x > 1
                    // arcsin(x) = π/2 - i * ln(x + sqrt(x² - 1))
                    const lnTerm = MathPlus.ln(MathPlus.plus(re, term));
                    return new ComplexNumber([
                        piOver2.re,
                        MathPlus.oppositeNumber(lnTerm).re
                    ]);
                } else { // x < -1
                    // arcsin(x) = -π/2 + i * ln(-x + sqrt(x² - 1))
                    const lnTerm = MathPlus.ln(MathPlus.plus(MathPlus.oppositeNumber(re), term));
                    return new ComplexNumber([
                        MathPlus.oppositeNumber(piOver2).re,
                        lnTerm.re
                    ]);
                }
            }

            // --- 输入为复数 ---
            // 使用公式: arcsin(z) = -i * ln(iz + sqrt(1 - z²))
            const i = new ComplexNumber([[0, 0n, acc], [0, 1n, acc]]);
            const negI = new ComplexNumber([[0, 0n, acc], [0, -1n, acc]]);
            const one = new ComplexNumber([0, 1n, acc]);

            return MathPlus.times(
                negI,
                MathPlus.ln(MathPlus.plus(
                    MathPlus.times(i, input),
                    MathPlus.sqrt(MathPlus.minus(one, MathPlus.times(input, input)))
                ))
            );
        }

        /**
         * 计算 x 的余弦。
         * - 对于实数，使用范围缩减和泰勒级数进行高精度计算，并返回主值。
         * - 对于复数 a+bi，使用 cos(a)cosh(b) - i sin(a)sinh(b)。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 以弧度表示的实数或复数角；
         *   实数使用范围缩减，复数分别计算实部和虚部，输入精度决定级数停止阈值。
         * @returns {ComplexNumber} 代表 cos(x) 结果的 ComplexNumber 实例。
         * @throws {Error} 如果内部计算未能收敛。
         */
        static cos(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            // 级数累加和参数还原保留 6 位保护位，返回时统一舍入到输入精度。
            const workAcc = acc + 6;
            const workInput = MathPlus._complexInput(input, workAcc);

            if (input.onlyReal) {
                // 将实数参数归约到 [0, π/4]，再用四倍角继续缩减。
                let [re, sign] = MathPlus._toLessThanHalfPi(workInput.re, 'cos');

                if (re.isZero()) {
                    return new ComplexNumber([0, sign, acc]);
                }

                const threshold = new BigNumber(1n, {pow: -1, acc: workAcc});
                const four = new BigNumber(4n, {pow: 0, acc: workAcc});
                const one = new BigNumber(1n, {pow: 0, acc: workAcc});
                const minusOne = new BigNumber(-1n, {pow: 0, acc: workAcc});
                const eight = new BigNumber(8n, {pow: 0, acc: workAcc});
                let divideBy4 = 0;
                // 继续除以 4 可加快级数收敛，计算后用 cos(4x)=8cos⁴(x)-8cos²(x)+1 还原。
                for (; !MathPlus.realMinus(re, threshold).isNegative() && divideBy4 < 3; divideBy4++) {
                    re = MathPlus.realDivide(re, four);
                }
                if (divideBy4 === 3) {
                    throw new Error(`[MathPlus] mathematical error: Unreliable result, error source: cos. Input: ${input.toString()}`);
                }

                const squareOfRe = MathPlus.realTimes(re, re);
                const max = Math.max(workAcc, CalcConfig.globalCalcAccuracy, 16) + 5;
                const minMag = 0 - workAcc - 1;
                let mid = one;
                let result = new BigNumber(0n, {pow: 0, acc: workAcc});
                let i = 0;

                // cos(x)=1-x²/2!+x⁴/4!-...，使用相邻项递推累计。
                for (; BigNumber.getMag(mid) > minMag && !mid.isZero() && i < max; i++) {
                    result = MathPlus[i % 2 === 0 ? 'realPlus' : 'realMinus'](result, mid);
                    mid = MathPlus.realDivide(
                        MathPlus.realTimes(mid, squareOfRe),
                        new BigNumber(BigInt(2 * i + 1) * BigInt(2 * i + 2), {pow: 0, acc: workAcc})
                    );
                }

                if (i >= max) {
                    throw new Error(`[MathPlus] mathematical error: Unreliable result, error source: cos. Input: ${input.toString()}`);
                }

                result = MathPlus._withNoise(result, Math.max(BigNumber.getMag(mid), mid.noiseMag));
                // 反复应用四倍角公式还原原始结果
                for (; divideBy4 !== 0; divideBy4--) {
                    const squareOfResult = MathPlus.realTimes(result, result);
                    result = MathPlus.realPlus(
                        MathPlus.realTimes(
                            MathPlus.realPlus(squareOfResult, minusOne),
                            MathPlus.realTimes(eight, squareOfResult)
                        ),
                        one
                    );
                }

                const res = new ComplexNumber(new BigNumber(sign * result.mantissa, {
                    pow: result.power,
                    acc: acc,
                    noiseMag: result.noiseMag
                }));
                // 按结果自身的噪声判零，保留零点附近仍有有效数字的余弦值。
                return Public.zeroCorrect(res);
            }

            // cos(a+bi) = cos(a)cosh(b) - i sin(a)sinh(b)。
            const [sinh, cosh] = MathPlus._realSinhCosh(workInput.im);
            return new ComplexNumber([
                MathPlus.realTimes(MathPlus.cos(workInput.re).re, cosh),
                MathPlus.oppositeNumber(MathPlus.realTimes(MathPlus.sin(workInput.re).re, sinh))
            ], {acc});
        }

        /**
         * 计算 x 的反余弦。
         * - 该方法利用了核心三角恒等式 arccos(x) = π/2 - arcsin(x)，并返回主值。
         * - 它将计算完全委托给已经实现且功能完备的 `arcsin` 方法，
         * 这种方式不仅代码简洁，而且能自动继承 `arcsin` 对实数和复数输入的处理能力。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数；返回满足主值约定的
         *   `π/2 - arcsin(x)`，实数 `[-1, 1]` 的结果位于 `[0, π]`。
         * @returns {ComplexNumber} 代表 arccos(x) 结果的 ComplexNumber 实例。
         */
        static arccos(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;

            return MathPlus.minus(
                MathPlus.divide(BigNumber.approximateConstant(CalcConfig.constants.pi), [0, 2n, acc]),
                MathPlus.arcsin(input)
            );
        }

        /**
         * 计算 x 的正切。
         * - 该方法通过基本三角恒等式 tan(x) = sin(x) / cos(x) 进行计算，并返回主值。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 以弧度表示的实数或复数角；
         *   通过 `sin(x) / cos(x)` 计算，余弦为零或数值修正后为零时函数未定义。
         * @returns {ComplexNumber} 代表 tan(x) 结果的 ComplexNumber 实例。
         * @throws {Error} 如果 cos(x) 为 0（此时 tan(x) 在数学上是未定义的），
         * 底层的 `divide` 方法将抛出一个“除以零”的错误。
         */
        static tan(x) {
            const input = MathPlus._complexInput(x);
            const sinAngle = MathPlus.sin(input);
            const cosAngle = Public.zeroCorrect(MathPlus.cos(input), sinAngle);

            return MathPlus.divide(sinAngle, cosAngle);
        }

        /**
         * 计算 x 的反正切；实数经范围缩减后使用泰勒级数，复数使用对数恒等式。
         *
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数；实数通过倒数和倍角
         *   归约到稳定区间，复数按主对数恒等式返回主反正切值。
         * @returns {ComplexNumber} arctan(x)。
         * @throws {Error} 迭代未收敛时抛出。
         */
        static arctan(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            // 级数累加和参数还原保留 6 位保护位，返回时统一舍入到输入精度。
            const workAcc = acc + 6;
            const workInput = MathPlus._complexInput(input, workAcc);

            if (input.onlyReal) {
                let re = workInput.re;
                let isNegative = false;

                if (re.isNegative()) {
                    re = MathPlus.oppositeNumber(re);
                    isNegative = true;
                }

                // x > 1 时使用 arctan(x)=π/2-arctan(1/x)。
                let reciprocal = false;
                if (MathPlus.plus(re, [0, -1n, workAcc]).re.isPositive()) {
                    re = MathPlus.divide([0, 1n, workAcc], re).re;
                    reciprocal = true;
                }

                // 反复使用 tan(θ/2)=tanθ/(1+sqrt(1+tan²θ))，把参数缩减到 0.1 以内。
                let j = 0;
                for (; MathPlus.plus(re, [-1, -1n, workAcc]).re.isPositive() && j < 4; j++) {
                    re = MathPlus.divide(
                        re,
                        MathPlus.plus(
                            [0, 1n, workAcc],
                            MathPlus.sqrt(MathPlus.plus([0, 1n, workAcc], MathPlus.times(re, re)))
                        )
                    ).re;
                }
                if (j === 4) {
                    throw new Error(`[MathPlus] mathematical error: Unreliable result, error source: arctan. Input: ${input.toString()}`);
                }

                let [mid, mid_pow] = [re, re];
                const squareOfRe = MathPlus.realTimes(re, re);
                const max = Math.max(workAcc, CalcConfig.globalCalcAccuracy, 16) + 5;
                const minMag = BigNumber.getMag(re) - workAcc - 1;
                let result = new BigNumber(0n, {acc: workAcc});
                let i = 0;

                // arctan(x)=x-x³/3+x⁵/5-...；级数结果乘 2^j 后还原半角缩减。
                for (; BigNumber.getMag(mid) > minMag && !mid.isZero() && i < max; i++) {
                    result = MathPlus[i % 2 === 0 ? 'realPlus' : 'realMinus'](result, mid);

                    mid_pow = MathPlus.realTimes(mid_pow, squareOfRe);
                    mid = MathPlus.realDivide(
                        mid_pow,
                        new BigNumber(BigInt(2 * i + 3), {acc: workAcc})
                    );
                }
                if (i >= max) {
                    throw new Error(`[MathPlus] mathematical error: Unreliable result, error source: arctan. Input: ${input.toString()}`);
                }

                // 将级数结果乘以 2^j 来补偿半角公式的应用。
                result = MathPlus._withNoise(result, Math.max(BigNumber.getMag(mid), mid.noiseMag));
                result = MathPlus.realTimes(new BigNumber(2n ** BigInt(j), {acc: workAcc}), result);

                // 如果初始 x > 1，应用 arctan(x) = π/2 - arctan(1/x)。
                if (reciprocal) {
                    const halfPi = MathPlus.realDivide(
                        BigNumber.approximateConstant(CalcConfig.constants.pi),
                        new BigNumber(2n, {acc: workAcc})
                    );
                    result = MathPlus.realMinus(halfPi, result);
                }
                // 如果初始 x < 0，应用 arctan(-x) = -arctan(x)。
                return new ComplexNumber(isNegative ? MathPlus.oppositeNumber(result) : result, {acc});
            }

            // --- 输入为复数 ---
            // arctan(z) = (-i/2) * ln((1 + iz) / (1 - iz))
            const numerator = MathPlus.minus(
                [[0, 0n, workAcc], [0, 1n, workAcc]],
                workInput
            );
            const denominator = MathPlus.plus(
                [[0, 0n, workAcc], [0, 1n, workAcc]],
                workInput
            );

            if (numerator.isZero() || denominator.isZero()) {
                throw new Error(`[MathPlus] mathematical error: Unable to calculate arctan, input cannot be ${input.toString()}.`);
            }

            // 下支割线取左侧极限：交换分子和分母，按 arctan(z) = -arctan(-z) 取值。
            const onLowerCut = workInput.re.isZero() && denominator.im.isNegative();
            const ratio = onLowerCut ? MathPlus.divide(denominator, numerator) : MathPlus.divide(numerator, denominator);
            return new ComplexNumber(MathPlus.times(
                [[0, 0n, workAcc], [-1, onLowerCut ? 5n : -5n, workAcc]],
                MathPlus.ln(ratio)
            ), {acc: acc});
        }

        /**
         * 计算 x 的双曲正弦。
         * - 对于复数 a+bi，使用 sinh(a)cos(b) + i cosh(a)sin(b)。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数自变量；
         *   较大实部可能触发指数结果规模保护。
         * @returns {ComplexNumber} 代表 sinh(x) 结果的 ComplexNumber 实例。
         */
        static sh(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            const workInput = MathPlus._complexInput(input, acc + 6);
            const [sinh, cosh] = MathPlus._realSinhCosh(workInput.re);

            if (input.onlyReal) {
                return new ComplexNumber(sinh, {acc});
            }
            return new ComplexNumber([
                MathPlus.realTimes(sinh, MathPlus.cos(workInput.im).re),
                MathPlus.realTimes(cosh, MathPlus.sin(workInput.im).re)
            ], {acc});
        }

        /**
         * 计算 x 的反双曲正弦。
         * - 该方法基于反双曲正弦的对数定义：arsinh(x) = ln(x + sqrt(x² + 1))。
         * - 能够自动处理实数和复数输入。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数；按
         *   `ln(x + sqrt(x² + 1))` 的主分支计算，实数输入始终得到实数结果。
         * @returns {ComplexNumber} 代表 arsinh(x) 结果的 ComplexNumber 实例。
         */
        static arsh(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;

            // 负实数利用奇函数性质，避免 x 与 sqrt(x² + 1) 相消。
            if (input.onlyReal && input.re.isNegative()) {
                return MathPlus.oppositeNumber(MathPlus.arsh(MathPlus.oppositeNumber(input)));
            }

            return MathPlus.ln(
                MathPlus.plus(
                    input,
                    MathPlus.sqrt(
                        MathPlus.plus(MathPlus.times(input, input), [0, 1n, acc])
                    )
                )
            );
        }

        /**
         * 计算 x 的双曲余弦。
         * - 对于复数 a+bi，使用 cosh(a)cos(b) + i sinh(a)sin(b)。
         * @alias cosh
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数自变量；
         *   较大实部可能触发指数结果规模保护。
         * @returns {ComplexNumber} 代表 cosh(x) 结果的 ComplexNumber 实例。
         */
        static ch(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            const workInput = MathPlus._complexInput(input, acc + 6);
            const [sinh, cosh] = MathPlus._realSinhCosh(workInput.re);

            if (input.onlyReal) {
                return new ComplexNumber(cosh, {acc});
            }
            return new ComplexNumber([
                MathPlus.realTimes(cosh, MathPlus.cos(workInput.im).re),
                MathPlus.realTimes(sinh, MathPlus.sin(workInput.im).re)
            ], {acc});
        }

        /**
         * 计算 x 的反双曲余弦。
         * @alias arcosh - 该方法基于反双曲余弦的主值定义：arcosh(x) = ln(x + sqrt(x - 1)sqrt(x + 1))。
         * - 能够自动处理实数和复数输入。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数；返回
         *   `ln(x + sqrt(x - 1)sqrt(x + 1))` 的主值。实数 `x >= 1` 时结果为非负实数，其他实数可得到复数。
         * @returns {ComplexNumber} 代表 arcosh(x) 结果的 ComplexNumber 实例。
         */
        static arch(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            const one = new BigNumber(1n, {acc: acc});
            const minusOne = new BigNumber(-1n, {acc: acc});

            // x <= -1 时直接构造 ln(-x + sqrt(x² - 1)) + iπ，保证主值实部非负并避免相消。
            if (input.onlyReal && !MathPlus.realMinus(input.re, minusOne).isPositive()) {
                const squareMinusOne = MathPlus.realPlus(
                    MathPlus.realTimes(input.re, input.re),
                    minusOne
                );
                const realPart = MathPlus.ln(
                    MathPlus.realPlus(
                        MathPlus.oppositeNumber(input.re),
                        MathPlus.sqrt(squareMinusOne).re
                    )
                ).re;

                return new ComplexNumber([
                    realPart,
                    BigNumber.approximateConstant(CalcConfig.constants.pi, acc)
                ]);
            }

            return MathPlus.ln(
                MathPlus.plus(
                    input,
                    MathPlus.times(
                        MathPlus.sqrt(MathPlus.minus(input, one)),
                        MathPlus.sqrt(MathPlus.plus(input, one))
                    )
                )
            );
        }

        /**
         * 计算双曲正切。
         * tanh(x) = (e^(2x) - 1) / (e^(2x) + 1)。
         *
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数自变量；
         *   通过指数等价公式计算，分母为零的复数点会被拒绝。
         * @returns {ComplexNumber} tanh(x)。
         * @alias tanh
         */
        static th(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            const one = [0, 1n, acc];

            // 实部为正时用 (1 - exp(-2x)) / (1 + exp(-2x))，避免中间指数溢出。
            const useNegativeExponent = input.re.isPositive();
            const mid = MathPlus.exp(MathPlus.times([0, useNegativeExponent ? -2n : 2n, acc], input));
            return MathPlus.divide(
                useNegativeExponent ? MathPlus.minus(one, mid) : MathPlus.plus(mid, [0, -1n, acc]),
                Public.zeroCorrect(MathPlus.plus(mid, one), mid, one)
            );
        }

        /**
         * 计算反双曲正切。
         *
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数；按
         *   `ln((1+x)/(1-x))/2` 返回主值，实数 `x = ±1` 为奇点，`|x| > 1` 返回复数。
         * @returns {ComplexNumber} artanh(x)。
         * @alias artanh
         */
        static arth(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;
            const one = new ComplexNumber([0, 1n, acc]);

            return MathPlus.divide(
                MathPlus.ln(
                    MathPlus.divide(
                        MathPlus.plus(one, input),
                        // 按差值自身的噪声判零，保留精确输入与 1 之间的微小差值。
                        Public.zeroCorrect(MathPlus.minus(one, input))
                    )
                ),
                [0, 2n, acc]
            );
        }

        /**
         * 计算一个数的阶乘 (x!)。
         * - 对于非负整数 n, n! = 1 * 2 * ... * n，并返回主值。
         * - 对于非整数、负数和复数，此函数计算伽玛函数 Γ(x + 1)。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 阶乘参数；不超过 100000 的非负整数
         *   走精确的 BigInt 分治乘积，更大的正整数和其他非极点值通过 `Γ(x + 1)` 近似计算。
         * @returns {ComplexNumber} 代表 x! 结果的 ComplexNumber 实例。
         * @throws {Error} 如果输入为负整数，或计算结果超出数值范围。
         */
        static fact(x) {
            /**
             * 使用分治法（二分求积）高效计算一个非负整数的阶乘。
             * 这种方法对于计算极大的数（如 1000! 或更高）有显著的性能优势。
             *
             * @param {bigint} num - 已通过非负性和计算范围校验的整数。
             * @returns {bigint} n 的阶乘。
             */
            function factorialOptimized(num) {
                if (num === 0n || num === 1n) {
                    return 1n;
                }

                /**
                 * 递归的辅助函数，使用分治策略（Divide and Conquer）计算一个数字范围内的所有整数的乘积。
                 * 这个函数专门为处理 BigInt 类型设计，适用于计算大数的阶乘等场景。
                 * @param {bigint} start - 闭区间起点；递归入口保证非负且不大于 `end`。
                 * @param {bigint} end - 闭区间终点；区间按中点二分，单元素区间直接返回该整数。
                 * @returns {bigint} 从 start 到 end 的所有整数的乘积。
                 */
                function rangeProduct(start, end) {
                    if (start > end) {
                        return 1n;
                    }
                    if (start === end) {
                        return start;
                    }

                    // 当范围很小时，直接计算，避免过多递归开销
                    if (end - start < 13n) {
                        let res = 1n;
                        for (let i = start; i <= end; i++) {
                            res *= i;
                        }
                        return res;
                    }

                    // 分治
                    const mid = start + (end - start) / 2n;
                    const leftProduct = rangeProduct(start, mid);
                    const rightProduct = rangeProduct(mid + 1n, end);

                    return leftProduct * rightProduct;
                }

                return rangeProduct(1n, num);
            }

            const input = MathPlus._complexInput(x);
            const acc = input.acc;

            if (input.onlyReal && input.re.power >= 0) {
                const re = input.re;

                if (re.isNegative()) {
                    throw new Error('[MathPlus] mathematical error: Negative integer factorial undefined.');
                }

                // 限制完整阶乘的计算量；更大的正整数使用下方的 Lanczos 近似。
                const maxFactorialInput = 100_000n;
                const maxFactorialMag = 5; // 与 maxFactorialInput 的十进制数量级保持一致
                // 先检查数量级，确保展开整数时只需很小的十次幂。
                if (BigNumber.getMag(re) <= maxFactorialMag) {
                    const realNumber = re.mantissa * BigNumber.pow10(re.power);
                    if (realNumber <= maxFactorialInput) {
                        const result = new BigNumber(factorialOptimized(realNumber), {acc});
                        if (re.noiseMag === -Infinity) {
                            return new ComplexNumber(result);
                        }
                        // Γ'(n+1) = n!·(H_n - γ)，用 1 + ln(n) 给谐和数定界。
                        const derivativeMag = BigNumber.getMag(result) +
                            Math.ceil(Math.log10(1 + Math.log(Number(realNumber))));
                        return new ComplexNumber(MathPlus._withNoise(result, re.noiseMag + derivativeMag));
                    }
                }
            }

            // 大正整数、非整数和复数阶乘使用兰佐斯近似计算 Γ(x+1)。
            let option;
            // 按目标精度选择最小够用的 Lanczos 系数集，避免无谓的大精度运算。
            if (acc <= 40) {
                option = 'lanczos_n20';
            } else if (acc <= 75) {
                option = 'lanczos_n40';
            } else if (acc <= 155) {
                option = 'lanczos_n82';
            } else {
                option = 'lanczos_n164';
            }
            if (acc > CalcConfig.MAX_GLOBAL_CALC_ACCURACY) {
                console.warn(`[MathPlus] The required accuracy(${acc}) is too high. Input: ${x.toString()}`);
            }

            const calcAcc = CalcConfig.constants[option].acc;
            const g = CalcConfig.constants[option].g;
            const p = CalcConfig.constants[option].p;

            let calcNum = MathPlus._complexInput(input, calcAcc);

            // 先在正半平面计算，再由 Γ(z)Γ(1-z)=π/sin(πz) 反射回原参数。
            // Re(z) ∈ [-0.5, 0) 时用 z! = (z + 1)! / (z + 1) 平移到 [0.5, 1)，
            // 既避开近零处的反射与复数 sin 小参相消，也省去一次三角函数计算；
            // Re(z) < -0.5 时再由 Γ(z)Γ(1-z) = π/sin(πz) 反射回原参数。
            let reflection = false;
            let shiftedUp = false;
            if (calcNum.re.isNegative()) {
                const half = new BigNumber([-1, 5n, calcAcc]);
                if (!MathPlus.realPlus(calcNum.re, half).isNegative()) {
                    calcNum = MathPlus.plus(calcNum, [0, 1n, calcAcc]);
                    shiftedUp = true;
                } else {
                    calcNum = MathPlus.oppositeNumber(calcNum);
                    reflection = true;
                }
            }

            // 仅 Lanczos 级数求和保留 calcAcc，抵抗各项正负相消。
            let sum = BigNumber.approximateConstant(p[0]);
            for (let i = 1; i < p.length; i++) {
                sum = MathPlus.plus(
                    sum,
                    MathPlus.divide(BigNumber.approximateConstant(p[i]), MathPlus.plus(calcNum, new BigNumber(i, {
                        acc: calcAcc
                    })))
                );
            }

            // 后续乘方与反射改用动态 workAcc：基础保护位 10 + 指数放大补偿 (inputMag + 2)，且不超过 calcAcc。
            const inputMag = Math.max(
                0,
                BigNumber.getMag(calcNum.re),
                BigNumber.getMag(calcNum.im)
            );
            const workAcc = Math.min(calcAcc, acc + inputMag + 12);

            const workNum = MathPlus._complexInput(calcNum, workAcc);
            const workG = new BigNumber(g, {acc: workAcc});
            const workE = BigNumber.approximateConstant(CalcConfig.constants.e, workAcc);

            // 应用完整的兰佐斯公式：Γ(z+1) = ((z + g + 1/2) / e)^(z + 1/2) * A(z)
            let result = MathPlus._complexInput(sum, workAcc);
            const mid = MathPlus.plus(workNum, [-1, 5n, workAcc]);
            result = MathPlus.times(
                result,
                MathPlus.pow(
                    MathPlus.divide(MathPlus.plus(mid, workG), workE),
                    mid
                )
            );

            // 反射公式：对实部先按最近整数 k 归约，再用 workAcc 计算 sin(π(r + bi))，避免 440 位归约和极点相消。
            if (shiftedUp) {
                // workNum 已是 (input + 1) 在 workAcc 下的值，且 Re(workNum) ∈ [0.5, 1)，除法数值稳定。
                result = MathPlus.divide(result, workNum);
            } else if (reflection) {
                const workPi = BigNumber.approximateConstant(CalcConfig.constants.pi, workAcc);
                const workInput = MathPlus._complexInput(input, workAcc);
                const numerator = MathPlus.times(workInput, workPi);

                let reducedRe;
                let isOddK;
                if (workInput.re.power >= 0) {
                    // 实部已是整数（负实整数已在函数入口拦截，此处虚部必然非零）。
                    reducedRe = new BigNumber([0, 0n, workAcc]);
                    isOddK = workInput.re.power === 0 && (workInput.re.mantissa & 1n) !== 0n;
                } else {
                    const half = new BigNumber([-1, 5n, workAcc]);
                    const nearestK = MathPlus.floor(MathPlus.realPlus(workInput.re, half)).re;
                    reducedRe = MathPlus.realMinus(workInput.re, nearestK);
                    isOddK = !nearestK.isZero() && nearestK.power === 0 && (nearestK.mantissa & 1n) !== 0n;
                }

                const sinArg = MathPlus.times(
                    new ComplexNumber([reducedRe, workInput.im], {acc: workAcc}),
                    workPi
                );
                let sinVal = MathPlus.sin(sinArg);
                if (isOddK) {
                    sinVal = MathPlus.oppositeNumber(sinVal);
                }

                result = MathPlus.divide(
                    numerator,
                    MathPlus.times(sinVal, result)
                );
            }

            return MathPlus._complexInput(result, acc);
        }

        /**
         * 计算 x 的伽玛函数 (Γ(x))。
         * - 伽玛函数是阶乘函数向复数和实数的推广，并返回主值。
         * - 一般使用 Γ(x) = (x-1)!，接近零的非零参数使用 Γ(x) = (x+1)! / (x+1) / x。
         * - 它将计算委托给库中已经实现的、能够处理复数和非整数的 `fact` 方法。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 伽玛函数参数；允许一般复数，
         *   但零和负整数是极点。实部较小时通过反射/递推移入 Lanczos 近似的稳定区域。
         * @returns {ComplexNumber} 代表 Γ(x) 结果的 ComplexNumber 实例。
         * @throws {Error} 如果输入为 0 或负整数，此时伽玛函数未定义。
         */
        static gamma(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;

            // 接近零时改用 Γ(x) = (x+1)! / (x+1) / x，既避免 x - 1 舍入到极点 -1，
            // 又保证 Re(x + 1) > 0.9，绕过 fact 的反射分支及复数 sin 的小参相消。
            if (!input.isZero() && Math.max(BigNumber.getMag(input.re), BigNumber.getMag(input.im)) <= -2) {
                const xPlus1 = MathPlus.plus(input, [0, 1n, acc]);
                return MathPlus.divide(
                    MathPlus.divide(MathPlus.fact(xPlus1), xPlus1),
                    input
                );
            }

            return MathPlus.fact(MathPlus.plus(input, [0, -1n, acc]));
        }

        /**
         * 计算一个数的向下取整 (floor)。
         * - 对于实数 x，返回不大于 x 的最大整数。
         * - 对于复数 a + bi，返回 floor(a) + floor(b)i。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 要向负无穷方向取整的值；
         *   可为实数或复数，复数按实部和虚部分别向下取整，整数输入保持不变。
         * @returns {ComplexNumber} 代表向下取整结果的 ComplexNumber 实例。
         */
        static floor(x) {
            const input = MathPlus._complexInput(x);

            if (input.onlyReal) {
                const re = input.re;
                const acc = re.acc;

                if (re.power >= 0) {
                    return input;
                }

                const pow = -re.power;
                let result = re.acc < pow ? 0n : re.mantissa / BigNumber.pow10(pow);

                // 根据 floor 函数的定义调整结果。
                // - 对于正数，floor(x) 等于 trunc(x)。
                // - 对于负数，如果存在小数部分，floor(x) = trunc(x) - 1。
                if (result < 0n || (result === 0n && re.isNegative())) {
                    result -= 1n;
                }
                return MathPlus._complexInput(result, acc);
            }

            return new ComplexNumber([
                MathPlus.floor(input.re).re,
                MathPlus.floor(input.im).re
            ]);
        }

        /**
         * 计算一个数的向上取整 (ceiling)。
         * - 对于实数 x，返回不小于 x 的最小整数。
         * - 对于复数 a + bi，遵循分部计算的原则，返回 ceil(a) + ceil(b)i。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 要向正无穷方向取整的值；
         *   可为实数或复数，复数按实部和虚部分别向上取整，整数输入保持不变。
         * @returns {ComplexNumber} 代表向上取整结果的 ComplexNumber 实例。
         */
        static ceil(x) {
            const input = MathPlus._complexInput(x);

            if (input.onlyReal) {
                const re = input.re;
                const acc = re.acc;

                if (re.power >= 0) {
                    return input;
                }

                const pow = -re.power;
                let result = re.acc < pow ? 0n : re.mantissa / BigNumber.pow10(pow);

                if (result > 0n || (result === 0n && re.isPositive())) {
                    result += 1n;
                }
                return MathPlus._complexInput(result, acc);
            }

            return new ComplexNumber([
                MathPlus.ceil(input.re).re,
                MathPlus.ceil(input.im).re
            ]);
        }

        /**
         * 计算一个数的绝对值（或模）。
         * - 对于实数 x, |x| 是其到 0 的距离。
         * - 对于复数 z = a + bi, |z| 是其在复平面上到原点的距离，即 sqrt(a² + b²)。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数；实数返回通常的
         *   非负绝对值，复数返回 `sqrt(re² + im²)` 的非负实数模。
         * @returns {ComplexNumber} 一个纯实数的 ComplexNumber 实例，代表输入值的绝对值。
         */
        static abs(x) {
            const input = MathPlus._complexInput(x);
            const re = input.re, im = input.im;

            if (input.onlyReal) {
                return re.isNegative() ? new ComplexNumber(MathPlus.oppositeNumber(re)) : input;
            }

            if (input.re.isZero()) {
                return im.isNegative() ? new ComplexNumber(MathPlus.oppositeNumber(im)) : new ComplexNumber(im);
            }

            const acc = input.acc;
            const workAcc = acc + 6;
            const scale = Math.max(re.power, im.power);
            const absRe = re.isNegative() ? MathPlus.oppositeNumber(re) : re;
            const absIm = im.isNegative() ? MathPlus.oppositeNumber(im) : im;

            // 指数差远超计算精度时，小分量的平方低于保护位，也无需构造比值。
            if (Math.abs(re.power - im.power) > workAcc + acc) {
                const major = re.power === scale ? absRe : absIm;
                return new ComplexNumber(MathPlus._withNoise(major, Math.max(re.noiseMag, im.noiseMag)));
            }

            // 先移除共同指数，在有界范围内计算 M * sqrt(1 + (m / M)^2)。
            const scaledRe = new BigNumber(absRe, {pow: -scale, acc: workAcc});
            const scaledIm = new BigNumber(absIm, {pow: -scale, acc: workAcc});
            const [major, minor] = MathPlus.realMinus(scaledRe, scaledIm).isNegative()
                                   ? [scaledIm, scaledRe] : [scaledRe, scaledIm];
            const ratio = MathPlus.realDivide(minor, major);
            const sum = MathPlus.realPlus(new BigNumber(1n, {acc: workAcc}), MathPlus.realTimes(ratio, ratio));
            const norm = MathPlus.realTimes(major, MathPlus.sqrt(sum).re);

            // 极小的模长在恢复指数前，先按内部可表示的最低位舍入。
            const availableDigits = (scale - Number.MIN_SAFE_INTEGER) + BigNumber.getMag(norm) + 1;
            const rounded = new BigNumber(norm, {acc: Math.min(acc, availableDigits)});
            return new ComplexNumber(new BigNumber(rounded, {pow: scale}), {acc});
        }

        /**
         * 计算一个数的符号函数 (signum function)。
         * - 对于实数 x：如果 x>0, 返回 1; 如果 x<0, 返回 -1; 如果 x=0, 返回 0。
         * - 对于复数 z (z≠0): 返回 z / |z|，这是一个模为 1 的复数，指向 z 的方向。
         * - 对于复数 z=0: 返回 0。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 实数或复数；零返回零，非零值
         *   返回单位方向 `x / abs(x)`，因此复数结果位于单位圆而不只是 `±1`。
         * @returns {ComplexNumber} 代表 sgn(x) 结果的 ComplexNumber 实例。
         */
        static sgn(x) {
            const input = MathPlus._complexInput(x);
            const acc = input.acc;

            if (input.isZero()) {
                return new ComplexNumber([0, 0n, acc]);
            }

            if (input.onlyReal) {
                const result = input.re.isPositive() ? [0, 1n, acc] : [0, -1n, acc];
                return new ComplexNumber(result);
            }
            if (input.re.isZero()) {
                const result = input.im.isPositive() ? [0, 1n, acc] : [0, -1n, acc];
                return new ComplexNumber([[0, 0n, acc], result]);
            }
            return MathPlus.divide(input, MathPlus.abs(input));
        }

        /**
         * 将角度从度 (degree) 转换为弧度 (radian)。
         * - 计算公式为：radians = degrees * π / 180。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} x - 以角度制表示的实数或复数值；
         *   通过乘以 `π / 180` 转为弧度，返回值精度受输入与圆周率常量共同限制。
         * @returns {ComplexNumber} 代表转换后弧度值的 ComplexNumber 实例。
         */
        static degree(x) {
            const input = MathPlus._arithmeticInput(x);
            const acc = input.acc;

            return MathPlus.times(
                MathPlus.divide(input, [1, 18n, acc]),
                BigNumber.approximateConstant(CalcConfig.constants.pi)
            );
        }

        /**
         * 将宽松输入转换为显式结构的词元，供 Pratt 解析器消费。
         * @param {string} expr - 内部表达式。
         * @returns {{tokens:string[],lastTokenInfo:object}} 已补全结构的词元及省略括号规则使用的末态。
         * @private
         */
        static _normalizeExpressionTokens(expr) {
            expr = expr.replaceAll('[cdot]', '').replaceAll('**', '^').replace(/\s/g, '');

            // 补齐隐式乘法、一元符号、绝对值和缺失括号，保留既有输入规则。
            let [output, input] = [[], Public.tokenizer(expr, {baseNumberMode: 'together'})];
            if (input[0] === 'error') {
                throw new MathPlus._ExpressionSyntaxError(`[MathPlus] syntax error: Illegal input (${input[1]}).`);
            }

            // 只允许在竖线前补齐原本缺失的右括号，保留完整括号内的嵌套绝对值语义。
            const unmatchedParens = [];
            const inputOffsets = [0];
            for (let i = 0; i < input.length; i++) {
                inputOffsets.push(inputOffsets[i] + input[i].length);
                if (input[i] === '(') {
                    unmatchedParens.push(i);
                } else if (input[i] === ')') {
                    unmatchedParens.pop();
                }
            }
            const missingRightParens = new Set(unmatchedParens);
            const openParens = [];

            let lastTokenInfo = {};
            // kh 记录全局括号，minKh 记录需要添加左括号的个数，addKh 记录当前分母的括号层级。
            let kh = 0, minKh = 0, addKh = 0;
            let tempBracketIdx = -1; // 记录临时 隐式乘法前括号 应该插在哪个索引后面，-1 表示当前没有
            let deferredImplicitLevel = null; // 输入结束时，等待内部缺失括号补齐后再关闭分母。
            const openAfter = [];   // 延迟插入 '(' 的计数表
            const orderOfTimes = Public.getTokenInfo('*').priority;
            const orderOfInvisibleTimes = Public.getTokenInfo('&').priority;
            const absKhStack = []; // 栈用于跟踪绝对值符号的嵌套层级。
            // 按输出括号层级记录最近的低优先级运算，避免每次隐式乘法都回溯整个前缀。
            // 延迟左括号尚未展开，须按累计输出层级保留索引，与原回溯的括号计数一致。
            const boundaryIndices = new Map();
            let outputLevel = 0;
            const pushToken = (token) => {
                if (token === '(') {
                    outputLevel++;
                } else if (token === ')') {
                    outputLevel--;
                } else {
                    const info = Public.getTokenInfo(token);
                    if (info.class === 'func' && info.priority > orderOfInvisibleTimes) {
                        boundaryIndices.set(outputLevel, output.length);
                    }
                }
                output.push(token);
            };

            for (let i = 0; i < input.length; i++) {
                let currentToken = input[i];
                const absoluteParens = absKhStack[absKhStack.length - 1];
                if (
                    currentToken === '|' && absoluteParens > 0 &&
                    !['front', 'middle'].includes(lastTokenInfo.funcPlace) &&
                    !['(', ','].includes(lastTokenInfo.token) &&
                    missingRightParens.has(openParens[openParens.length - 1])
                ) {
                    // 最内层左括号缺少配对时，其尚未闭合的外层左括号也都缺少配对。
                    // 逐个按常规右括号处理，让隐式乘法先闭合；随后重新处理同一竖线。
                    currentToken = ')';
                    i -= 1;
                }
                const tokenInfo = Public.getTokenInfo(currentToken);
                let currentPush = currentToken;
                let closesAbsoluteValue = false;

                if (tokenInfo.isPrivate) {
                    // 像 'log' 这样的二元前缀函数后面必须跟 '('。
                    const position = inputOffsets[i];
                    throw new MathPlus._ExpressionSyntaxError(`[MathPlus] syntax error: Illegal input (${position}).`);
                }
                if (lastTokenInfo.parameters === 2 && lastTokenInfo.funcPlace === 'front' && currentPush !== '(') {
                    const position = inputOffsets[i];
                    throw new MathPlus._ExpressionSyntaxError(`[MathPlus] syntax error: A prefix binary function must be followed by a left parenthesis (${position}).`);
                }

                // --- 括号信息记录 ---
                if (currentPush === '(') {
                    openParens.push(i);
                    kh += 1;
                    if (absKhStack.length > 0) {
                        absKhStack[absKhStack.length - 1] += 1;
                    }
                } else if (currentPush === ')') {
                    openParens.pop();
                    kh -= 1;
                    if (absKhStack.length > 0) {
                        absKhStack[absKhStack.length - 1] -= 1;
                        if (absKhStack[absKhStack.length - 1] < 0) {
                            const position = inputOffsets[i];
                            throw new MathPlus._ExpressionSyntaxError(`[MathPlus] syntax error: Absolute value internal parentheses do not match (${position}).`);
                        }
                    }
                    if (kh < minKh) {
                        minKh = kh;
                    }
                }

                // --- 隐式乘法插入 ---
                if (lastTokenInfo.class === 'number' && tokenInfo.class === 'number') {
                    // 数字/常量、后缀函数和括号相邻时插入内部隐式乘法词元 `&`。
                    pushToken('&');
                } else if (
                    tokenInfo.funcPlace === 'front' &&
                    (lastTokenInfo.class === 'number' || lastTokenInfo.funcPlace === 'back')
                ) {
                    pushToken('&');
                } else if (lastTokenInfo.funcPlace === 'back' && tokenInfo.class === 'number') {
                    pushToken('&');
                } else if (
                    currentPush === '(' &&
                    (lastTokenInfo.class === 'number' || lastTokenInfo.funcPlace === 'back' || lastTokenInfo.token === ')')
                ) {
                    pushToken('&');
                } else if (
                    lastTokenInfo.token === ')' &&
                    (tokenInfo.class === 'number' || tokenInfo.funcPlace === 'front')
                ) {
                    pushToken('&');
                }

                // --- 处理正负号 ---
                if (
                    ['+', '-'].includes(currentPush) &&
                    !(
                        lastTokenInfo.class === 'number' ||
                        lastTokenInfo.funcPlace === 'back' ||
                        lastTokenInfo.token === ')'
                    )
                ) {
                    // 缺少左操作数的 `-` 转为内部一元负号 `N`；一元 `+` 可直接忽略。
                    if (currentPush === '+') {
                        continue;
                    }
                    currentPush = 'N';
                }

                // --- 处理绝对值 ---
                // `|...|` 转换为内部绝对值函数 `A(...)`，栈记录嵌套括号以识别闭合竖线。
                if (currentPush === '|') {
                    // 默认此处表示绝对值的开始。
                    currentPush = '(';
                    if (
                        absKhStack.length !== 0 &&
                        absKhStack[absKhStack.length - 1] === 0 &&
                        !['front', 'middle'].includes(lastTokenInfo.funcPlace) &&
                        !['(', ','].includes(lastTokenInfo.token)
                    ) {
                        closesAbsoluteValue = true;
                        currentPush = ')';
                        kh -= 1;
                        absKhStack.pop();
                    }
                    // 其余情况将 '|' 视为绝对值的开始
                    else if (
                        lastTokenInfo.class === 'number' ||
                        lastTokenInfo.token === ')' ||
                        lastTokenInfo.funcPlace === 'back'
                    ) {
                        pushToken('&');
                    }
                    if (currentPush === '(') {
                        absKhStack.push(0);
                        kh += 1;
                        pushToken('A');
                    }
                }

                // --- 隐式乘法添加括号逻辑 ---
                // 为了消除歧义。例如，`1/2x` 应该是 `1/(2&x)`。
                if (
                    (output[output.length - 1] === '&' || (output[output.length - 1] === 'A' && output[output.length - 2] === '&')) &&
                    tempBracketIdx === -1
                ) {
                    const boundary = boundaryIndices.get(outputLevel);
                    if (boundary !== undefined && output[boundary] !== '*' &&
                        Public.getTokenInfo(output[boundary]).priority <= orderOfTimes) {
                        tempBracketIdx = boundary;
                    }
                    addKh = currentPush === '(' ? kh - 1 : kh;
                }

                // 按转换后的一元负号判断边界，避免将函数负参数或负指数截断。
                const currentInfo = Public.getTokenInfo(currentPush);
                // 解决为隐式乘法添加的另一半括号
                const hitBoundary =
                    (currentInfo.class === 'func' && currentInfo.priority > orderOfInvisibleTimes && kh === addKh) ||
                    (currentPush === ')' && kh < addKh) ||
                    (currentPush === ',' && kh === addKh);

                if (tempBracketIdx !== -1 && (hitBoundary || i + 1 === input.length)) {
                    const needClose = hitBoundary
                                      ? (currentPush === ')' || currentPush === ',' || currentInfo.priority >= orderOfTimes)
                                      : true;

                    if (needClose) {
                        // 目前 token 优先级低于显式乘法，或已到达表达式末尾，需要补全括号
                        openAfter[tempBracketIdx] = (openAfter[tempBracketIdx] || 0) + 1;
                        if (i + 1 === input.length && !hitBoundary && kh > addKh) {
                            deferredImplicitLevel = addKh;
                        } else if (i + 1 === input.length && !hitBoundary) {
                            // 分母包含末尾绝对值时，竖线与其右括号必须一起位于分母内。
                            if (closesAbsoluteValue) {
                                pushToken('|');
                                closesAbsoluteValue = false;
                            }
                            pushToken(currentPush);
                            currentPush = ')';
                        } else {
                            pushToken(')');
                        }
                    }
                    tempBracketIdx = -1;
                }

                // 绝对值内的隐式乘法先补全右括号，再写入闭合竖线。
                if (closesAbsoluteValue) {
                    pushToken('|');
                }
                if (i + 1 !== input.length) {
                    lastTokenInfo = Public.getTokenInfo(currentPush);
                } else {
                    lastTokenInfo = {};
                }
                pushToken(currentPush);
            }

            // 1) 展开隐式乘法延迟插入的 '('
            if (openAfter.length > 0) {
                const expanded = [];
                for (let i = 0; i < output.length; i++) {
                    expanded.push(output[i]);
                    for (let k = 0; k < (openAfter[i] || 0); k++) {
                        expanded.push('(');
                    }
                }
                output = expanded;
            }

            // 2) 一次性补齐缺失的左括号（替代 while 里的 ['(', ...output]）
            if (minKh < 0) {
                output = Array(-minKh).fill('(').concat(output);
                kh -= minKh;
                if (deferredImplicitLevel !== null) {
                    deferredImplicitLevel -= minKh;
                }
            }

            const closeMissingParen = () => {
                output.push(')');
                kh -= 1;
                if (kh === deferredImplicitLevel) {
                    output.push(')');
                    deferredImplicitLevel = null;
                }
            };
            // 3) 先补齐绝对值及其内部括号，再关闭包含它的隐式乘法分母。
            for (let i = absKhStack.length - 1; i >= 0; i--) {
                for (let j = 0; j < absKhStack[i]; j++) {
                    closeMissingParen();
                }
                output.push('|');
                closeMissingParen();
            }

            // 4) 关闭剩余未闭合的常规括号。
            while (kh > 0) {
                closeMissingParen();
            }

            return {tokens: output, lastTokenInfo};
        }

        /**
         * Pratt 解析：nud 读取操作数、括号和前缀函数，led 按绑定优先级读取中缀与后缀。
         * 使用显式调用帧代替递归，深层括号、前缀函数和右结合幂均不消耗 JS 调用栈。
         * @param {Iterable<string>} tokens - 按需补齐括号的词元流。
         * @returns {{expr:string,rpn:Array<object>}} 规范化表达式和逆波兰指令。
         * @private
         */
        static _compilePratt(tokens) {
            const reader = tokens[Symbol.iterator]();
            const output = [];
            const rpn = [];
            const methods = {
                '+': 'plus', '-': 'minus', '*': 'times', '&': 'times', '/': 'divide',
                '^': 'pow', 'E': 'exponential', '!': 'fact', 'A': 'abs',
                'N': 'oppositeNumber', 'f': '_customFunc', 'g': '_customFunc'
            };
            let current = reader.next();
            let currentInfo = Public.getTokenInfo(current.value);
            let depth = 0;
            let invalidLocalDepth = false;
            // 记录局部缺参，仍先保留既有的运算符、逗号和括号错误报告顺序。
            const validateDepth = (baseDepth, expected = 1) => {
                if (depth - baseDepth !== expected) {
                    invalidLocalDepth = true;
                }
            };
            const advance = () => {
                output.push(current.value);
                current = reader.next();
                currentInfo = Public.getTokenInfo(current.value);
            };
            const emitOperator = (info, hasComma = false) => {
                const {token, funcPlace, parameters} = info;
                if (funcPlace === 'front' && parameters === 2 && !hasComma) {
                    throw new MathPlus._ExpressionSyntaxError(`[MathPlus] syntax error: Missing comma in binary function ${token}.`);
                }
                if (depth < parameters) {
                    throw new MathPlus._ExpressionSyntaxError(`[MathPlus] syntax error: Insufficient parameters for function ${token}.`);
                }
                depth += 1 - parameters;
                rpn.push({token, method: methods[token] ?? token.replace(/[\[\]]/g, ''), parameters});
            };
            /**
             * 显式声明两类调用帧的字段，避免数组仅按初始根括号帧推断类型。
             * @typedef {object} PrattCompileFrame
             * @property {'group'|'expression'} kind - 调用帧类型。
             * @property {boolean} [root] - 是否为根括号帧。
             * @property {PrattCompileFrame} [owner] - 所属二元前缀函数帧。
             * @property {number} [argumentDepth] - 当前括号参数的起始栈深度。
             * @property {string} [state] - 表达式解析状态。
             * @property {number} [minBinding] - 最低绑定优先级。
             * @property {number} [baseDepth] - 表达式的起始栈深度。
             * @property {object} [operator] - 待读取参数的运算符信息。
             * @property {boolean} [hasComma] - 是否已读取二元函数的逗号。
             */
            /** @type {PrattCompileFrame[]} */
            const frames = [{kind: 'group', root: true, argumentDepth: 0}];
            const expression = (minBinding, owner) => {
                frames.push({kind: 'expression', state: 'start', minBinding, owner, baseDepth: depth});
            };

            while (frames.length > 0) {
                const frame = frames[frames.length - 1];
                const token = current.value;
                const info = currentInfo;
                if (frame.kind === 'group') {
                    if (token === '|') {
                        // 竖线是显示标记，绝对值由内部 A(...) 指令执行。
                        advance();
                    } else if (token === ',') {
                        if (!frame.owner || frame.owner.hasComma) {
                            throw new MathPlus._ExpressionSyntaxError('[MathPlus] syntax error: Commas mismatch or incorrect position.');
                        }
                        validateDepth(frame.argumentDepth);
                        frame.argumentDepth = depth;
                        frame.owner.hasComma = true;
                        advance();
                    } else if (token === ')' || current.done) {
                        if (!!frame.root !== current.done) {
                            throw new MathPlus._ExpressionSyntaxError('[MathPlus] syntax error: The parentheses do not match.');
                        }
                        validateDepth(frame.argumentDepth);
                        if (token === ')') {
                            advance();
                        }
                        frames.pop();
                    } else {
                        expression(-Infinity);
                    }
                    continue;
                }

                if (frame.state === 'prefix' || frame.state === 'infix') {
                    emitOperator(frame.operator, frame.hasComma);
                    frame.state = 'loop';
                } else if (frame.state === 'atom') {
                    frame.state = 'loop';
                }

                if (frame.state === 'start') {
                    if (info?.class === 'number') {
                        rpn.push({operand: token});
                        depth++;
                        advance();
                        frame.state = 'loop';
                        continue;
                    }
                    if (token === '(') {
                        frame.state = 'atom';
                        frames.push({kind: 'group', owner: frame.owner, argumentDepth: depth});
                        advance();
                        continue;
                    }
                    if (info?.funcPlace === 'front') {
                        frame.operator = info;
                        frame.state = 'prefix';
                        advance();
                        expression(-info.priority, info.parameters === 2 ? frame : undefined);
                        continue;
                    }
                    frame.state = 'loop';
                }

                if (info?.funcPlace === 'front' || info?.class === 'number' || token === '(') {
                    invalidLocalDepth = true;
                    frame.state = 'atom';
                    expression(frame.minBinding);
                    continue;
                }
                if (info?.class === 'func') {
                    // 配置中的 priority 越小越强，Pratt 的绑定值越大越强。
                    const binding = -info.priority;
                    if (binding >= frame.minBinding) {
                        advance();
                        if (info.funcPlace === 'back') {
                            emitOperator(info);
                        } else {
                            frame.operator = info;
                            frame.state = 'infix';
                            expression(binding + (info.associativity === 'left' ? 1 : 0));
                        }
                        continue;
                    }
                }
                validateDepth(frame.baseDepth, frame.owner ? 2 : 1);
                frames.pop();
            }

            if (depth !== 1 || invalidLocalDepth) {
                throw new MathPlus._ExpressionSyntaxError('[MathPlus] syntax error: The final stack should have exactly one value.');
            }
            const expr = output.join('').replaceAll('A(', '|').replaceAll('|)', '|')
                .replaceAll('&', '[cdot]').replaceAll('N', '-');
            return {expr, rpn};
        }

        /**
         * 按绑定边界按需提供显式词元，保留省略括号时的既有显示约定。
         * 尚未确定作用范围的函数和幂只缓存在当前读取器内，不修改源词元。
         * @param {{tokens:string[],lastTokenInfo:object}} source - 宽松输入规范化后的词元及末态。
         * @yields {string} 已补齐函数和幂括号的词元。
         * @private
         */
        static* _prattTokenStream({tokens, lastTokenInfo}) {
            const prefixPriority = Public.getTokenInfo('sin').priority;
            const powerPriority = Public.getTokenInfo('^').priority;
            const scopes = new Map();
            let level = 0;
            let pending = 0;
            let order = 0;
            let absoluteEnd = false;
            let buffer = [];
            // 保留尾随一元 + 后末态仍指向函数或幂时的边界行为。
            let tail = {order: -1};

            const append = (token) => {
                const entry = {token, order: order++, opens: 0};
                tail.next = entry;
                tail = entry;
                buffer.push(entry);
            };
            const take = (scope, key) => {
                const entries = scope[key];
                scope[key] = [];
                pending -= entries.length;
                return entries;
            };
            const skipLastPower = (scope) => {
                const a = scope.power.at(-1);
                const b = scope.powerCertain.at(-1);
                const aOrder = a?.order ?? -1;
                const bOrder = b?.order ?? -1;
                if (aOrder !== -1 || bOrder !== -1) {
                    (aOrder > bOrder ? scope.power : scope.powerCertain).pop();
                    pending--;
                }
            };
            const close = (entries, force = false) => {
                for (const entry of entries) {
                    if (force || entry.next?.token !== '(' || tail.token !== ')') {
                        entry.opens = (entry.opens || 0) + 1;
                        append(')');
                    }
                }
            };
            for (const token of tokens) {
                if (token === '|') {
                    absoluteEnd = true;
                    continue;
                }
                const info = Public.getTokenInfo(token);
                if (token === '(') {
                    level++;
                }
                const operatorBoundary = info.class === 'func' && info.funcPlace !== 'front';
                const delimiter = token === ',' || token === ')';
                const scope = scopes.get(level);

                if (scope && (operatorBoundary || delimiter)) {
                    // 显式括号后的高优先级后缀会延长幂的作用范围。
                    if (
                        ((info.priority > prefixPriority || delimiter) && scope.prefixCertain.length) ||
                        ((info.priority > powerPriority || delimiter) && scope.powerCertain.length)
                    ) {
                        if (scope.powerCertain.length) {
                            skipLastPower(scope);
                        }
                        close([
                            ...take(scope, 'prefix'), ...take(scope, 'prefixCertain'),
                            ...take(scope, 'power'), ...take(scope, 'powerCertain')
                        ], true);
                    }
                    if (info.priority > prefixPriority) {
                        close(take(scope, 'prefix'));
                    } else if (info.priority < prefixPriority) {
                        const entries = take(scope, 'prefix');
                        for (const entry of entries) {
                            scope.prefixCertain.push(entry);
                        }
                        pending += entries.length;
                    }
                    if (info.priority > powerPriority && scope.power.length) {
                        skipLastPower(scope);
                        close([...take(scope, 'power'), ...take(scope, 'powerCertain')]);
                    } else if (info.priority < powerPriority) {
                        const entries = take(scope, 'power');
                        for (const entry of entries) {
                            scope.powerCertain.push(entry);
                        }
                        pending += entries.length;
                    }
                }
                if (scope && !scope.prefix.length && !scope.prefixCertain.length &&
                    !scope.power.length && !scope.powerCertain.length) {
                    scopes.delete(level);
                }

                if (token === ')') {
                    level--;
                }
                if (lastTokenInfo.needKh) {
                    const ownerLevel = token === '(' ? level - 1 : level;
                    let owner = scopes.get(ownerLevel);
                    if (!owner) {
                        // Certain 保存遇到更高优先级运算后必须补齐括号的作用域。
                        owner = {prefix: [], prefixCertain: [], power: [], powerCertain: []};
                        scopes.set(ownerLevel, owner);
                    }
                    owner[lastTokenInfo.token === '^' ? 'power' : 'prefix'].push(tail);
                    pending++;
                }
                if (absoluteEnd) {
                    absoluteEnd = false;
                    append('|');
                }
                lastTokenInfo = info;
                append(token);
                // 没有待定作用域时即可交给 Pratt 消费；末尾函数还要等待下一词元。
                if (pending === 0 && !info.needKh) {
                    for (const entry of buffer) {
                        yield entry.token;
                        for (let i = 0; i < entry.opens; i++) {
                            yield '(';
                        }
                    }
                    buffer = [];
                }
            }

            const remaining = [];
            for (const scope of scopes.values()) {
                for (const key of ['prefix', 'prefixCertain', 'power', 'powerCertain']) {
                    for (const entry of scope[key]) {
                        remaining.push({
                            entry,
                            power: key.startsWith('power'),
                            certain: key.endsWith('Certain')
                        });
                    }
                }
            }
            remaining.sort((a, b) => b.entry.order - a.entry.order);
            let lastPower = true;
            for (const {entry, power, certain} of remaining) {
                if (power && lastPower) {
                    lastPower = false;
                } else {
                    close([entry], certain);
                }
            }
            for (const entry of buffer) {
                yield entry.token;
                for (let i = 0; i < entry.opens; i++) {
                    yield '(';
                }
            }
        }

        /**
         * 计算用户定义的 f(x) 或 g(x)，并保留相互引用的上下文。
         *
         * @private
         * @param {'f'|'g'} token - 本次要进入的自定义函数名；用于选择表达式并保留另一函数的引用。
         * @param {object} funcs - `f`、`g` 的原始表达式或编译结果；被调用函数可引用另一项。
         *   缺失当前 `token` 对应表达式时视为未定义函数。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} unknown - 代入表达式中 `[x]` 的值；
         *   复数和高精度表示原样进入递归计算上下文。
         * @param {number} acc - 递归求值使用的正整数有效位数；沿用外层计算精度，避免嵌套调用降精度。
         * @returns {ComplexNumber} 函数值。
         */
        static _customFunc(token, funcs, unknown, acc) {
            const body = funcs[token];
            if (body === undefined) {
                throw new Error(`[MathPlus] input error: Function ${token} is undefined or cyclically called.`);
            }
            const another = token === 'f' ? 'g' : 'f';
            const compiled = Array.isArray(body?.rpn) ? body : MathPlus.compile(body, {acc});
            return MathPlus.evalRPN(compiled.rpn, {[another]: funcs[another], unknown, acc});
        }

        /**
         * 在指定上下文中执行已编译的逆波兰指令。
         *
         * @param {Array<object>} rpn - `MathPlus.compile` 返回的指令序列。
         * @param {object} [options={}] - 本次求值的变量、函数和精度上下文。
         * @param {string|number|bigint|BigNumber|ComplexNumber|Array} [options.unknown] - 用于替换 `[x]` 的数值。
         * @param {string|{expr:string,rpn:Array<object>}} [options.f] - `[f]` 的表达式或编译结果。
         * @param {string|{expr:string,rpn:Array<object>}} [options.g] - `[g]` 的表达式或编译结果。
         * @param {number} [options.acc=CalcConfig.globalCalcAccuracy] - 解析操作数与自定义函数时采用的有效位数。
         * @returns {ComplexNumber} 表达式的数值。
         * @throws {Error} 变量或函数未定义、发生循环调用或运算失败时抛出。
         */
        static evalRPN(rpn, {unknown, f, g, acc = CalcConfig.globalCalcAccuracy} = {}) {
            const stack = [];
            for (const {operand, token, method, parameters} of rpn) {
                if (method === undefined) {
                    switch (operand) {
                        case '[pi]':
                            // 常量本身也是近似值，须让整数倍角度继承其相位误差。
                            stack.push(new ComplexNumber(BigNumber.approximateConstant(CalcConfig.constants.pi, acc)));
                            break;
                        case '[e]':
                            stack.push(new ComplexNumber(BigNumber.approximateConstant(CalcConfig.constants.e, acc)));
                            break;
                        case '[i]':
                            stack.push(new ComplexNumber([[0, 0n, acc], [0, 1n, acc]]));
                            break;
                        case '[x]':
                            if (unknown === undefined) {
                                throw new Error('[MathPlus] input error: x is undefined.');
                            }
                            stack.push(MathPlus._complexInput(unknown, acc));
                            break;
                        default:
                            stack.push(MathPlus._complexInput(operand, acc));
                    }
                    continue;
                }

                const b = stack.pop();
                if (parameters === 2) {
                    stack.push(MathPlus[method](stack.pop(), b));
                } else if (method === '_customFunc') {
                    stack.push(MathPlus._customFunc(token, {f, g}, b, acc));
                } else {
                    stack.push(MathPlus[method](b));
                }
            }
            return MathPlus._complexInput(stack[0], acc);
        }

        /**
         * 规范化表达式并生成已校验的逆波兰指令。变量和常量在求值时按上下文绑定。
         *
         * @param {string|number|bigint|ComplexNumber|BigNumber} expr - 内部表达式或数值。
         * @param {object} [options={}] - 数值输入的规范化选项。
         * @param {number} [options.acc=CalcConfig.globalCalcAccuracy] - 数值输入格式化前的有效位数。
         * @returns {{expr:string,rpn:Array<{operand:string|number|bigint|ComplexNumber|BigNumber}|{token:string,method:string,parameters:number}>}}
         *   `expr` 是规范化表达式；`rpn` 中的操作数入栈，运算指令按 `parameters` 取出操作数并调用 `method`。
         * @throws {SyntaxError} 字符串含非法词元、分隔符错位或求值栈深度不符合语法时抛出，错误名为 `ExpressionSyntaxError`。
         * @throws {Error} 输入类型不受支持或数值输入无法格式化时抛出。
         */
        static compile(expr, {acc = CalcConfig.globalCalcAccuracy} = {}) {
            const inputType = Public.typeOf(expr);
            if (['number', 'bigint', 'complexnumber', 'bignumber'].includes(inputType)) {
                const val = MathPlus._complexInput(expr, acc);
                return {expr: val.toString(), rpn: [{operand: expr}]};
            }
            if (inputType !== 'string') {
                throw new Error('[MathPlus] Disallowed input type.');
            }

            if (expr === '') {
                throw new MathPlus._ExpressionSyntaxError('[MathPlus] syntax error: Input is empty.');
            }

            return MathPlus._compilePratt(MathPlus._prattTokenStream(MathPlus._normalizeExpressionTokens(expr)));
        }

        /**
         * 使用 Pratt 解析器编译并计算高精度实数或复数表达式。
         *
         * @param {string|number|bigint|ComplexNumber|BigNumber} expr - 要解析的内部数学表达式；非字符串数值
         *   会先转换为等价词元。表达式可包含 `[x]`、`[f]`、`[g]` 以及 `TokenConfig` 注册的函数。
         * @param {object} [options={}] - 本次解析上下文；仅在递归求值中传递，不修改全局函数定义。
         * @param {string|number|bigint|ComplexNumber|BigNumber} [options.unknown] - 代入 `[x]` 的值；
         *   表达式实际引用 `[x]` 而该项缺失时会按未定义变量处理。
         * @param {string} [options.f] - `[f]` 的函数体，可包含 `[x]` 并调用 `[g]`；只提供 `g` 时
         *   `[f]` 仍保持未定义。
         * @param {string} [options.g] - `[g]` 的函数体，可包含 `[x]` 并调用 `[f]`；与 `f` 一同传入时
         *   支持调用另一函数；求值时移除已进入的函数绑定，阻止循环调用。
         * @param {'calc'|'syntaxCheck'} [options.mode='calc'] - `calc` 执行运算并返回数值；`syntaxCheck`
         *   只验证和规范化表达式，不应依赖其数值结果。
         * @param {number} [options.acc=CalcConfig.globalCalcAccuracy] - 本次解析及所有嵌套运算使用的正整数
         *   有效位数；不会改写 `CalcConfig.globalCalcAccuracy`。
         * @returns {[ComplexNumber, string]} 二元组：第 0 项是表达式值；字符串在 `syntaxCheck` 模式下
         *   返回指定精度的零占位，直接传入的数值仍返回其数值。第 1 项是补全隐式结构后的内部表达式。
         * @throws {Error} 语法、词元或计算无效时抛出。
         */
        static calc(expr, {unknown, f, g, mode = 'calc', acc = CalcConfig.globalCalcAccuracy} = {}) {
            const compiled = MathPlus.compile(expr, {acc});
            const result = mode === 'calc' || Public.typeOf(expr) !== 'string'
                           ? MathPlus.evalRPN(compiled.rpn, {unknown, f, g, acc})
                           : new ComplexNumber([0, 0n, acc]);
            return [result, compiled.expr];
        }
    }

    /**
     * 单组样本的描述性统计字段。
     *
     * @typedef {object} StatisticsSummary
     * @property {string} average - 算术平均值的格式化字符串。
     * @property {string} sum - 样本和 `Σxᵢ` 的格式化字符串。
     * @property {string} sum2 - 平方和 `Σxᵢ²` 的格式化字符串。
     * @property {string} populationStandardDeviation - 总体标准差 `sqrt(Σ(xᵢ-x̄)²/n)`。
     * @property {string|'error'} sampleStandardDeviation - 样本标准差；样本量为 1 时为 `error`。
     * @property {string} max - 按实数大小比较得到的最大值。
     * @property {string} min - 按实数大小比较得到的最小值。
     */

    /**
     * 单个回归模型的输出结构。
     *
     * @typedef {object} RegressionModelResult
     * @property {Array<string|'error'>} parameter - 按模型表达式顺序排列的参数；
     *   二参数模型为 `[a,b]`，二次模型为 `[a,b,c]`。无法求解的参数逐项使用 `error`。
     * @property {string|'error'} regressionEquation - 可直接交给表达式解析器的回归方程字符串。
     * @property {string|'error'} R2 - 在原始因变量量纲上计算并格式化的决定系数。
     * @property {'linear'|'square'|'ln'|'exp'|'abx'|'axb'|'reciprocal'} model - 模型标识，
     *   与统计结果对象中的属性名一致。
     */

    /**
     * 两组配对样本的完整统计与回归结果。
     *
     * @typedef {object} StatisticsAnalysisResult
     * @property {string} n - 样本对数量的十进制整数字符串。
     * @property {string} averageA - A 组均值。
     * @property {string} sumA - A 组样本和。
     * @property {string} sum2A - A 组平方和。
     * @property {string} populationStandardDeviationA - A 组总体标准差。
     * @property {string|'error'} sampleStandardDeviationA - A 组样本标准差。
     * @property {string} maxA - A 组最大值。
     * @property {string} minA - A 组最小值。
     * @property {string} averageB - B 组均值。
     * @property {string} sumB - B 组样本和。
     * @property {string} sum2B - B 组平方和。
     * @property {string} populationStandardDeviationB - B 组总体标准差。
     * @property {string|'error'} sampleStandardDeviationB - B 组样本标准差。
     * @property {string} maxB - B 组最大值。
     * @property {string} minB - B 组最小值。
     * @property {string} dotAB - 点积 `ΣAᵢBᵢ`。
     * @property {string} dotA2B - 加权点积 `ΣAᵢ²Bᵢ`。
     * @property {string} totalCovariance - 总体协方差。
     * @property {string|'error'} sampleCovariance - 样本协方差；样本量为 1 时为 `error`。
     * @property {string|'error'} r - 皮尔逊相关系数；任一组方差为零时为 `error`。
     * @property {'linear'|'square'|'ln'|'exp'|'abx'|'axb'|'reciprocal'} bestModel - 可计算模型中
     *   R² 最大者；全部模型不可比较时保留 `linear` 作为 UI 缺省选择。
     * @property {RegressionModelResult} linear - 线性模型 `y=a+bx`。
     * @property {RegressionModelResult} square - 二次模型 `y=a+bx+cx²`。
     * @property {RegressionModelResult} ln - 对数模型 `y=a+b ln(x)`。
     * @property {RegressionModelResult} exp - 自然指数模型 `y=a exp(bx)`。
     * @property {RegressionModelResult} abx - 一般指数模型 `y=a b^x`。
     * @property {RegressionModelResult} axb - 幂模型 `y=a x^b`。
     * @property {RegressionModelResult} reciprocal - 反比例模型 `y=a+b/x`。
     */

    /**
     * 提供统计计算和回归分析。
     *
     * @class StatisticsTools
     */
    class StatisticsTools {
        /**
         * 阻止实例化静态工具类。
         *
         * @throws {Error} 始终抛出。
         */
        constructor() {
            throw new Error('[StatisticsTools] StatisticsTools is a static class and should not be instantiated.');
        }

        /**
         * 计算一个数值列表的总和与平均值。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 非空数值样本；每项会转换为新的
         *   `ComplexNumber` 后累加，原数组及其中的实例均不修改。空数组没有可定义的平均值。
         * @returns {{sum:ComplexNumber,average:ComplexNumber}} 两个高精度值：`sum` 为顺序累加的样本和，
         *   `average` 为 `sum / list.length`；两者是独立的新实例，不引用输入元素。
         */
        static _averageAndSum(list) {
            let sum = new ComplexNumber(0);
            for (let i = 0; i < list.length; i++) {
                sum = MathPlus.plus(list[i], sum);
            }
            return {
                sum: sum,
                average: MathPlus.divide(sum, list.length)
            };
        }

        /**
         * 计算列表的总体方差和样本方差。
         * 总体方差为 `Σ(xᵢ-x̄)²/n`，样本方差使用无偏估计 `Σ(xᵢ-x̄)²/(n-1)`。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 非空总体样本；样本方差要求至少两个元素，
         *   否则其返回位置使用 `error`，复数按当前代数平方规则参与离差计算。
         * @param {{sum: ComplexNumber, average: ComplexNumber}|null} [averageAndSum] - 与同一 `list` 对应的
         *   预计算结果；传 `null` 时内部重新计算。调用方必须保证缓存未过期且没有来自另一数据集。
         * @returns {[ComplexNumber, ComplexNumber|'error']} `[populationVariance, sampleVariance]`；
         *   第 0 项分母为 `n`，第 1 项分母为 `n-1`。只有一个样本时总体方差为零、样本方差为 `error`。
         */
        static _variance(list, averageAndSum = null) {
            const n = list.length;
            if (n === 1) {
                return [new ComplexNumber(0), 'error'];
            }
            const average = (averageAndSum === null ? StatisticsTools._averageAndSum(list) : averageAndSum).average;
            let sum = new ComplexNumber(0);
            for (let i = 0; i < n; i++) {
                const mid = MathPlus.minus(list[i], average);
                sum = MathPlus.plus(MathPlus.times(mid, mid), sum);
            }
            return [MathPlus.divide(sum, n), MathPlus.divide(sum, n - 1)];
        }

        /**
         * 计算两个列表的总体协方差和样本协方差。
         * 两者共享离差积和 `Σ(xᵢ-x̄)(yᵢ-ȳ)`，分母分别为 `n` 和 `n-1`。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} listA - 第一维样本；必须与 `listB` 等长且非空。
         * @param {Array<ComplexNumber|string|number>} listB - 第二维样本；相同索引与 `listA` 组成一个观测对。
         * @param {object} [options={}] - 可选的均值缓存，用于避免统计汇总阶段重复遍历数据。
         * @param {ComplexNumber|null} [options.averageA=null] - 与当前 `listA` 完全对应的算术平均值；
         *   `null` 表示内部计算，数值零不是缺省标记。
         * @param {ComplexNumber|null} [options.averageB=null] - 与当前 `listB` 完全对应的算术平均值；
         *   若只提供一个缓存，另一个仍会独立计算。
         * @returns {[ComplexNumber, ComplexNumber|'error']} `[populationCovariance, sampleCovariance]`；
         *   两项共享同一个离差积和，分母分别为 `n` 与 `n-1`。单个观测对的样本项为 `error`。
         */
        static _covariance(listA, listB, {averageA = null, averageB = null} = {}) {
            const n = listA.length;
            if (n === 1) {
                return [new ComplexNumber(0), 'error'];
            }
            averageA = averageA === null ? this._averageAndSum(listA).average : averageA;
            averageB = averageB === null ? this._averageAndSum(listB).average : averageB;
            let cov = new ComplexNumber(0);
            for (let i = 0; i < n; i++) {
                cov = MathPlus.plus(
                    MathPlus.times(
                        MathPlus.minus(listA[i], averageA),
                        MathPlus.minus(listB[i], averageB)
                    ),
                    cov
                );
            }
            return [MathPlus.divide(cov, n), MathPlus.divide(cov, n - 1)];
        }

        /**
         * 计算两个列表的皮尔逊相关系数。
         * 使用 `r = Cov(X,Y) / sqrt(Var(X)Var(Y))`；任一方差为零时结果不可定义。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} listA - 第一组等长配对样本；零方差时相关系数不可定义。
         * @param {Array<ComplexNumber|string|number>} listB - 第二组等长配对样本；元素顺序必须与 `listA` 对齐。
         * @param {object} [options={}] - 可复用的统计量缓存；各数组均采用 `[总体值, 样本值]` 顺序。
         * @param {Array<ComplexNumber|string>|null} [options.varianceA=null] - `listA` 的总体/样本方差；
         *   `null` 时从原始列表计算，缓存中的 `error` 会自然传播。
         * @param {Array<ComplexNumber|string>|null} [options.varianceB=null] - `listB` 的总体/样本方差，
         *   必须与 `varianceA` 使用同一种总体或样本口径。
         * @param {Array<ComplexNumber|string>|null} [options.covariance=null] - 两组数据的总体/样本协方差；
         *   传入缓存可避免第三次离差遍历，但调用方负责保证它与两个列表匹配。
         * @returns {ComplexNumber|string} 相关系数；无法计算时为 `error`。
         */
        static _correlationCoefficient(listA, listB, {
            varianceA = null,
            varianceB = null,
            covariance = null
        } = {}) {
            let result;
            varianceA = varianceA === null ? this._variance(listA) : varianceA;
            varianceB = varianceB === null ? this._variance(listB) : varianceB;
            covariance = covariance === null ? this._covariance(listA, listB) : covariance;
            try {
                result = MathPlus.divide(
                    covariance[0],
                    MathPlus.sqrt(MathPlus.times(varianceA[0], varianceB[0]))
                );
            } catch {
                result = 'error';
            }
            return result;
        }

        /**
         * (内部辅助方法) 计算两个数值向量（列表）的点积（内积）。
         * 点积的计算方式为对应元素相乘后再求和。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} listA - 第一个向量；元素按索引与 `listB` 配对。
         * @param {Array<ComplexNumber|string|number>} listB - 第二个等长向量；本私有方法不补零也不做
         *   长度校验，调用方必须先保证长度一致。
         * @returns {ComplexNumber} 两个向量的点积，以 ComplexNumber 实例形式返回。
         */
        static _dotProduct(listA, listB) {
            let sum = new ComplexNumber(0);
            for (let i = 0; i < listA.length; i++) {
                sum = MathPlus.plus(MathPlus.times(listA[i], listB[i]), sum);
            }
            return sum;
        }

        /**
         * 对一个数值列表中的每个元素应用一个指定的回调函数。
         * 此方法的功能类似于数组的 `map` 方法，但确保结果是 ComplexNumber 实例的数组。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 要遍历的源数组；保持元素顺序且不原地修改。
         * @param {function(ComplexNumber|string|number): ComplexNumber} func - 同步变换函数，对数组中的每个元素使用 func()；
         * @returns {Array<ComplexNumber>} 一个包含变换后结果的新数组，其中每个元素都是 ComplexNumber 实例。
         */
        static _changeInner(list, func) {
            const result = [];
            for (let i = 0; i < list.length; i++) {
                result.push(func(list[i]));
            }
            return result;
        }

        /**
         * 在一个数值列表中查找最大值和最小值。
         * 注意：此方法主要基于数值的实部进行比较。对于复数，其虚部在比较中被忽略。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 需要进行查找的数值数组。
         * @returns {{max:ComplexNumber,min:ComplexNumber}} 按实部比较得到的两个新实例；`max`、`min`
         *   初始都复制首项，实部相等时保留先出现者，虚部不参与大小判断。
         */
        static _getMaxAndMin(list) {
            const result = {};
            result.max = new ComplexNumber(list[0]);
            result.min = new ComplexNumber(list[0]);
            for (let i = 1; i < list.length; i++) {
                const currentI = new ComplexNumber(list[i]);
                if (MathPlus.minus(result.max, currentI).re.isNegative()) {
                    result.max = currentI;
                } else if (MathPlus.minus(currentI, result.min).re.isNegative()) {
                    result.min = currentI;
                }
            }
            return result;
        }

        /**
         * 计算一个数值列表中每个元素的绝对值（模）。
         * 此方法的功能类似于 `list.map((item) => MathPlus.abs(item))`。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 需要计算绝对值的数值数组。
         * @returns {Array<ComplexNumber>} 一个新的数组，其中包含原始列表中每个元素的绝对值。
         */
        static _getAbsList(list) {
            const result = [];
            for (let i = 0; i < list.length; i++) {
                result.push(MathPlus.abs(list[i]));
            }
            return result;
        }

        /**
         * 检查一个数值列表，以确定其中是否包含正数、负数或零值。
         * 此方法仅检查数值的实部来判断其符号。它用于快速了解数据集的符号构成，
         * 例如，在对数回归中，所有自变量都必须为正。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 需要检查的数值数组。
         * @returns {{positive: boolean, zero: boolean, negative: boolean}} 一个对象，
         * 其属性 (`positive`, `zero`, `negative`) 指示是否在列表中找到了相应类型的数值。
         * 如果找到了，对应属性为 `true` ，否则为 `false`。
         */
        static _getListInfo(list) {
            const result = {
                positive: false,
                zero: false,
                negative: false
            };

            for (let i = 0; i < list.length; i++) {
                const currentCheck = new ComplexNumber(list[i]);
                if (currentCheck.re.isPositive()) {
                    result.positive = true;
                } else if (currentCheck.re.isZero()) {
                    result.zero = true;
                } else {
                    result.negative = true;
                }
            }
            return result;
        }

        /**
         * 使用 Householder QR 分解求解指定阶数的实数最小二乘多项式。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} listA - 自变量样本 `xᵢ`；与 `listB` 等长，
         *   仅接受实数，至少需要 `power + 1` 个观测点才能建立满列秩设计矩阵。
         * @param {Array<ComplexNumber|string|number>} listB - 与 `xᵢ` 同索引的实数因变量样本 `yᵢ`。
         * @param {number} power - 非负整数多项式阶数；结果包含 `power + 1` 个从常数项到最高次项的系数。
         * @returns {Array<ComplexNumber>} 长度为 `power + 1` 的最小二乘系数 `[a₀,a₁,…]`，
         *   按常数项到最高次项排列，使预测式为 `a₀ + a₁x + …`。
         * @throws {Error} 数据不足、长度不一致、包含复数或设计矩阵不满列秩时抛出。
         */
        static _regressionAnalysis(listA, listB, power) {
            if (listA.length <= power) {
                throw new Error('[StatisticsTools] Insufficient number of parameters.');
            }
            if (listA.length !== listB.length) {
                throw new Error('[StatisticsTools] Data mismatch.');
            }

            const n = listA.length;
            const m = power + 1;
            const matrix = [];
            const columnScales = Array.from({length: m}, () => new BigNumber(0));
            const {realPlus: plus, realMinus: minus, realTimes: times, realDivide: divide} = MathPlus;

            // 递推构造 [1, x, …, x^power | y] 副本，直接分解设计矩阵，避免条件数平方。
            for (let i = 0; i < n; i++) {
                const x = new ComplexNumber(listA[i]);
                const y = new ComplexNumber(listB[i]);
                if (!x.onlyReal || !y.onlyReal) {
                    throw new Error('[StatisticsTools] Complex number appear in the input.');
                }
                const row = [new BigNumber(1)];
                for (let j = 1; j < m; j++) {
                    row.push(times(row[j - 1], x.re));
                }
                for (let j = 0; j < m; j++) {
                    const abs = row[j].isNegative() ? MathPlus.oppositeNumber(row[j]) : row[j];
                    if (minus(abs, columnScales[j]).isPositive()) {
                        columnScales[j] = abs;
                    }
                }
                row.push(y.re);
                matrix.push(row);
            }

            for (let k = 0; k < m; k++) {
                let normSquared = new BigNumber(0);
                for (let i = k; i < n; i++) {
                    normSquared = plus(normSquared, times(matrix[i][k], matrix[i][k]));
                }
                const norm = MathPlus.sqrt(normSquared).re;
                // 各列使用自身原始尺度判秩，避免不同次幂的量级差误判小列为零。
                if (norm.isZero() || Public.zeroCorrect(norm, columnScales[k]).isZero()) {
                    throw new Error('[StatisticsTools] The system of equations has no unique solution.');
                }

                // 对角元取与列首相反的符号，避免构造反射向量时发生相消；向量首项归一为 1。
                const first = matrix[k][k];
                const diagonal = first.isNegative() ? norm : MathPlus.oppositeNumber(norm);
                const head = minus(first, diagonal);
                const reflector = [new BigNumber(1)];
                for (let i = k + 1; i < n; i++) {
                    reflector.push(divide(matrix[i][k], head));
                }
                const tau = divide(minus(diagonal, first), diagonal);

                // 同时对剩余设计列和 y 应用 H = I - tau*v*v^T，无需显式构造 Q。
                for (let j = k + 1; j <= m; j++) {
                    let projection = matrix[k][j];
                    for (let i = k + 1; i < n; i++) {
                        projection = plus(projection, times(reflector[i - k], matrix[i][j]));
                    }
                    const factor = times(tau, projection);
                    matrix[k][j] = minus(matrix[k][j], factor);
                    for (let i = k + 1; i < n; i++) {
                        matrix[i][j] = minus(matrix[i][j], times(reflector[i - k], factor));
                    }
                }
                matrix[k][k] = diagonal;
                for (let i = k + 1; i < n; i++) {
                    matrix[i][k] = new BigNumber(0);
                }
            }

            // 对 R*a = Q^T*y 的前 m 行回代，保持系数按升幂排列。
            const solution = new Array(m);
            for (let i = m - 1; i >= 0; i--) {
                let value = matrix[i][m];
                for (let j = i + 1; j < m; j++) {
                    value = minus(value, times(matrix[i][j], solution[j].re));
                }
                solution[i] = new ComplexNumber(divide(value, matrix[i][i]));
            }
            return solution;
        }

        /**
         * 按 `1 - SS_res / SS_tot` 计算回归模型的决定系数 R²。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} listA - 传入预测函数的自变量样本。
         * @param {Array<ComplexNumber|string|number>} listB - 与 `listA` 等长的真实观测值，用于计算残差平方和。
         * @param {function(ComplexNumber|string|number): ComplexNumber} func - 同步预测函数；对每个 `xᵢ`
         *   返回对应 `ŷᵢ`。常量数据导致 `SS_tot = 0` 时，R² 不可定义。
         * @param {ComplexNumber|string|number|null} [ssTot=null] - 可复用的原始因变量总平方和；`null` 时重新计算。
         * @returns {ComplexNumber} 决定系数。
         */
        static _calcR2(listA, listB, func, ssTot = null) {
            const n = listA.length;
            let noSsTot = ssTot === null;
            let denominator = noSsTot ? new ComplexNumber(0) : ssTot;
            let numerator = new ComplexNumber(0);
            let averageB;

            if (noSsTot) {
                averageB = StatisticsTools._averageAndSum(listB).average;
            }

            for (let i = 0; i < n; i++) {
                if (noSsTot) {
                    const addDenominator = MathPlus.minus(listB[i], averageB);
                    denominator = MathPlus.plus(
                        denominator,
                        MathPlus.times(addDenominator, addDenominator)
                    );
                }

                const addNumerator = MathPlus.minus(listB[i], func(listA[i]));
                numerator = MathPlus.plus(
                    numerator,
                    MathPlus.times(addNumerator, addNumerator)
                );
            }

            return MathPlus.minus(1, MathPlus.divide(numerator, denominator));
        }

        /**
         * 汇总列表的均值、总和、平方和、标准差及极值。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 要汇总的非空样本；返回结果中的极值按实部比较。
         * @param {object} [options={}] - 已计算的统计中间结果。
         * @param {{sum: ComplexNumber, average: ComplexNumber}|null} [options.averageAndSum=null] - 同一列表的总和与均值；
         *   `null` 时重新计算。
         * @param {[ComplexNumber, ComplexNumber|'error']|null} [options.varianceList=null] - 同一列表的
         *   `[总体方差, 样本方差]`，样本方差不可用时为 `error`；`null` 时基于均值计算。
         * @returns {{statisticsResult: StatisticsSummary, squareList: Array<ComplexNumber>}} 中间汇总结果：
         *   `statisticsResult` 是已格式化的单组描述性统计；`squareList` 与输入等长，第 `i` 项为
         *   `list[i]²` 的高精度值，供 `dotA2B` 复用而无需再次平方。
         */
        static _getStatisticsInfo(list, {averageAndSum = null, varianceList = null} = {}) {
            /** @type {StatisticsSummary} */
            const statisticsResult = {};

            averageAndSum = averageAndSum === null ? StatisticsTools._averageAndSum(list) : averageAndSum;
            statisticsResult.average = Public.idealizationToString(averageAndSum.average);
            statisticsResult.sum = Public.idealizationToString(averageAndSum.sum);

            const list2 = StatisticsTools._changeInner(list, (x) => MathPlus.times(x, x));

            statisticsResult.sum2 = Public.idealizationToString(StatisticsTools._averageAndSum(list2).sum);

            const variance = varianceList === null ? StatisticsTools._variance(list, averageAndSum) : varianceList;
            statisticsResult.populationStandardDeviation = Public.idealizationToString(MathPlus.sqrt(variance[0]));
            statisticsResult.sampleStandardDeviation = Public.idealizationToString(variance[1] === 'error' ? 'error' : MathPlus.sqrt(variance[1]));

            const maxAndMin = StatisticsTools._getMaxAndMin(list);
            statisticsResult.max = Public.idealizationToString(maxAndMin.max);
            statisticsResult.min = Public.idealizationToString(maxAndMin.min);

            return {
                statisticsResult: statisticsResult,
                squareList: list2
            };
        }

        /**
         * 求解指定回归模型的参数和决定系数；失败项以 `error` 表示。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} listA - 送入回归求解器的自变量；可为原值或模型要求的变换值。
         * @param {Array<ComplexNumber|string|number>} listB - 送入最小二乘求解器的因变量；对数/指数模型中可能已变换。
         * @param {number} power - 传给多项式回归的非负整数阶数，也决定失败时生成的参数占位数。
         * @param {Array<ComplexNumber|string|number>} originalListB - 未变换的实际因变量；仅用于在原始量纲上计算 R²。
         * @param {function(ComplexNumber|string|number, Array<ComplexNumber|string|number>): ComplexNumber} func -
         *   模型预测函数，参数依次为原始 `x` 和已求得的系数数组；返回值用于和 `originalListB` 比较。
         * @param {ComplexNumber|string|number|null} [ssTot=null] - 可复用的原始因变量总平方和；`null` 时重新计算。
         * @returns {{parameter: Array<ComplexNumber|'error'>, R2: ComplexNumber|'error'}} 尚未格式化的回归结果；
         *   `parameter` 含 `power + 1` 个按升幂排列的系数，求解失败时为等长 `error` 数组；`R2`
         *   使用 `originalListB` 独立计算，因而参数可求而 R² 仍可能为 `error`，反之不会发生。
         */
        static _getRegressionInfo(listA, listB, power, originalListB, func, ssTot = null) {
            const result = {};

            try {
                result.parameter = StatisticsTools._regressionAnalysis(listA, listB, power);
            } catch {
                /** 为每个回归参数生成错误占位值。 */
                result.parameter = Array.from({length: power + 1}, () => 'error');
                result.R2 = 'error';
                return result;
            }

            try {
                // R² 使用未变换的原始 y 值，并复用外部预计算的 SS_tot。
                result.R2 = Public.zeroCorrect(StatisticsTools._calcR2(
                    listA,
                    originalListB,
                    // 使用已求得的参数计算预测值，并在比较模型前应用输出时的噪声校正。
                    (x) => func(x, result.parameter),
                    ssTot
                ));
            } catch {
                result.R2 = 'error';
            }

            return result;
        }

        /**
         * 在平移和缩放后的坐标中拟合二次曲线并计算 R²，最后将系数换回原坐标。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} listA - 非空自变量样本；以首项为原点，以最大绝对偏移为尺度。
         * @param {Array<ComplexNumber|string|number>} listB - 与自变量逐项对应的原始因变量。
         * @param {ComplexNumber|null} ssTot - 因变量的总平方和；`null` 时按原始因变量计算。
         * @returns {{parameter:Array<ComplexNumber|'error'>,R2:ComplexNumber|'error'}} 原坐标下按常数项、一次项、
         *   二次项排列的系数及决定系数；拟合失败时保留 `_getRegressionInfo` 生成的错误占位。
         */
        static _getQuadraticRegressionInfo(listA, listB, ssTot) {
            const origin = listA[0];
            const offsets = this._changeInner(listA, (x) => MathPlus.minus(x, origin));
            const {max: scale} = this._getMaxAndMin(this._getAbsList(offsets));
            const scaledA = scale.isZero()
                            ? offsets
                            : this._changeInner(offsets, (x) => MathPlus.divide(x, scale));
            const result = this._getRegressionInfo(scaledA, listB, 2, listB,
                (t, [a, b, c]) => MathPlus.plus(a, MathPlus.times(t, MathPlus.plus(b, MathPlus.times(t, c)))),
                ssTot
            );
            if (result.parameter[0] === 'error') {
                return result;
            }

            // 将 t = x / scale - origin / scale 代入。换算前清理拟合产生的系数底噪。
            const [a, b, c] = result.parameter.map((value) => Public.zeroCorrect(value));
            const shift = MathPlus.divide(MathPlus.minus(0, origin), scale);
            const cross = MathPlus.times(c, shift);
            const quadratic = MathPlus.divide(c, scale);
            result.parameter = [
                MathPlus.plus(a, MathPlus.times(shift, MathPlus.plus(b, cross))),
                MathPlus.divide(MathPlus.plus(b, MathPlus.times(2, cross)), scale),
                MathPlus.divide(quadratic, scale)
            ];
            return result;
        }

        /**
         * (内部辅助方法) 比较当前回归模型与已知的最佳模型，并根据决定系数 (R²) 确定新的最佳模型。
         * R² 值越高，表示模型的拟合优度越好。
         *
         * @private
         * @param {{bestModel:string,[model:string]:{R2:ComplexNumber|'error'}|string}} result - 正在构建的
         *   统计结果；`bestModel` 指向当前胜者，模型同名属性必须含尚未格式化的 `R2` 或 `error`。
         *   方法只读取该对象，不直接写回 `bestModel`。
         * @param {'linear'|'square'|'ln'|'exp'|'abx'|'axb'|'reciprocal'} current - 刚完成计算、准备与
         *   `result.bestModel` 比较的模型键。
         * @returns {'linear'|'square'|'ln'|'exp'|'abx'|'axb'|'reciprocal'} R² 更大的可用模型键；当前模型
         *   为 `error` 或未严格胜出时返回原 `bestModel`，相等时保持先前模型。
         */
        static _findBestModel(result, current) {
            const bestBefore = result.bestModel;
            if (result[current].R2 !== 'error') {
                if (result[bestBefore].R2 === 'error') {
                    return current;
                }
                if (MathPlus.minus(result[bestBefore].R2, result[current].R2).re.isNegative()) {
                    return current;
                }
            }
            return bestBefore;
        }

        /**
         * 计算两组数据的统计指标，并比较多种回归模型的拟合度。
         *
         * @param {Array<ComplexNumber|string|number>} listA - 自变量样本；必须非空、只含实数并与 `listB`
         *   等长。零值或负值会使部分对数/幂回归模型不可用，但不一定使全部统计失败。
         * @param {Array<ComplexNumber|string|number>} listB - 因变量样本；必须非空且只含实数，元素按索引
         *   与 `listA` 配对。样本数不足时高阶模型以 `error` 占位。
         * @returns {StatisticsAnalysisResult} 完整统计结果。所有直接数值字段均已转换为显示字符串；
         *   模型不满足定义域、样本不足或设计矩阵不满列秩时，不删除模型字段，而是在对应
         *   `parameter`、`regressionEquation`、`R2` 中保留 `error`，便于 UI 使用固定结构渲染。
         * @throws {Error} 数据长度不一致、包含复数或不足以拟合时抛出。
         */
        static statisticsCalc(listA, listB) {
            if (listA.length !== listB.length) {
                throw new Error('[StatisticsTools] Data mismatch.');
            }
            if (listA.length === 0) {
                throw new Error('[StatisticsTools] Input data cannot be empty.');
            }

            // 不污染传入的原始数组
            listA = [...listA];
            listB = [...listB];

            for (let i = 0; i < listA.length; i++) {
                if (typeof listA[i] === 'string') {
                    listA[i] = MathPlus.calc(listA[i])[0];
                }
                if (typeof listB[i] === 'string') {
                    listB[i] = MathPlus.calc(listB[i])[0];
                }
            }
            for (let i = 0; i < listA.length; i++) {
                listA[i] = Public.zeroCorrect(listA[i]);
                listB[i] = Public.zeroCorrect(listB[i]);

                if (!listA[i].onlyReal) {
                    throw new Error('[StatisticsTools] Complex number appear in the inputA.');
                }
                if (!listB[i].onlyReal) {
                    throw new Error('[StatisticsTools] Complex number appear in the inputB.');
                }
            }

            const result = {};
            result.n = listA.length.toString();
            const averageAndSumA = this._averageAndSum(listA);
            const averageAndSumB = this._averageAndSum(listB);
            const varianceA = this._variance(listA, averageAndSumA);
            const varianceB = this._variance(listB, averageAndSumB);

            const statisticsInfoA = this._getStatisticsInfo(listA, {
                averageAndSum: averageAndSumA,
                varianceList: varianceA
            });
            const statisticsInfoB = this._getStatisticsInfo(listB, {
                averageAndSum: averageAndSumB,
                varianceList: varianceB
            });
            for (const key in statisticsInfoA.statisticsResult) {
                result[key + 'A'] = statisticsInfoA.statisticsResult[key];
                result[key + 'B'] = statisticsInfoB.statisticsResult[key];
            }
            const covariance = this._covariance(listA, listB, {
                averageA: averageAndSumA.average,
                averageB: averageAndSumB.average
            });
            const correlationCoefficient = this._correlationCoefficient(listA, listB, {
                varianceA: varianceA,
                varianceB: varianceB,
                covariance: covariance
            });

            result.dotAB = Public.idealizationToString(this._dotProduct(listA, listB));
            result.dotA2B = Public.idealizationToString(this._dotProduct(statisticsInfoA.squareList, listB));
            result.totalCovariance = Public.idealizationToString(covariance[0]);
            result.sampleCovariance = Public.idealizationToString(covariance[1]);
            result.r = Public.idealizationToString(correlationCoefficient);

            result.bestModel = 'linear';
            // 各回归模型有不同定义域；先记录两组数据是否包含正数、负数和零。
            const statesA = this._getListInfo(listA);
            const statesB = this._getListInfo(listB);
            const absListB = this._getAbsList(listB);
            let lnListA;
            if (!statesA.zero && !statesA.negative) {
                lnListA = this._changeInner(listA, (x) => MathPlus.ln(x));
            }
            let lnListB;
            if (!statesB.zero && !(statesB.positive && statesB.negative)) {
                lnListB = this._changeInner(absListB, (x) => MathPlus.ln(x));
            }
            const errorWith2parameter = {
                parameter: ['error', 'error'],
                regressionEquation: 'error',
                R2: 'error'
            };

            const twoParamModels = ['linear', 'ln', 'axb', 'exp', 'abx', 'reciprocal'];
            if ((!statesA.positive && !statesA.negative && statesA.zero) || listA.length === 1) {
                twoParamModels.forEach((key) => {
                    result[key] = {
                        parameter: ['error', 'error'],
                        regressionEquation: 'error',
                        R2: 'error',
                        model: key
                    };
                });

                result.square = {
                    parameter: ['error', 'error', 'error'],
                    regressionEquation: 'error',
                    R2: 'error',
                    model: 'square'
                };

                return result;
            }

            // 计算 ssTotB
            let ssTotB = new ComplexNumber(0);
            for (let i = 0; i < listB.length; i++) {
                const diff = MathPlus.minus(listB[i], averageAndSumB.average);
                ssTotB = MathPlus.plus(ssTotB, MathPlus.times(diff, diff));
            }

            result.linear = this._getRegressionInfo(listA, listB, 1, listB,
                (x, coefficient) => MathPlus.plus(MathPlus.times(coefficient[1], x), coefficient[0]),
                ssTotB
            );

            result.square = this._getQuadraticRegressionInfo(listA, listB, ssTotB);
            result.bestModel = this._findBestModel(result, 'square');

            // 对数模型 y=a+b·ln(x) 要求所有 x>0。
            if (statesA.negative || statesA.zero) {
                result.ln = structuredClone(errorWith2parameter);
            } else {
                result.ln = this._getRegressionInfo(lnListA, listB, 1, listB,
                    (x, coefficient) => MathPlus.plus(MathPlus.times(coefficient[1], x), coefficient[0]),
                    ssTotB
                );
            }
            result.bestModel = this._findBestModel(result, 'ln');

            // 幂模型 y=a·x^b 线性化为 ln|y|=ln|a|+b·ln(x)，要求 x>0 且 y 非零同号。
            if (statesA.negative || statesA.zero || statesB.zero || (statesB.positive && statesB.negative)) {
                result.axb = structuredClone(errorWith2parameter);
            } else {
                result.axb = this._getRegressionInfo(lnListA, lnListB, 1, listB,
                    (x, coefficient) => {
                        const mid = MathPlus.exp(MathPlus.plus(MathPlus.times(coefficient[1], x), coefficient[0]));
                        return statesB.negative ? MathPlus.minus(0, mid) : mid;
                    },
                    ssTotB
                );
                try {
                    const p0 = result.axb.parameter[0];
                    if (p0 !== 'error') {
                        const mid = MathPlus.exp(p0);
                        result.axb.parameter[0] = statesB.negative ? MathPlus.minus(0, mid) : mid;
                    }
                } catch {
                    result.axb = structuredClone(errorWith2parameter);
                }
            }
            result.bestModel = this._findBestModel(result, 'axb');

            // 指数模型 y=a·e^(bx) 同样在 ln|y| 空间拟合，要求 y 非零同号。
            if (statesB.zero || (statesB.positive && statesB.negative)) {
                result.exp = structuredClone(errorWith2parameter);
                result.abx = structuredClone(errorWith2parameter);
            } else {
                result.exp = this._getRegressionInfo(listA, lnListB, 1, listB,
                    (x, coefficient) => {
                        const mid = MathPlus.exp(MathPlus.plus(
                            MathPlus.times(coefficient[1], x),
                            coefficient[0]
                        ));
                        return statesB.negative ? MathPlus.minus(0, mid) : mid;
                    },
                    ssTotB
                );
                const p0 = result.exp.parameter[0];
                const p1 = result.exp.parameter[1];
                try {
                    if (p0 !== 'error') {
                        const midExp = MathPlus.exp(p0);
                        result.exp.parameter[0] = statesB.negative ? MathPlus.minus(0, midExp) : midExp;
                    }
                } catch {
                    result.exp = structuredClone(errorWith2parameter);
                }

                if (result.exp.parameter[0] === 'error' || p1 === 'error') {
                    result.abx = structuredClone(errorWith2parameter);
                } else {
                    try {
                        const midABX = MathPlus.exp(p1);
                        result.abx = {
                            parameter: [result.exp.parameter[0], midABX],
                            R2: result.exp.R2
                        };
                    } catch {
                        result.abx = structuredClone(errorWith2parameter);
                    }
                }
            }
            result.bestModel = this._findBestModel(result, 'exp');
            result.bestModel = this._findBestModel(result, 'abx');

            // 倒数模型 y=a+b/x 通过把自变量替换为 1/x 转成线性回归，故 x 不能为零。
            if (statesA.zero) {
                result.reciprocal = structuredClone(errorWith2parameter);
            } else {
                const reciprocalListA = this._changeInner(listA, (x) => MathPlus.divide(1, x));
                result.reciprocal = this._getRegressionInfo(reciprocalListA, listB, 1, listB,
                    (x, coefficient) => MathPlus.plus(MathPlus.times(coefficient[1], x), coefficient[0]),
                    ssTotB
                );
            }
            result.bestModel = this._findBestModel(result, 'reciprocal');

            for (let key in result) {
                if (Public.typeOf(result[key]) === 'object') {
                    result[key].regressionEquation = Public.funcToString(
                        result[key].parameter,
                        ['linear', 'square'].includes(key) ? 'powerFunc' : `${key}Func`
                    );
                    result[key].R2 = Public.idealizationToString(result[key].R2);
                    result[key].parameter = Public.idealizationToString(result[key].parameter);
                    result[key].model = key;
                }
            }
            return result;
        }
    }

    /**
     * 多项式区间与特征点分析结果。
     *
     * @typedef {object} PowerFunctionAnalysisResult
     * @property {string} equation - 按降幂规范化的多项式表达式。
     * @property {[string, string]} range - 值域左右边界；无穷使用 `-inf`/`+inf`。
     * @property {Array<[string, string]>} increasingInterval - 单调递增区间；
     *   不存在时为 `[['null','null']]`，无穷端点使用专用字符串。
     * @property {Array<[string, string]>} decreasingInterval - 与上项采用相同编码的单调递减区间。
     * @property {Array<[string, string]>} maximumPoint - 极大值点 `[x,y]` 列表；不存在时使用空点哨兵。
     * @property {Array<[string, string]>} minimumPoint - 极小值点 `[x,y]` 列表；不存在时使用空点哨兵。
     * @property {Array<[string, string]>} convexInterval - 凸区间列表；端点编码与单调区间一致。
     * @property {Array<[string, string]>} concaveInterval - 凹区间列表；端点编码与单调区间一致。
     * @property {Array<[string, string]>} inflectionPoint - 拐点 `[x,y]` 列表；不存在时使用空点哨兵。
     * @property {Array<string>} roots - 已格式化实根/复根列表；无根为 `['null']`，
     *   恒等于零为 `['anyRealNumber']`。返回数量不超过实际多项式次数。
     */

    /**
     * 分析最高四次的实系数多项式。
     *
     * @class PowerFunctionTools
     */
    class PowerFunctionTools {
        /**
         * 阻止实例化静态工具类。
         *
         * @throws {Error} 始终抛出。
         */
        constructor() {
            throw new Error('[PowerFunctionTools] PowerFunctionTools is a static class and should not be instantiated.');
        }

        /**
         * 对一个包含数值（或可转换为数值的对象）的数组进行原地升序排序。
         * 注意：此排序主要基于数值的实部进行比较。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 按元素实部升序排列的数组；此方法直接调用
         *   `Array#sort` 修改并返回同一个数组引用，复数虚部不参与次序比较。
         * @returns {Array<ComplexNumber|string|number>} 与 `list` 相同的数组引用；元素已按实部从小到大
         *   重排，实部相等的项由 JavaScript 稳定排序保留原相对次序。
         */
        static _sort(list) {
            list.sort((a, b) => {
                const diff = MathPlus.minus(a, b).re.mantissa;
                if (diff > 0n) {
                    return 1;
                }
                if (diff < 0n) {
                    return -1;
                }
                return 0;
            });
            return list;
        }

        /**
         * 使用霍纳法计算多项式在 x 处的值。
         *
         * @private
         * @param {Array<string|number|bigint|BigNumber|ComplexNumber|Array>} list - 非空、按最高次项到常数项
         *   排列的系数；允许零系数且不要求先去除前导零，方法不会改变该数组。
         * @param {string|number|bigint|BigNumber|ComplexNumber} x - 代入多项式的实数或复数自变量；
         *   霍纳迭代沿用其高精度表示，避免显式构造各次幂。
         * @returns {ComplexNumber} 多项式值。
         */
        static _getPowerFunctionValue(list, x) {
            // 霍纳法把 a_nx^n+...+a_0 改写为 (...(a_nx+a_(n-1))x+...)x+a_0。
            let result = new ComplexNumber(list[0]);
            const input = new ComplexNumber(x);

            for (let i = 1; i < list.length; i++) {
                result = MathPlus.plus(
                    MathPlus.times(result, input),
                    list[i]
                );
            }
            return result;
        }

        /**
         * 按幂法则计算多项式导数。
         *
         * @private
         * @param {Array<string|number|bigint|BigNumber|ComplexNumber|Array>} list - 按降幂排列的 `n + 1`
         *   个系数；常数多项式返回空导数系数数组，原数组不会被修改。
         * @returns {Array<ComplexNumber>} 仍按降幂排列的导数系数；若输入表示 n 次多项式，返回 n 项，
         *   第 `i` 项为原系数乘以对应幂次。常数项被移除。
         */
        static _differentiate(list) {
            const result = [];
            const len = list.length;
            for (let i = 0; i < len - 1; i++) {
                result.push(MathPlus.times(list[i], len - i - 1));
            }
            return result;
        }

        /**
         * 求解一次方程 ax + b = 0。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 严格按 `[a, b]` 传入 `ax + b = 0` 的系数；
         *   调用方应先消除前导零，`a = 0` 不属于一次方程。
         * @returns {[ComplexNumber]} 仅含 `-b/a` 的单元素数组；使用数组是为了与二、三、四次求根器保持统一调用协议。
         */
        static _solveLinear(list) {
            const a = list[0], b = list[1];

            const root = MathPlus.divide(MathPlus.minus(0, b), a);
            return [root];
        }

        /**
         * 使用求根公式求解二次方程。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 严格按降幂 `[a, b, c]` 传入的系数；
         *   `a` 应非零。返回根会去除精度噪声，共轭复根的标记约定供上层分析使用。
         * @returns {Array<ComplexNumber|null>} 判别式为零时返回一个去重实根；大于零时返回两个按实部升序的实根；
         *    小于零时返回两个共轭复根并在末尾附加 `null`，供只分析实轴的上层识别。
         */
        static _solveQuadratic(list) {
            const
                a = list[0],
                b = list[1],
                c = list[2];

            const b2 = MathPlus.times(b, b);
            const fourAC = MathPlus.times(MathPlus.times(a, c), 4);
            const delta = Public.zeroCorrect(MathPlus.minus(b2, fourAC), b2, fourAC).re;
            // Δ=b²-4ac 的符号分别对应重实根、两个实根或一对共轭复根。
            const deltaSign = delta.mantissa;

            const mid1 = MathPlus.divide(
                b,
                MathPlus.times(-2, a)
            );
            const mid2 = MathPlus.divide(
                MathPlus.sqrt(delta),
                MathPlus.times(2, a)
            );

            if (deltaSign === 0n) {
                return [mid1];
            }

            if (deltaSign > 0n) {
                // 先同号相加得到绝对值较大的根，再按根的乘积 c/a 求另一个根。
                const largeRoot = mid1.re.isNegative() === mid2.re.isNegative()
                                  ? MathPlus.plus(mid1, mid2)
                                  : MathPlus.minus(mid1, mid2);
                const smallRoot = MathPlus.divide(c, MathPlus.times(a, largeRoot));
                return PowerFunctionTools._sort([largeRoot, smallRoot]);
            }

            // 末尾的 null 标记一对共轭复根。
            return [
                MathPlus.plus(mid1, mid2),
                MathPlus.minus(mid1, mid2),
                null
            ];
        }

        /**
         * 使用盛金公式求解三次方程。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 严格按降幂 `[a, b, c, d]` 传入的系数；
         *   首项 `a` 应非零。重根会按内部近零判定合并，输入数组不被改写。
         * @returns {Array<ComplexNumber|null>} 按精度判定去重后的根：三个互异实根按实部排序；
         *   一个单根与一个二重根时按 `[单根, 二重根]` 返回；一实根加一对共轭复根时返回三个根
         *   并追加 `null` 哨兵。上层只取次数范围内的真实根项。
         */
        static _solveCubic(list) {
            const
                a = list[0],
                b = list[1],
                c = list[2],
                d = list[3];

            const b2 = MathPlus.times(b, b);
            const threeAC = MathPlus.times(MathPlus.times(a, c), 3);
            const A = Public.zeroCorrect(MathPlus.minus(b2, threeAC), b2, threeAC).re;

            const bc = MathPlus.times(b, c);
            const nineAD = MathPlus.times(MathPlus.times(a, d), 9);
            const B = Public.zeroCorrect(MathPlus.minus(bc, nineAD), bc, nineAD).re;

            const c2 = MathPlus.times(c, c);
            const threeBD = MathPlus.times(MathPlus.times(b, d), 3);
            const C = Public.zeroCorrect(MathPlus.minus(c2, threeBD), c2, threeBD).re;

            const B2 = MathPlus.times(B, B);
            const fourAC = MathPlus.times(MathPlus.times(A, C), 4);
            const delta = Public.zeroCorrect(MathPlus.minus(B2, fourAC), B2, fourAC).re;

            // 盛金公式以 A=b²-3ac、B=bc-9ad、C=c²-3bd 和 Δ=B²-4AC 分类根的性质。
            if (A.isZero() && B.isZero()) {
                return [MathPlus.divide(
                    b,
                    MathPlus.times(a, -3)
                )];
            }

            if (delta.isPositive()) {
                // Δ>0：一个实根与一对共轭复根。
                const mid1 = MathPlus.times(a, '1.5');
                const mid2 = MathPlus.minus(
                    MathPlus.times(A, b),
                    MathPlus.times(mid1, B)
                );
                const mid3 = MathPlus.times(mid1, MathPlus.sqrt(delta));
                const w1 = MathPlus.cbrt(MathPlus.plus(mid2, mid3));
                const w2 = MathPlus.cbrt(MathPlus.minus(mid2, mid3));

                const re = MathPlus.divide(
                    MathPlus.minus(MathPlus.divide(MathPlus.plus(w1, w2), 2), b),
                    MathPlus.times(a, 3)
                ).re;
                const im = MathPlus.divide(
                    MathPlus.times(MathPlus.minus(w1, w2), MathPlus.sqrt(3)),
                    MathPlus.times(a, 6)
                ).re;

                return [
                    MathPlus.divide(
                        MathPlus.minus(0, MathPlus.plus(MathPlus.plus(w1, w2), b)),
                        MathPlus.times(a, 3)
                    ),
                    new ComplexNumber([re, im]),
                    new ComplexNumber([re, MathPlus.minus(0, im).re]),
                    null
                ];
            }

            if (delta.isZero()) {
                // Δ=0 且 A、B 不同时为零：root1 为单根、root2 为二重根；上层依赖单根位于索引 0。
                const k = MathPlus.divide(B, A);
                const root1 = MathPlus.minus(k, MathPlus.divide(b, a));
                const root2 = MathPlus.divide(k, -2);

                return [root1, root2];
            }

            const absA = MathPlus.abs(A);
            // Δ<0 为不可约情形，使用三角形式得到三个互异实根。
            const T = MathPlus.divide(
                MathPlus.minus(
                    MathPlus.times(MathPlus.times(absA, b), 2),
                    MathPlus.times(MathPlus.times(a, B), 3)
                ),
                MathPlus.times(MathPlus.pow(absA, '1.5'), 2)
            );
            let ct;
            // 将 T 钳制到 arccos 的定义域，吸收浮点误差。
            if (!MathPlus.plus(MathPlus.abs(T), -1).re.isPositive()) {
                ct = MathPlus.divide(MathPlus.arccos(T), 3);
            } else {
                ct = MathPlus.divide(MathPlus.arccos(T.re.isPositive() ? 1 : -1), 3);
            }
            const cosCT = MathPlus.cos(ct);
            const sinCT = MathPlus.sin(ct);
            const mid1 = MathPlus.divide(
                MathPlus.minus(
                    MathPlus.times(MathPlus.sqrt(absA), cosCT),
                    b
                ),
                MathPlus.times(a, 3)
            );
            const mid2 = MathPlus.divide(
                MathPlus.times(
                    MathPlus.sqrt(MathPlus.times(absA, 3)),
                    sinCT
                ),
                MathPlus.times(a, 3)
            );
            const root1 = MathPlus.plus(mid1, mid2);
            const root2 = MathPlus.minus(mid1, mid2);
            const root3 = MathPlus.divide(
                MathPlus.plus(
                    b,
                    MathPlus.times(cosCT, MathPlus.times(2, MathPlus.sqrt(absA)))
                ),
                MathPlus.times(a, -3)
            );
            return PowerFunctionTools._sort([root1, root2, root3]);
        }

        /**
         * 使用天珩公式解析求解四次方程 ax⁴ + bx³ + cx² + dx + e = 0。
         * 该方法通过引入一个预解三次方程来降次，能够处理所有情况，包括四个实数根、两对共轭复数根、一对共轭复数根和两个实数根，以及各种重根的情况。
         *
         * @private
         * @param {Array<ComplexNumber|string|number>} list - 严格按降幂 `[a, b, c, d, e]` 传入的四次
         *   方程系数；`a` 必须非零，每项均需可转换为 `ComplexNumber`。方法返回解析根但不修改系数数组。
         * @returns {Array<ComplexNumber>} 解析根数组；重根会合并去重（存在重根时返回少于 4 个根，
         *   无重根时返回 4 个根）；元素顺序来自天珩公式的符号组合，不承诺按实部或虚部排序。
         */
        static _solveQuartic(list) {
            // 仅对舍入后为负的被开方数执行判零，保留接近零的正值。
            const correctNonnegative = (value, ...refs) =>
                value.re.isNegative() ? Public.zeroCorrect(value, ...refs) : value;

            const
                a = list[0],
                b = list[1],
                c = list[2],
                d = list[3],
                e = list[4];

            const termD1 = MathPlus.times(MathPlus.times(b, b), 3);
            const termD2 = MathPlus.times(MathPlus.times(a, c), 8);
            const D = Public.zeroCorrect(MathPlus.minus(termD1, termD2), termD1, termD2).re;

            const termE1 = MathPlus.times(MathPlus.times(MathPlus.times(a, b), c), 4);
            const termE2 = MathPlus.times(MathPlus.times(MathPlus.times(a, a), d), 8);
            const termE12 = MathPlus.minus(termE1, termE2);
            const termE3 = MathPlus.times(MathPlus.times(b, b), b);
            const E = Public.zeroCorrect(MathPlus.minus(termE12, termE3), termE1, termE2, termE3).re;

            const f1 = MathPlus.plus(
                MathPlus.times(
                    MathPlus.pow(MathPlus.times(b, b), 2),
                    3
                ),
                MathPlus.times(
                    MathPlus.pow(MathPlus.times(a, c), 2),
                    16
                )
            );
            const f2 = MathPlus.times(MathPlus.minus(
                MathPlus.times(
                    MathPlus.times(a, a),
                    MathPlus.times(b, d)
                ),
                MathPlus.times(
                    MathPlus.times(b, b),
                    MathPlus.times(a, c)
                )
            ), 16);
            const termF12 = MathPlus.plus(f1, f2);
            const termF3 = MathPlus.times(
                MathPlus.times(MathPlus.times(a, a), MathPlus.times(a, e)),
                64
            );
            const F = Public.zeroCorrect(MathPlus.minus(termF12, termF3), f1, f2, termF3).re;

            const termA1 = MathPlus.times(D, D);
            const termA2 = MathPlus.times(3, F);
            const A = Public.zeroCorrect(MathPlus.minus(termA1, termA2), termA1, termA2).re;

            const termB1 = MathPlus.times(D, F);
            const termB2 = MathPlus.times(MathPlus.times(E, E), 9);
            const B = Public.zeroCorrect(MathPlus.minus(termB1, termB2), termB1, termB2).re;

            const termC1 = MathPlus.times(F, F);
            const termC2 = MathPlus.times(MathPlus.times(D, MathPlus.times(E, E)), 3);
            const C = Public.zeroCorrect(MathPlus.minus(termC1, termC2), termC1, termC2).re;

            const termDelta1 = MathPlus.times(B, B);
            const termDelta2 = MathPlus.times(MathPlus.times(A, C), 4);
            const delta = Public.zeroCorrect(MathPlus.minus(termDelta1, termDelta2), termDelta1, termDelta2).re;

            // 天珩公式以 D、E、F 及其导出判别式 A、B、C、Δ 区分重根和实/复根组合。
            if (D.isZero() && E.isZero() && F.isZero()) {
                // D=E=F=0：四重实根。
                return [MathPlus.divide(b, MathPlus.times(a, -4))];
            }

            if (
                !D.isZero() && !E.isZero() && !F.isZero() &&
                A.isZero() && B.isZero() && C.isZero()
            ) {
                // D、E、F 非零且 A=B=C=0：一个三重实根和一个单实根。
                const mid0 = MathPlus.times(MathPlus.times(a, D), -4);
                const mid1 = MathPlus.divide(
                    MathPlus.times(b, D),
                    mid0
                );
                return [
                    MathPlus.minus(
                        mid1,
                        MathPlus.divide(MathPlus.times(E, 9), mid0)
                    ),
                    MathPlus.plus(
                        mid1,
                        MathPlus.divide(MathPlus.times(E, 3), mid0)
                    )
                ];
            }

            if (!D.isZero() && E.isZero() && F.isZero()) {
                // E=F=0、D≠0：两对二重根，D 的符号决定实根或复根。
                const mid0 = MathPlus.times(a, -4);
                const mid1 = MathPlus.divide(b, mid0);
                const mid2 = MathPlus.divide(MathPlus.sqrt(D), mid0);
                return [
                    MathPlus.plus(mid1, mid2),
                    MathPlus.minus(mid1, mid2)
                ];
            }

            if (
                !A.isZero() && !B.isZero() && !C.isZero() &&
                delta.isZero()
            ) {
                // A、B、C 非零且 Δ=0：一对二重实根，另两根由 A、B 的符号决定。
                const mid0 = MathPlus.divide(
                    b,
                    MathPlus.times(a, -4)
                );
                const mid1 = MathPlus.divide(
                    MathPlus.divide(MathPlus.times(MathPlus.times(A, E), 2), B),
                    MathPlus.times(a, -4)
                );
                const root1 = MathPlus.plus(mid0, mid1);
                const mid2 = MathPlus.minus(mid0, mid1);
                const mid3 = MathPlus.divide(
                    MathPlus.sqrt(MathPlus.divide(
                        MathPlus.times(B, 2),
                        A
                    )),
                    MathPlus.times(a, -4)
                );
                return [root1, MathPlus.plus(mid2, mid3), MathPlus.minus(mid2, mid3)];
            }

            if (delta.isPositive()) {
                // Δ>0：两个互异实根和一对共轭复根。
                const mid1 = MathPlus.minus(
                    MathPlus.times(A, D),
                    MathPlus.times(B, '1.5')
                );
                const mid2 = MathPlus.times('1.5', MathPlus.sqrt(delta));
                const z1 = MathPlus.cbrt(MathPlus.plus(mid1, mid2));
                const z2 = MathPlus.cbrt(MathPlus.minus(mid1, mid2));
                const midZ = MathPlus.plus(z1, z2);
                const termZ1 = MathPlus.times(D, D);
                const termZ2 = MathPlus.times(A, 3);
                const termZ3 = MathPlus.times(midZ, midZ);
                const termZ4 = MathPlus.times(D, midZ);
                const z = MathPlus.sqrt(correctNonnegative(
                    MathPlus.plus(MathPlus.minus(termZ1, termZ2), MathPlus.minus(termZ3, termZ4)),
                    termZ1, termZ2, termZ3, termZ4
                ));
                const mid4 = MathPlus.divide(b, MathPlus.times(a, -4));
                const mid5 = MathPlus.divide(
                    MathPlus.times(
                        MathPlus.sgn(E),
                        MathPlus.sqrt(MathPlus.divide(
                            correctNonnegative(MathPlus.plus(D, midZ), D, midZ),
                            3
                        ))
                    ),
                    MathPlus.times(a, 4)
                );
                const termReal = MathPlus.times(MathPlus.plus(z, D), 2);
                const mid6 = MathPlus.divide(
                    MathPlus.sqrt(MathPlus.divide(
                        correctNonnegative(MathPlus.minus(termReal, midZ), termReal, midZ),
                        3
                    )),
                    MathPlus.times(a, 4)
                );
                const root1 = MathPlus.plus(MathPlus.plus(mid4, mid5), mid6);
                const root2 = MathPlus.minus(MathPlus.plus(mid4, mid5), mid6);
                const termImaginary = MathPlus.times(MathPlus.minus(z, D), 2);
                const im = MathPlus.divide(
                    MathPlus.sqrt(MathPlus.divide(
                        correctNonnegative(MathPlus.plus(termImaginary, midZ), termImaginary, midZ),
                        3
                    )),
                    MathPlus.times(a, 4)
                ).re;
                const re = MathPlus.minus(mid4, mid5).re;
                const root3 = new ComplexNumber([re, im]);
                const root4 = new ComplexNumber([re, MathPlus.minus(0, im).re]);
                return [root1, root2, root3, root4];
            }

            if (E.isZero() && F.isPositive() && !D.isZero()) {
                // E=0、F>0：按 D 与 F 的组合直接构造四个根。
                const mid0 = MathPlus.times(MathPlus.sqrt(F), 2);
                const mid1 = MathPlus.sqrt(MathPlus.plus(D, mid0));
                const radicand = MathPlus.minus(D, mid0);
                // D>0 时两项均应非负，D<0 时保留复根所需的负值。
                const mid2 = MathPlus.sqrt(D.isPositive() ? correctNonnegative(radicand, D, mid0) : radicand);
                const mid3 = MathPlus.times(a, -4);
                const root1 = MathPlus.divide(
                    MathPlus.minus(b, mid1),
                    mid3
                );
                const root2 = MathPlus.divide(
                    MathPlus.plus(b, mid1),
                    mid3
                );
                const root3 = MathPlus.divide(
                    MathPlus.minus(b, mid2),
                    mid3
                );
                const root4 = MathPlus.divide(
                    MathPlus.plus(b, mid2),
                    mid3
                );
                return [root1, root2, root3, root4];
            }

            if (E.isZero() && F.isNegative()) {
                // E=0、F<0：得到两对共轭复根。
                const sqrtAF = MathPlus.sqrt(MathPlus.minus(A, F));
                const mid0 = MathPlus.divide(
                    b,
                    MathPlus.times(a, -4)
                );
                const mid1 = MathPlus.divide(
                    MathPlus.sqrt(MathPlus.times(
                        correctNonnegative(MathPlus.plus(sqrtAF, D), sqrtAF, D),
                        2
                    )),
                    MathPlus.times(a, 8)
                );
                const re1 = MathPlus.plus(mid0, mid1).re;
                const re2 = MathPlus.minus(mid0, mid1).re;
                const im = MathPlus.divide(
                    MathPlus.sqrt(MathPlus.times(
                        correctNonnegative(MathPlus.minus(sqrtAF, D), sqrtAF, D),
                        2
                    )),
                    MathPlus.times(a, 8)
                ).re;
                const root1 = new ComplexNumber([re1, im]);
                const root2 = new ComplexNumber([re1, MathPlus.minus(0, im).re]);
                const root3 = new ComplexNumber([re2, im]);
                const root4 = new ComplexNumber([re2, MathPlus.minus(0, im).re]);
                return [root1, root2, root3, root4];
            }

            const mid0 = MathPlus.sqrt(A);
            // 其余 Δ<0 情形通过预解三次方程的三角解构造 y1、y2、y3。
            const T = MathPlus.divide(
                MathPlus.minus(
                    MathPlus.times(B, 3),
                    MathPlus.times(MathPlus.times(A, D), 2)
                ),
                MathPlus.times(MathPlus.times(A, mid0), 2)
            );
            let ct;
            if (!MathPlus.plus(MathPlus.abs(T), -1).re.isPositive()) {
                ct = MathPlus.divide(MathPlus.arccos(T), 3);
            } else {
                ct = MathPlus.divide(MathPlus.arccos(T.re.isPositive() ? 1 : -1), 3);
            }
            const cosCT = MathPlus.cos(ct);
            const sinCT = MathPlus.times(MathPlus.sin(ct), MathPlus.sqrt(3));
            const hasFourRealRoots = !E.isZero() && F.isPositive() && D.isPositive();
            const sqrtY = (term) => {
                const sum = MathPlus.plus(D, term);
                return MathPlus.sqrt(MathPlus.divide(hasFourRealRoots ? correctNonnegative(sum, D, term) : sum, 3));
            };
            const y1 = sqrtY(MathPlus.times(MathPlus.times(mid0, cosCT), -2));
            const y2 = sqrtY(MathPlus.times(mid0, MathPlus.plus(cosCT, sinCT)));
            const y3 = sqrtY(MathPlus.times(mid0, MathPlus.minus(cosCT, sinCT)));

            if (hasFourRealRoots) {
                // D、F 均为正时四根均为实数；否则下方组合给出两对共轭复根。
                const mid1 = MathPlus.plus(y2, y3);
                const mid2 = MathPlus.minus(y2, y3);
                const mid3 = MathPlus.minus(
                    MathPlus.times(y1, MathPlus.sgn(E)),
                    b
                );
                const mid4 = MathPlus.minus(0, MathPlus.plus(
                    MathPlus.times(y1, MathPlus.sgn(E)),
                    b
                ));
                const numerator1 = MathPlus.plus(mid3, mid1);
                const numerator2 = MathPlus.minus(mid3, mid1);
                const numerator3 = MathPlus.plus(mid4, mid2);
                const numerator4 = MathPlus.minus(mid4, mid2);
                const denominator = MathPlus.times(a, 4);
                return [
                    MathPlus.divide(numerator1, denominator),
                    MathPlus.divide(numerator2, denominator),
                    MathPlus.divide(numerator3, denominator),
                    MathPlus.divide(numerator4, denominator)
                ];
            }

            const mid1 = MathPlus.plus(
                MathPlus.times(MathPlus.sgn(E), y1),
                y3
            );
            const mid2 = MathPlus.minus(
                MathPlus.times(MathPlus.sgn(E), y1),
                y3
            );
            const mid3 = MathPlus.minus(0, MathPlus.plus(y2, b));
            const mid4 = MathPlus.minus(y2, b);
            const numerator1 = MathPlus.plus(mid3, mid1);
            const numerator2 = MathPlus.minus(mid3, mid1);
            const numerator3 = MathPlus.plus(mid4, mid2);
            const numerator4 = MathPlus.minus(mid4, mid2);
            const denominator = MathPlus.times(a, 4);
            return [
                MathPlus.divide(numerator1, denominator),
                MathPlus.divide(numerator2, denominator),
                MathPlus.divide(numerator3, denominator),
                MathPlus.divide(numerator4, denominator)
            ];
        }

        /**
         * 分析四次及以下实系数多项式的区间、极值、拐点和根。
         *
         * @param {Array<string|number|bigint|BigNumber|ComplexNumber|Array>} list - 长度固定为 5、按降幂排列的
         *   实系数 `[a, b, c, d, e]`（对应 ax⁴ + bx³ + cx² + dx + e，低次多项式的高次项须以 0 填充）。
         *   前导零会自动降阶，任一非零虚部都会拒绝整次分析，输入数组不会被排序或改写。
         * @returns {PowerFunctionAnalysisResult} 字段固定的分析结果；低次多项式不适用的区间或点仍以
         *   `[['null','null']]` 保留，避免 UI 按次数猜测缺失字段。所有边界、坐标和根均为显示字符串。
         * @throws {Error} 系数包含复数时抛出。
         */
        static powerFunctionAnalysis(list) {
            const result = {};
            const
                inputA = Public.zeroCorrect(MathPlus.calc(list[0])[0]),
                inputB = Public.zeroCorrect(MathPlus.calc(list[1])[0]),
                inputC = Public.zeroCorrect(MathPlus.calc(list[2])[0]),
                inputD = Public.zeroCorrect(MathPlus.calc(list[3])[0]),
                inputE = Public.zeroCorrect(MathPlus.calc(list[4])[0]);
            if (!inputA.onlyReal || !inputB.onlyReal || !inputC.onlyReal || !inputD.onlyReal || !inputE.onlyReal) {
                throw new Error('[PowerFunctionTools] Complex number appear in the input.');
            }
            const
                a = inputA.re,
                b = inputB.re,
                c = inputC.re,
                d = inputD.re,
                e = inputE.re;
            result.equation = Public.funcToString([e, d, c, b, a], 'powerFunc');

            if (!a.isZero()) {
                // 四次函数：一阶导数的实根划分单调区间，二阶导数的实根划分凹凸区间。
                list = [a, b, c, d, e];
                const diff1 = PowerFunctionTools._differentiate(list);
                const diff1Roots = PowerFunctionTools._solveCubic(diff1);
                const diff2 = PowerFunctionTools._differentiate(diff1);
                const diff2Roots = PowerFunctionTools._solveQuadratic(diff2);

                if ([1, 2, 4].includes(diff1Roots.length)) {
                    const minMax = Public.idealizationToString(PowerFunctionTools._getPowerFunctionValue(list, diff1Roots[0]));
                    const point = Public.idealizationToString(diff1Roots[0]);
                    result.range = a.isPositive() ? [minMax, '+inf'] : ['-inf', minMax];
                    result[a.isPositive() ? 'increasingInterval' : 'decreasingInterval'] = [[point, '+inf']];
                    result[a.isPositive() ? 'decreasingInterval' : 'increasingInterval'] = [['-inf', point]];
                    result[a.isPositive() ? 'maximumPoint' : 'minimumPoint'] = [['null', 'null']];
                    result[a.isPositive() ? 'minimumPoint' : 'maximumPoint'] = [[point, minMax]];
                } else if (diff1Roots.length === 3) {
                    const minMax1 = PowerFunctionTools._getPowerFunctionValue(list, diff1Roots[0]);
                    const minMax2 = PowerFunctionTools._getPowerFunctionValue(list, diff1Roots[1]);
                    const minMax3 = PowerFunctionTools._getPowerFunctionValue(list, diff1Roots[2]);
                    const minMaxList = PowerFunctionTools._sort([minMax1, minMax2, minMax3]);
                    const realMinMax = Public.idealizationToString(a.isPositive() ? minMaxList[0] : minMaxList[2]);
                    result.range = a.isPositive() ? [realMinMax, '+inf'] : ['-inf', realMinMax];
                    const point1 = Public.idealizationToString(diff1Roots[0]),
                        point2 = Public.idealizationToString(diff1Roots[1]),
                        point3 = Public.idealizationToString(diff1Roots[2]);
                    result[a.isPositive() ? 'increasingInterval' : 'decreasingInterval'] = [[point1, point2], [point3, '+inf']];
                    result[a.isPositive() ? 'decreasingInterval' : 'increasingInterval'] = [['-inf', point1], [point2, point3]];
                    result[a.isPositive() ? 'maximumPoint' : 'minimumPoint'] = [[point2, Public.idealizationToString(minMax2)]];
                    result[a.isPositive() ? 'minimumPoint' : 'maximumPoint'] = [
                        [point1, Public.idealizationToString(minMax1)],
                        [point3, Public.idealizationToString(minMax3)]
                    ];
                }

                if ([1, 3].includes(diff2Roots.length)) {
                    result[a.isPositive() ? 'convexInterval' : 'concaveInterval'] = [['null', 'null']];
                    result[a.isPositive() ? 'concaveInterval' : 'convexInterval'] = [['-inf', '+inf']];
                    result.inflectionPoint = [['null', 'null']];
                } else if (diff2Roots.length === 2) {
                    const point1 = Public.idealizationToString(diff2Roots[0]),
                        point2 = Public.idealizationToString(diff2Roots[1]);
                    result[a.isPositive() ? 'convexInterval' : 'concaveInterval'] = [[point1, point2]];
                    result[a.isPositive() ? 'concaveInterval' : 'convexInterval'] = [['-inf', point1], [point2, '+inf']];
                    result.inflectionPoint = [
                        [point1, Public.idealizationToString(PowerFunctionTools._getPowerFunctionValue(list, diff2Roots[0]))],
                        [point2, Public.idealizationToString(PowerFunctionTools._getPowerFunctionValue(list, diff2Roots[1]))]
                    ];
                }

                const roots = [];
                const originalRoots = PowerFunctionTools._solveQuartic(list);
                for (let i = 0; i < Math.min(4, originalRoots.length); i++) {
                    roots.push(Public.idealizationToString(originalRoots[i]));
                }
                result.roots = roots;
                return result;
            }

            if (!b.isZero()) {
                // 三次函数：一阶导数决定极值，唯一的二阶导数根给出拐点。
                list = [b, c, d, e];
                const diff1 = PowerFunctionTools._differentiate(list);
                const diff1Roots = PowerFunctionTools._solveQuadratic(diff1);
                const diff2 = PowerFunctionTools._differentiate(diff1);
                const diff2Roots = PowerFunctionTools._solveLinear(diff2);
                result.range = ['-inf', '+inf'];

                if ([1, 3].includes(diff1Roots.length)) {
                    result[b.isPositive() ? 'increasingInterval' : 'decreasingInterval'] = [['-inf', '+inf']];
                    result[b.isPositive() ? 'decreasingInterval' : 'increasingInterval'] = [['null', 'null']];
                    result.maximumPoint = [['null', 'null']];
                    result.minimumPoint = [['null', 'null']];
                } else {
                    const point1 = Public.idealizationToString(diff1Roots[0]),
                        point2 = Public.idealizationToString(diff1Roots[1]);
                    result[b.isPositive() ? 'increasingInterval' : 'decreasingInterval'] = [['-inf', point1], [point2, '+inf']];
                    result[b.isPositive() ? 'decreasingInterval' : 'increasingInterval'] = [[point1, point2]];
                    result[b.isPositive() ? 'maximumPoint' : 'minimumPoint'] = [[point1, Public.idealizationToString(PowerFunctionTools._getPowerFunctionValue(list, diff1Roots[0]))]];
                    result[b.isPositive() ? 'minimumPoint' : 'maximumPoint'] = [[point2, Public.idealizationToString(PowerFunctionTools._getPowerFunctionValue(list, diff1Roots[1]))]];
                }

                const point = Public.idealizationToString(diff2Roots[0]);
                result[b.isPositive() ? 'convexInterval' : 'concaveInterval'] = [['-inf', point]];
                result[b.isPositive() ? 'concaveInterval' : 'convexInterval'] = [[point, '+inf']];
                result.inflectionPoint = [[point, Public.idealizationToString(PowerFunctionTools._getPowerFunctionValue(list, diff2Roots[0]))]];

                const roots = [];
                const originalRoots = PowerFunctionTools._solveCubic(list);
                for (let i = 0; i < Math.min(3, originalRoots.length); i++) {
                    roots.push(Public.idealizationToString(originalRoots[i]));
                }
                result.roots = roots;
                return result;
            }

            if (!c.isZero()) {
                // 二次函数：顶点决定值域与单调性，二阶导数符号决定全区间凹凸性。
                list = [c, d, e];
                const diff1 = PowerFunctionTools._differentiate(list);
                const diff1Roots = PowerFunctionTools._solveLinear(diff1);
                const point = Public.idealizationToString(diff1Roots[0]);
                const minMax = Public.idealizationToString(PowerFunctionTools._getPowerFunctionValue(list, diff1Roots[0]));
                result.range = c.isPositive() ? [minMax, '+inf'] : ['-inf', minMax];
                result[c.isPositive() ? 'increasingInterval' : 'decreasingInterval'] = [[point, '+inf']];
                result[c.isPositive() ? 'decreasingInterval' : 'increasingInterval'] = [['-inf', point]];
                result[c.isPositive() ? 'maximumPoint' : 'minimumPoint'] = [['null', 'null']];
                result[c.isPositive() ? 'minimumPoint' : 'maximumPoint'] = [[point, minMax]];
                result[c.isPositive() ? 'convexInterval' : 'concaveInterval'] = [['null', 'null']];
                result[c.isPositive() ? 'concaveInterval' : 'convexInterval'] = [['-inf', '+inf']];
                result.inflectionPoint = [['null', 'null']];

                const roots = [];
                const originalRoots = PowerFunctionTools._solveQuadratic(list);
                for (let i = 0; i < Math.min(2, originalRoots.length); i++) {
                    roots.push(Public.idealizationToString(originalRoots[i]));
                }
                result.roots = roots;
                return result;
            }

            if (!d.isZero()) {
                // 一次函数由斜率符号决定全区间单调性，不存在有限极值或拐点。
                list = [d, e];
                result.range = ['-inf', '+inf'];
                result[d.isPositive() ? 'increasingInterval' : 'decreasingInterval'] = [['-inf', '+inf']];
                result[d.isPositive() ? 'decreasingInterval' : 'increasingInterval'] = [['null', 'null']];
                result.maximumPoint = [['null', 'null']];
                result.minimumPoint = [['null', 'null']];
                result.convexInterval = [['null', 'null']];
                result.concaveInterval = [['null', 'null']];
                result.inflectionPoint = [['null', 'null']];
                result.roots = Public.idealizationToString(PowerFunctionTools._solveLinear(list));
                return result;
            }

            const num = Public.idealizationToString(e);
            result.range = [num, num];
            result.increasingInterval = [['null', 'null']];
            result.decreasingInterval = [['null', 'null']];
            result.maximumPoint = [['null', 'null']];
            result.minimumPoint = [['null', 'null']];
            result.convexInterval = [['null', 'null']];
            result.concaveInterval = [['null', 'null']];
            result.inflectionPoint = [['null', 'null']];
            result.roots = [e.isZero() ? 'anyRealNumber' : 'null'];
            return result;
        }
    }

    /**
     * 计算复数的 n 次方根。
     *
     * @class RadicalFunctionTools
     */
    class RadicalFunctionTools {
        /**
         * 阻止实例化静态工具类。
         *
         * @throws {Error} 始终抛出。
         */
        constructor() {
            throw new Error('[RadicalFunctionTools] RadicalFunctionTools is a static class and should not be instantiated.');
        }

        /**
         * 根据极坐标形式生成复数 n 次方根的通式和求值函数。
         *
         * @private
         * @param {ComplexNumber|string|number} z - 任意实数或复数被开方数；转换后使用它的模和主辐角
         *   构造根族，零值会自然得到零模长。
         * @param {ComplexNumber|string|number} n - 已由上层验证的正整数根指数；该私有方法依赖此约束，
         *   用它计算 `1 / n`、根间角距及 `k` 的有效范围。
         * @returns {[string, function(ComplexNumber|string|number): ComplexNumber]} 二元组：第 0 项是包含
         *   `[k]` 和 `[toPolar]` 内部词元的根通式；第 1 项是同步求值函数，接收根序号 `k` 并返回
         *   `r^(1/n) ∠ ((arg(z)+2kπ)/n)`，相差 `n` 的整数序号会得到同一个根。
         */
        static _generalFormula(z, n) {
            z = new ComplexNumber(z);
            n = new ComplexNumber(n);

            // 若 z=r·e^(iθ)，则第 k 个 n 次方根为 r^(1/n)·e^(i(θ+2kπ)/n)。
            const realPow = MathPlus.divide(1, n);
            const r = MathPlus.abs(z);
            const arg = MathPlus.arg(z);
            const length = MathPlus.pow(r, realPow);
            const argumentConstant = MathPlus.times(realPow, arg);
            const argumentConstantK = MathPlus.times(
                MathPlus.times(2, BigNumber.approximateConstant(CalcConfig.constants.pi)),
                realPow
            );
            const lengthPart = Public.idealizationToString(length);
            const argumentPart = Public.funcToString([argumentConstant, argumentConstantK], 'powerFunc', '[k]');

            let formula;
            if (lengthPart.includes('E')) {
                formula = `(${lengthPart})`;
            } else {
                formula = lengthPart;
            }
            formula += `[toPolar](${argumentPart})`;

            return [
                formula,
                (x) => MathPlus.toPolar(
                    length,
                    MathPlus.plus(argumentConstant, MathPlus.times(x, argumentConstantK))
                )
            ];
        }

        /**
         * 计算复数的 n 次方根通式、索引范围和有限数量的数值解。
         *
         * @param {ComplexNumber|string|number} z - 可解析为实数或复数的被开方数；结果对象同时保留
         *   规范化后的 `z` 字符串、通式以及按 `k` 排列的数值根。
         * @param {ComplexNumber|string|number} n - 必须能在精度修正后成为严格正整数；`n` 个不同根中
         *   最多展示 `CalcConfig.RADICAL_FUNCTION_MAX_SHOW_RESULTS` 个，其余通过 `overflow` 标记。
         * @returns {{z:string, n:string, formula:string, kRange:[string,string], numericalResults:Array<string>, overflow:boolean}}
         *   固定结构的根分析结果：`z`、`n` 是规范化输入；`formula` 是含 `[k]` 的极坐标通式；
         *   `kRange` 恒为 `['0', String(n-1)]`；`numericalResults[i]` 对应 `k=i`；`overflow` 表示
         *   `n` 超过展示上限，未展示根仍可由通式计算。
         * @throws {Error} n 不是正整数时抛出。
         */
        static radicalFunctionAnalysis(z, n) {
            z = Public.zeroCorrect(MathPlus.calc(z)[0]);
            n = Public.integerCorrect(Public.zeroCorrect(MathPlus.calc(n)[0]));

            if (!n.onlyReal || n.re.power < 0 || !n.re.isPositive()) {
                throw new Error('[RadicalFunctionTools] n can only be a positive integer.');
            }
            if (z.isZero()) {
                return {
                    z: '0',
                    n: Public.idealizationToString(n),
                    formula: '0',
                    kRange: ['0', '0'],
                    numericalResults: ['0'],
                    overflow: false
                };
            }

            const result = {};
            result.z = Public.idealizationToString(z);
            result.n = Public.idealizationToString(n);
            const innerResult = RadicalFunctionTools._generalFormula(z, n);
            result.formula = innerResult[0];
            result.kRange = ['0', MathPlus.minus(n, 1).toString()];
            let count;
            if (MathPlus.minus(n, CalcConfig.RADICAL_FUNCTION_MAX_SHOW_RESULTS).re.isPositive()) {
                count = CalcConfig.RADICAL_FUNCTION_MAX_SHOW_RESULTS;
                result.overflow = true;
            } else {
                count = n;
                result.overflow = false;
            }
            result.numericalResults = Public.idealizationToString(
                Public.functionValueList(innerResult[1], 0, 1, MathPlus.minus(count, 1))
            );
            return result;
        }
    }

    /**
     * 在指定范围内生成函数 f 和 g 的值列表。
     *
     * @class FuncValueListTools
     */
    class FuncValueListTools {
        /**
         * 阻止实例化静态工具类。
         *
         * @throws {Error} 始终抛出。
         */
        constructor() {
            throw new Error('[FuncValueListTools] FuncValueListTools is a static class and should not be instantiated.');
        }

        /**
         * 在实数闭区间内生成可能相互引用的 f(x) 和 g(x) 值列表。
         *
         * @param {string} f - 使用内部词元书写的 `f(x)` 函数体；可通过 `[g]` 调用 `g`，
         *   单点求值失败只在 `f` 结果的同一位置写入 `error`。
         * @param {string} g - 使用内部词元书写的 `g(x)` 函数体；可通过 `[f]` 调用 `f`，
         *   其失败位置与 `f` 独立记录。
         * @param {string|number|bigint|BigNumber|ComplexNumber} start - 闭区间实数起点；表达式求值、
         *   近零修正后不得带非零虚部，且不得大于 `end`。
         * @param {string|number|bigint|BigNumber|ComplexNumber} step - 严格大于零的纯实步长；决定显示点间距。
         *   达到最大展示数量时停止继续分配，并在结果尾部放置省略标记。
         * @param {string|number|bigint|BigNumber|ComplexNumber} end - 闭区间实数终点；
         *   仅计算按步长实际到达且不大于它的点，不会为了包含终点而改变最后一步。
         * @returns {{varList:Array<string>, f:Array<string>, g:Array<string>}} 三个索引对齐的显示数组：
         *   `varList[i]` 是采样自变量，`f[i]`、`g[i]` 是对应函数值或 `error`。超出展示上限时
         *   `varList` 末尾追加 `[print_content_omit]`，两个函数数组同位置追加 `[not_applicable]`。
         * @throws {Error} 边界或步长不是有效实数时抛出。
         */
        static valueList(f, g, start, step, end) {
            return this._sample(f, g, start, step, end).next().value;
        }

        /**
         * 在 Worker 中分批采样，让取消消息能在相邻批次之间生效。
         *
         * @param {string} f - 使用内部词元书写的 `f(x)` 函数体。
         * @param {string} g - 使用内部词元书写的 `g(x)` 函数体。
         * @param {string|number|bigint|BigNumber|ComplexNumber} start - 闭区间的实数起点。
         * @param {string|number|bigint|BigNumber|ComplexNumber} step - 严格大于零的实数步长。
         * @param {string|number|bigint|BigNumber|ComplexNumber} end - 闭区间的实数终点。
         * @param {{isCancelled: function(): boolean, throwIfCancelled: function(): void}} cancellationSignal -
         *   Worker 注入的取消信号。任务已取消时，`throwIfCancelled()` 抛出 `CancellationError`。
         * @returns {Promise<{varList:Array<string>, f:Array<string>, g:Array<string>}>} 采样结果，格式与 `valueList` 一致。
         */
        static async valueListCancellable(f, g, start, step, end, cancellationSignal) {
            const batchTime = 16;
            let deadline = performance.now() + batchTime;
            cancellationSignal.throwIfCancelled();
            const sampling = this._sample(f, g, start, step, end, () => performance.now() >= deadline);
            let batch = sampling.next();
            while (!batch.done) {
                // 让出一个任务，使 Worker 能处理排队的取消消息。
                await new Promise(resolve => setTimeout(resolve, 0));
                cancellationSignal.throwIfCancelled();
                deadline = performance.now() + batchTime;
                batch = sampling.next();
            }
            return batch.value;
        }

        /**
         * 同步与可取消数表共用的采样循环，每个函数体在采样前至多编译一次。
         *
         * @private
         * @param {string} f - 使用内部词元书写的 `f(x)` 函数体。
         * @param {string} g - 使用内部词元书写的 `g(x)` 函数体。
         * @param {string|number|bigint|BigNumber|ComplexNumber} start - 闭区间的实数起点，必须不大于 `end`。
         * @param {string|number|bigint|BigNumber|ComplexNumber} step - 严格大于零的实数步长。
         * @param {string|number|bigint|BigNumber|ComplexNumber} end - 闭区间的实数终点。
         * @param {function(): boolean} [onStep] - 每个采样点完成后调用；返回 `true` 时暂停，等待下一次 `next()`。
         * @yields {undefined} 到达批次边界时让出控制权。
         * @returns {Generator<undefined, {varList:Array<string>, f:Array<string>, g:Array<string>}, void>} 采样生成器；
         *   完成时的 `value` 是与 `valueList` 相同的三个结果数组。
         * @throws {Error} 推进生成器时，范围或步长不满足实数采样要求则抛出。
         */
        static* _sample(f, g, start, step, end, onStep) {
            const acc = CalcConfig.globalCalcAccuracy;
            const formatOptions = {acc: CalcConfig.outputAccuracy, printMode: CalcConfig.globalPrintMode};
            start = Public.zeroCorrect(MathPlus.calc(start, {acc})[0]);
            step = Public.zeroCorrect(MathPlus.calc(step, {acc})[0]);
            end = Public.zeroCorrect(MathPlus.calc(end, {acc})[0]);

            if (!start.onlyReal || !step.onlyReal || !end.onlyReal) {
                throw new Error('[FuncValueListTools] Complex number appear in the input.');
            }
            if (MathPlus.minus(start, end).re.isPositive()) {
                throw new Error('[FuncValueListTools] The initial value is greater than the termination value.');
            }
            // 正步长校验可防止无限循环。
            if (!step.re.isPositive()) {
                throw new Error('[FuncValueListTools] Step size less than or equal to 0.');
            }

            const varList = [];
            const resultF = [];
            const resultG = [];
            const maxCount = CalcConfig.VALUE_LIST_MAX_SHOW_RESULTS;

            // 缺失、空白或无法编译的函数体统一留空，逐点格式化时写入错误标记。
            const compileBody = (body) => {
                if (body == null || (typeof body === 'string' && body.trim() === '')) {
                    return undefined;
                }
                try {
                    return MathPlus.compile(body, {acc});
                } catch {
                    return undefined;
                }
            };
            const compiledF = compileBody(f);
            const compiledG = f === g ? compiledF : compileBody(g);
            const contextF = {g: compiledG, acc};
            const contextG = {f: compiledF, acc};

            // 每个采样点只更新代入值；另一函数的编译结果随上下文复用。
            const formatValue = (compiled, context, unknown) => {
                if (compiled === undefined) {
                    return 'error';
                }
                try {
                    context.unknown = unknown;
                    return Public.idealizationToString(MathPlus.evalRPN(compiled.rpn, context), formatOptions);
                } catch {
                    return 'error';
                }
            };

            let k = 0;
            let currentX = start;
            while (!MathPlus.minus(currentX, end).re.isPositive() && k < maxCount) {
                varList.push(Public.idealizationToString(currentX, formatOptions));
                resultF.push(formatValue(compiledF, contextF, currentX));
                resultG.push(formatValue(compiledG, contextG, currentX));

                k++;
                // 用 start + k * step 替代连续累加，消除长区间误差漂移。
                currentX = MathPlus.plus(start, MathPlus.times(step, new BigNumber(k, {acc})));
                if (onStep?.()) {
                    yield;
                }
            }

            if (k === maxCount && !MathPlus.minus(currentX, end).re.isPositive()) {
                varList.push('[print_content_omit]');
                resultF.push('[not_applicable]');
                resultG.push('[not_applicable]');
            }

            return {
                varList,
                f: resultF,
                g: resultG
            };
        }
    }

    /**
     * 使用单次调用参数封装计算核心，不修改全局精度配置。
     *
     * @class CalcTools
     */
    class CalcTools {
        /**
         * 阻止实例化静态工具类。
         *
         * @throws {Error} 始终抛出。
         */
        constructor() {
            throw new Error('[CalcTools] CalcTools is a static class and should not be instantiated.');
        }

        /**
         * 使用独立的计算与输出精度计算表达式；这些选项只作用于本次调用。
         *
         * @param {string|number|bigint|BigNumber|ComplexNumber} expr - 内部数学表达式或数值；其规范化
         *   表达式会与结果一并返回。
         * @param {object} [options={}] - 只覆盖本次调用的计算、格式化和自定义函数上下文；不会修改
         *   `CalcConfig`，适合并发 Worker 任务使用。
         * @param {'algebra'|'polar'} [options.printMode=CalcConfig.globalPrintMode] - 最终字符串中的复数表示法；
         *   `outputMode='mid'` 返回内部值时不进行这一步格式化。
         * @param {number} [options.calcAcc=CalcConfig.globalCalcAccuracy] - 本次解析和中间运算使用的正整数
         *   有效位数；应不超过配置允许的计算上限。
         * @param {number} [options.outputAcc=CalcConfig.outputAccuracy] - 最终显示精度；支持绝对位数、
         *   `(0, 1)` 比例以及非正的“保持计算精度”语义。
         * @param {'calc'|'syntaxCheck'} [options.calcMode='calc'] - `calc` 计算表达式；`syntaxCheck` 对字符串
         *   执行词法和语法校验，返回规范化表达式与零占位结果。
         * @param {'output'|'mid'} [options.outputMode='output'] - `output` 返回格式化字符串；`mid` 返回
         *   可供后续高精度运算使用的内部结果，调用方不可假定二者类型相同。
         * @param {string} [options.f] - 可供表达式 `[f]` 调用的函数体；可引用 `[x]` 和 `[g]`。
         * @param {string} [options.g] - 可供表达式 `[g]` 调用的函数体；可引用 `[x]` 和 `[f]`。
         * @returns {{result:string|[[number,bigint,number],[number,bigint,number]], expr:string, noiseMag?:[number,number]}}
         *   `result` 在 `outputMode='output'` 时是格式化字符串，在 `mid` 时是实部、虚部各自的
         *   `[power,mantissa,acc]` 元组，并额外返回 `noiseMag` 以恢复两分量的噪声状态；
         *   `expr` 始终是语法解析后的规范化内部表达式，可用于回显或再次计算。
         */
        static exec(expr, {
            printMode = CalcConfig.globalPrintMode,
            calcAcc = CalcConfig.globalCalcAccuracy,
            outputAcc = CalcConfig.outputAccuracy,
            calcMode = 'calc',
            outputMode = 'output',
            f, g
        } = {}) {
            let effectiveOutputAcc = outputAcc;
            if (effectiveOutputAcc > 1 && effectiveOutputAcc > calcAcc) {
                effectiveOutputAcc = calcAcc;
            }

            const [value, normalizedExpr] = MathPlus.calc(expr, {
                f: f,
                g: g,
                mode: calcMode,
                acc: calcAcc
            });

            if (outputMode === 'output') {
                return {
                    result: Public.idealizationToString(value, {acc: effectiveOutputAcc, printMode}),
                    expr: normalizedExpr
                };
            }
            return {
                result: value.valueOf(),
                expr: normalizedExpr,
                noiseMag: [value.re.noiseMag, value.im.noiseMag]
            };
        }
    }

    window.BigNumber = BigNumber;
    window.ComplexNumber = ComplexNumber;
    window.MathPlus = MathPlus;
    window.StatisticsTools = StatisticsTools;
    window.PowerFunctionTools = PowerFunctionTools;
    window.RadicalFunctionTools = RadicalFunctionTools;
    window.FuncValueListTools = FuncValueListTools;
    window.CalcTools = CalcTools;
})();