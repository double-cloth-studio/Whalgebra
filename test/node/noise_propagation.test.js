import assert from "node:assert/strict";
import test from "node:test";
import {createCalcCoreWindow} from "./helpers/calc_core.js";

test("复数构造的各类实数输入均读取实部噪声", async () => {
    const {BigNumber, ComplexNumber, MathPlus} = await createCalcCoreWindow();
    const acc = 36;

    for (const input of [2, 2n, "2", [0, 2n, acc], new BigNumber(2, {acc})]) {
        const value = new ComplexNumber(input, {acc, noiseMag: [-12, -8]});
        assert.equal(value.re.noiseMag, -12);
        assert.equal(value.im.noiseMag, -Infinity);
    }

    const original = new ComplexNumber("2+3i", {acc, noiseMag: [-12, -15]});
    const scaled = new ComplexNumber(original, {acc: 50, pow: 3});
    assert.equal(scaled.re.noiseMag, -9);
    assert.equal(scaled.im.noiseMag, -12);
    assert.equal(MathPlus.re(original).re.noiseMag, -12);
    assert.equal(MathPlus.im(original).re.noiseMag, -15);
    assert.equal(MathPlus.conj(original).im.noiseMag, -15);
});

test("MathPlus 复用同精度输入并为确实需要的运算调整精度", async () => {
    const {BigNumber, ComplexNumber, MathPlus} = await createCalcCoreWindow();
    const input = new ComplexNumber("2", {acc: 36, noiseMag: -12});
    Object.freeze(input.re);
    Object.freeze(input.im);
    Object.freeze(input);

    for (const name of ["abs", "floor", "ceil"]) {
        assert.equal(MathPlus[name](input), input, name);
    }
    assert.equal(MathPlus.calc("[x]", {unknown: input, acc: 36})[0], input);

    const [value] = MathPlus.calc("[x]+1", {unknown: input, acc: 50});
    assert.equal(value.toString(), "3");
    assert.equal(value.acc, 50);
    assert.equal(value.re.noiseMag, -12);

    const mixed = new ComplexNumber({
        re: new BigNumber(2, {acc: 50}),
        im: new BigNumber(0, {acc: 36})
    });
    const normalized = MathPlus.abs(mixed);
    assert.equal(normalized.re.acc, 36);
    assert.equal(mixed.re.acc, 50);
});

test("乘方、指数拆分、开方和阶乘快路径保留输入噪声", async () => {
    const {BigNumber, MathPlus} = await createCalcCoreWindow();
    const n = (value, noiseMag) => new BigNumber(value, {acc: 36, noiseMag});
    const cases = [
        ["pow", [n("2", -12), n("3")], "8", -11],
        ["pow", [n("10", -12), n("3")], "1000", -9],
        ["pow", [n("1", -12), n("3")], "1", -11],
        ["pow", [n("2"), n("3", -12)], "8", -12],
        ["pow", [n("2"), n("0.5", -12)], "1.41421356237", -12],
        ["exp", [n("1.25", -12)], "3.49034295746", -12],
        ["exp", [n("1", -12)], "2.71828182846", -12],
        ["sqrt", [n("4E20", -12)], "2E+10", -22],
        ["cbrt", [n("8E30", -12)], "2E+10", -32],
        ["fact", [n("3", -12)], "6", -12]
    ];

    for (const [name, args, expected, minNoise] of cases) {
        const result = MathPlus[name](...args);
        assert.equal(result.toString({acc: 12}), expected, name);
        assert.ok(result.re.noiseMag >= minNoise, `${name}: ${result.re.noiseMag} < ${minNoise}`);
        assert.equal(result.im.noiseMag, -Infinity, name);
    }

    assert.equal(MathPlus.pow(n("2"), n("3")).re.noiseMag, -Infinity);
    const imaginary = MathPlus.pow(n("-4"), n("0.5", -12));
    assert.equal(imaginary.toString(), "2[i]");
    assert.equal(imaginary.re.noiseMag, -Infinity);
    assert.ok(imaginary.im.noiseMag >= -12);
});

