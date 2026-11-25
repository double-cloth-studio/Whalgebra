import assert from "node:assert/strict";
import test from "node:test";
import {createCalcCoreWindow} from "./helpers/calc_core.js";

test("同一逆波兰指令可使用不同自变量和精度求值", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const {expr, rpn} = MathPlus.compile("2g([x])+1/7");
    const g = MathPlus.compile("[x]^2");

    assert.equal(expr, "2[cdot]g([x])+1/7");
    for (const [unknown, acc] of [[2, 36], [3, 220]]) {
        const value = MathPlus.evalRPN(rpn, {g, unknown, acc});
        assert.equal(value.acc, acc);
        assert.equal(value.toString(), MathPlus.calc(expr, {g: "[x]^2", unknown, acc})[0].toString());
    }
});

test("数表 999 点只编译一次各函数体，包括被调用的函数", async () => {
    const {MathPlus, FuncValueListTools} = await createCalcCoreWindow();
    const compiled = [];
    const compile = MathPlus.compile;
    MathPlus.compile = (expr, options) => {
        compiled.push(expr);
        return compile(expr, options);
    };
    const table = FuncValueListTools.valueList("g[x]+1", "[x]^2", 1, 1, 1000);

    assert.deepEqual(compiled, [1, 1, 1000, "g[x]+1", "[x]^2"]);
    assert.equal(table.f[998], "998002");
    assert.equal(table.g[998], "998001");
    assert.equal(table.varList[999], "[print_content_omit]");
});

test("极小复数的模长按可表示的最低指数舍入", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const power = Number.MIN_SAFE_INTEGER;
    const value = MathPlus.abs([[power, 2n], [power, -2n]]);

    assert.equal(value.re.power, power);
    assert.equal(value.re.mantissa, 3n);
    assert.equal(value.onlyReal, true);
});
