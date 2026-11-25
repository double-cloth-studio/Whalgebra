import assert from "node:assert/strict";
import test from "node:test";
import {createCalcCoreWindow} from "./helpers/calc_core.js";

test("元组和普通对象构造时规范化尾数并记录舍入噪声", async () => {
    const {BigNumber, CalcConfig, MathPlus} = await createCalcCoreWindow();
    CalcConfig.globalCalcAccuracy = 3;

    const tuple = new BigNumber([-2, 1200]);
    assert.equal(tuple.mantissa, 12n);
    assert.equal(tuple.power, 0);
    assert.equal(tuple.noiseMag, -Infinity);
    assert.equal(MathPlus.realTimes(tuple, tuple).toString(), "144");

    for (const input of [[-2, 123450n], {power: -2, mantissa: 123450, acc: 3}]) {
        const value = new BigNumber(input);
        assert.equal(value.mantissa, 123n);
        assert.equal(value.power, 1);
        assert.equal(value.acc, 3);
        assert.equal(value.noiseMag, 0);
    }
});

test("字符串下溢由舍入后的数量级决定，科学记数法只接受整数指数", async () => {
    const {BigNumber, CalcConfig} = await createCalcCoreWindow();
    for (const globalAcc of [36, 220]) {
        CalcConfig.globalCalcAccuracy = globalAcc;
        assert.equal(new BigNumber("1e-2070", {acc: 4}).isZero(), true);
        assert.equal(new BigNumber("1e-2027").isZero(), true);
        assert.equal(BigNumber.getMag(new BigNumber("-1.234e-2026", {acc: 4})), -2026);
        assert.equal(BigNumber.getMag(new BigNumber("9.99e-2027", {acc: 2})), -2026);
    }

    for (const input of ["1e2.0", "1e2.", "1e.5", "1e+"]) {
        assert.throws(() => new BigNumber(input), /invalid number format/);
    }
    assert.equal(new BigNumber("1e+002").toString(), "100");
});

test("实数除法区分精确中点及其两侧，并保留除零错误", async () => {
    const {BigNumber, MathPlus} = await createCalcCoreWindow();
    const cases = [
        ["9.999999999999", 8, 20, 2, "1.2"],
        ["10", 8, 20, 2, "1.2"],
        ["10.000000000001", 8, 20, 2, "1.3"],
        ["10.000000000001", -8, 20, 2, "-1.3"],
        ["-10.000000000001", 8, 20, 2, "-1.3"],
        ["-10.000000000001", -8, 20, 2, "1.3"],
        ["14", 8, 20, 2, "1.8"],
        ["10", "7.999999999999", 2, 20, "1.3"]
    ];
    for (const [a, b, accA, accB, expected] of cases) {
        const result = MathPlus.realDivide(new BigNumber(a, {acc: accA}), new BigNumber(b, {acc: accB}));
        assert.equal(result.toString(), expected, `${a} / ${b}`);
        assert.equal(result.noiseMag, -2);
    }

    const zero = new BigNumber(0n, {acc: 20});
    const quotient = MathPlus.realDivide(zero, new BigNumber(3, {acc: 2, noiseMag: -1}));
    assert.equal(quotient.isZero(), true);
    assert.equal(quotient.acc, 2);
    assert.equal(quotient.noiseMag, -Infinity);
    assert.throws(() => MathPlus.realDivide(zero, zero), /Division by zero/);
});