test("负底数幂的相位噪声不会抹掉可分辨的轴向分量", async () => {
    const {CalcTools} = await createCalcCoreWindow();
    const cases = [["2", "1"], ["3", "-1"], ["0.5", "[i]"]];

    for (const [exponent, expected] of cases) {
        const expr = `(-1)^((1E31+${exponent}+1E-5)-1E31)`;
        assert.equal(CalcTools.exec(expr, {calcAcc: 36}).result, expected, expr);
    }
});

test("纯实复数的运算精度受两个分量共同限制", async () => {
    const {BigNumber, ComplexNumber, MathPlus} = await createCalcCoreWindow();
    const mixed = new ComplexNumber({
        re: new BigNumber("2.123456789", {acc: 50}),
        im: new BigNumber(0, {acc: 4})
    });
    const normalized = new ComplexNumber(mixed);
    const cases = [["degree", []], ["exponential", [1]], ["nroot", [2]], ["toPolar", [0]]];

    for (const [name, args] of cases) {
        const result = MathPlus[name](mixed, ...args);
        assert.equal(result.acc, 4, name);
        assert.deepEqual(result.valueOf(), MathPlus[name](normalized, ...args).valueOf(), name);
    }
});

test("实数乘法保留 bigint 尾数并传播噪声，零值使用统一的噪声状态", async () => {
    const {BigNumber, MathPlus} = await createCalcCoreWindow();
    const noisy = new BigNumber("2", {noiseMag: -12});
    const factor = new BigNumber("30");
    const zero = new BigNumber("0");

    const product = MathPlus.realTimes(noisy, factor);
    assert.equal(product.mantissa, 6n);
    assert.equal(product.power, 1);
    assert.equal(product.noiseMag, -11);
    for (const result of [MathPlus.realTimes(zero, noisy), MathPlus.realTimes(noisy, zero)]) {
        assert.equal(result.mantissa, 0n);
        assert.equal(result.noiseMag, -Infinity);
    }
});

test("常量和省略的级数项会给原本可表示的输出留下噪声", async () => {
    const {BigNumber, ComplexNumber, MathPlus} = await createCalcCoreWindow();
    const tuple = [-4, 31415n, 5];
    const constant = BigNumber.approximateConstant(tuple);
    assert.equal(constant.acc, 5);
    assert.equal(constant.noiseMag, -5);
    const rounded = BigNumber.approximateConstant(tuple, 3);
    assert.equal(rounded.toString(), "3.14");
    assert.equal(rounded.noiseMag, -3);

    const angle = MathPlus.arg(new ComplexNumber("i", {acc: 440}));
    assert.equal(angle.re.noiseMag, -440);
    assert.equal(MathPlus.degree(new BigNumber(180, {acc: 440})).re.noiseMag, -440);

    const tiny = new BigNumber("1E-100", {acc: 36});
    for (const name of ["exp", "cos", "ch"]) {
        const value = MathPlus[name](tiny);
        assert.equal(value.toString(), "1", name);
        assert.ok(Number.isFinite(value.re.noiseMag), name);
        assert.equal(MathPlus[name](0).re.noiseMag, -Infinity, name);
    }
});

test("mid 响应经过结构化克隆后仍能恢复相位噪声", async () => {
    const {CalcTools, ComplexNumber, MathPlus} = await createCalcCoreWindow();
    const expr = "10^25*[pi]+2[i]";
    const mid = structuredClone(CalcTools.exec(expr, {calcAcc: 36, outputMode: "mid"}));
    const restored = new ComplexNumber(mid.result, {noiseMag: mid.noiseMag});
    const [direct] = MathPlus.calc(expr, {acc: 36});

    assert.equal(restored.re.noiseMag, direct.re.noiseMag);
    assert.equal(restored.im.noiseMag, direct.im.noiseMag);
    assert.equal(MathPlus.sin(restored.re).toString(), "0");
    assert.notEqual(MathPlus.sin(new ComplexNumber(mid.result).re).toString(), "0");
    assert.equal(Object.hasOwn(CalcTools.exec(expr), "noiseMag"), false);
});
