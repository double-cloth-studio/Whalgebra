import assert from "node:assert/strict";
import test from "node:test";
import {createCalcCoreWindow} from "./helpers/calc_core.js";

test("负实底数的奇分母有理幂按分子奇偶性取实数值", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const cases = [
        ["(-8)^(1/3)", "-2"],
        ["(-8)^(2/3)", "4"],
        ["(-8)^(4/3)", "16"],
        ["(-8)^(-2/3)", "0.25"],
        ["(-8)^(-1/3)", "-0.5"],
        ["(-32)^0.4", "4"],
        ["(-32)^0.6", "-8"]
    ];

    for (const [expr, expected] of cases) {
        const [result] = MathPlus.calc(expr);
        assert.equal(result.im.mantissa, 0n, expr);
        assert.equal(result.re.toString({acc: 12}), expected, expr);
    }
    assert.equal(MathPlus.pow(-8, 2 / 3).re.toString({acc: 12}), "4");
    assert.equal(MathPlus.pow(-8, -1 / 3).re.toString({acc: 12}), "-0.5");

    for (const expr of ["(-16)^(3/4)", "(-4)^0.5", "(-8)^0.6666666666666666", "(-8)^[pi]"]) {
        const [result] = MathPlus.calc(expr);
        assert.notEqual(result.im.mantissa, 0n, expr);
    }
});

test("复数整数幂直接相乘，并在展开指数前检查结果规模", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const cases = [
        ["1+i", "0", "1", "0"],
        ["1+i", "2", "0", "2"],
        ["1+i", "-2", "0", "-0.5"],
        ["3+4i", "3", "-117", "44"],
        ["i", "4", "1", "0"],
        ["i", "-1", "0", "-1"],
        ["-i", "1e2022", "1", "0"],
        ["1+i", "-1e2022", "0", "0"]
    ];

    for (const [base, exponent, re, im] of cases) {
        const result = MathPlus.pow(base, exponent);
        assert.equal(result.re.toString(), re, `${base} ^ ${exponent}`);
        assert.equal(result.im.toString(), im, `${base} ^ ${exponent}`);
        assert.equal(result.re.noiseMag, -Infinity);
        assert.equal(result.im.noiseMag, -Infinity);
    }

    assert.throws(() => MathPlus.pow("1+i", "1e2022"), /Result of power is too large/);
    assert.throws(() => MathPlus.pow("1+1e-20i", "1e60"), /Result of power is too large/);
    assert.throws(() => MathPlus.pow("0.1i", "-1e2022"), /Result of power is too large/);
});
