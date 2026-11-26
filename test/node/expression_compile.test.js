import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
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

test("字符串函数体跨次求值复用编译结果，变量、精度和函数绑定保持独立", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const root = MathPlus.compile("f([x])+f([x]+1)+g([x])");
    const f = "g([x])+1", g = "[x]^2+1/7";
    const compiledF = MathPlus.compile(f), compiledG = MathPlus.compile(g);
    const compiled = [];
    const compile = MathPlus.compile;
    MathPlus.compile = (expr, options) => {
        compiled.push(expr);
        return compile(expr, options);
    };
    for (const acc of [36, 220, 36]) {
        for (const unknown of [2, -3]) {
            const value = MathPlus.evalRPN(root.rpn, {f, g, unknown, acc});
            const reference = MathPlus.evalRPN(root.rpn, {f: compiledF, g: compiledG, unknown, acc});
            assert.equal(value.toString(), reference.toString());
            assert.equal(value.acc, acc);
        }
    }
    assert.deepEqual(compiled, [f, g]);

    // 已缓存 f 的指令仍须读取新的 g，且不得掩盖未定义函数或递归环。
    const single = compile("f(2)");
    assert.equal(MathPlus.evalRPN(single.rpn, {f, g: "[x]+2"}).toString(), "5");
    assert.throws(() => MathPlus.evalRPN(single.rpn, {f}), /Function g is undefined or cyclically called/);
    assert.throws(() => MathPlus.evalRPN(single.rpn, {f, g: "f([x])"}), /Function f is undefined or cyclically called/);
    assert.equal(MathPlus.evalRPN(single.rpn, {f: "[x]+3"}).toString(), "5");
    assert.equal(MathPlus.evalRPN(single.rpn, {f, g: "[x]+2"}).toString(), "5");
    assert.ok(MathPlus._customFuncCache.size <= 2);
});

test("多个同级括号与嵌套分母在不同变量值下保持指令和回显一致", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const cases = [
        ["(1/2[x])(3[x])", "(1/(2*[x]))*(3*[x])"],
        ["(1/2[x])(3[x])(4[x])", "(1/(2*[x]))*(3*[x])*(4*[x])"],
        ["log(1/2[x],3[x])", "log(1/(2*[x]),3*[x])"],
        ["log(1/2,2[x])", "log(1/2,2*[x])"],
        ["log(2,8/2)(3[x])", "log(2,8/2)*(3*[x])"],
        ["1/2(1/3[x])", "1/(2*(1/(3*[x])))"],
        ["1/2(1/3[x]+1/4[x])", "1/(2*(1/(3*[x])+1/(4*[x])))"],
        ["1/2(1/3[x](1/4[x]))", "1/(2*(1/(3*[x]*(1/(4*[x])))))"],
        ["1/2(1/3[x]", "1/(2*(1/(3*[x])))"],
        ["1/2|1/3[x]", "1/(2*abs(1/(3*[x])))"],
        ["1/2(1/3|[x]", "1/(2*(1/(3*abs([x]))))"],
        ["2)1/2(1/3[x]", "2*1/(2*(1/(3*[x])))"]
    ];
    const instructions = rpn => JSON.stringify(Array.from(rpn, ({operand, method, parameters}) =>
        method ? [method, parameters] : operand));
    for (const [input, reference] of cases) {
        const compiled = MathPlus.compile(input);
        assert.equal(instructions(compiled.rpn), instructions(MathPlus.compile(reference).rpn), input);
        assert.equal(JSON.stringify(compiled.rpn), JSON.stringify(MathPlus.compile(compiled.expr).rpn), input);
        for (const acc of [36, 220]) {
            assert.equal(MathPlus.calc(input, {mode: "syntaxCheck", acc})[1], compiled.expr, input);
            for (const unknown of [2, -3, "[i]"]) {
                const options = {unknown, acc};
                assert.equal(MathPlus.calc(input, options)[0].toString(), MathPlus.calc(reference, options)[0].toString(), input);
                assert.equal(MathPlus.calc(compiled.expr, options)[0].toString(), MathPlus.calc(reference, options)[0].toString(), input);
            }
        }
    }
});

test("极小复数的模长按可表示的最低指数舍入", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const power = Number.MIN_SAFE_INTEGER;
    const value = MathPlus.abs([[power, 2n], [power, -2n]]);

    assert.equal(value.re.power, power);
    assert.equal(value.re.mantissa, 3n);
    assert.equal(value.onlyReal, true);
});

test("Pratt 编译保留规范化文本和前中后缀运算的指令顺序", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const cases = [
        ["sin-2^3", "sin(-2)^3", ["2", "N", "sin", "3", "^"]],
        ["sin2!^3", "sin(2)!^3", ["2", "sin", "!", "3", "^"]],
        ["2^-3^4", "2^(-3^4)", ["2", "3", "4", "^", "N", "^"]],
        ["2^(3)^(4)", "2^(3)^(4)", ["2", "3", "4", "^", "^"]],
        ["2^3^4^5", "2^(3^(4^5))", ["2", "3", "4", "5", "^", "^", "^"]],
        ["1/2sin3", "1/(2[cdot]sin(3))", ["1", "2", "3", "sin", "&", "/"]],
        ["log(2,nroot(16,4))", "log(2,nroot(16,4))", ["2", "16", "4", "nroot", "log"]],
        ["2[degree]^2!", "2[degree]^2!", ["2", "[degree]", "2", "!", "^"]],
        ["[gamma]3", "[gamma](3)", ["3", "[gamma]"]],
        ["2[toPolar]-3E-2", "2[toPolar]-3E-2", ["2", "3", "N", "[toPolar]", "2", "N", "E"]],
        ["2)3", "(2)[cdot]3", ["2", "3", "&"]],
        ["|(2|3|)|", "|(2[cdot]|3|)|", ["2", "3", "A", "&", "A"]],
        // 函数的负参数须完整保留在隐式乘法分母内。
        ["1/2sin-2", "1/(2[cdot]sin(-2))", ["1", "2", "2", "N", "sin", "&", "/"]]
    ];
    for (const [input, expr, instructions] of cases) {
        const compiled = MathPlus.compile(input);
        assert.equal(compiled.expr, expr, input);
        assert.deepEqual(Array.from(compiled.rpn, ({operand, token}) => operand ?? token), instructions, input);
    }
});

test("隐式乘法分母的负参数、负指数和绝对值在规范化后保持语义", async () => {
    const {MathPlus, CalcTools} = await createCalcCoreWindow();
    const cases = JSON.parse(await readFile(new URL("../cases/test_mathplus_calc_normal_cases.json", import.meta.url), "utf8"));
    const regressions = cases.filter(c => c.referenceExpr);
    assert.ok(regressions.length > 0, "缺少隐式乘法分母回归用例");
    for (const c of regressions) {
        const [input, calcAcc, outputAcc] = c.coeffs;
        const options = {calcAcc, outputAcc};
        // 显式乘法与括号独立验证数值；回显重新编译后须保留全部指令。
        assert.equal(CalcTools.exec(c.referenceExpr, options).result, c.expected.result, input);
        const actual = CalcTools.exec(input, options);
        assert.equal(actual.result, c.expected.result, input);
        assert.equal(actual.expr, c.expected.expr, input);
        assert.equal(CalcTools.exec(actual.expr, options).result, c.expected.result, input);
        const compiled = MathPlus.compile(input);
        assert.equal(JSON.stringify(MathPlus.compile(actual.expr).rpn), JSON.stringify(compiled.rpn), input);
        const [placeholder, expr] = MathPlus.calc(input, {mode: "syntaxCheck", acc: calcAcc});
        assert.equal(placeholder.toString(), "0", input);
        assert.equal(placeholder.acc, calcAcc, input);
        assert.equal(expr, c.expected.expr, input);
    }
});

test("绝对值结束前补齐缺失括号，编译、语法检查与求值使用相同语义", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const cases = [
        ["|sin(1/2[x]|+1", "|sin(1/(2[cdot][x]))|+1"],
        ["|sin((1/2[x]|+1", "|sin((1/(2[cdot][x])))|+1"],
        ["||sin(1/2[x]|+1|", "||sin(1/(2[cdot][x]))|+1|"],
        ["|log(2,1/2[x]|+1", "|log(2,1/(2[cdot][x]))|+1"],
        ["|f(1/2[x]|+1", "|f(1/(2[cdot][x]))|+1"]
    ];
    for (const [input, expected] of cases) {
        const compiled = MathPlus.compile(input);
        assert.equal(compiled.expr, expected);
        assert.equal(JSON.stringify(compiled.rpn), JSON.stringify(MathPlus.compile(expected).rpn));
        for (const acc of [36, 220]) {
            const [placeholder, expr] = MathPlus.calc(input, {mode: "syntaxCheck", acc});
            assert.equal(placeholder.toString(), "0");
            assert.equal(placeholder.acc, acc);
            assert.equal(expr, expected);
            for (const unknown of [3, -3]) {
                const options = {unknown, acc, f: "[x]^2+1"};
                const [value, canonical] = MathPlus.calc(input, options);
                assert.equal(canonical, expected);
                assert.equal(value.toString(), MathPlus.calc(expected, options)[0].toString());
                assert.equal(MathPlus.evalRPN(compiled.rpn, options).toString(), value.toString());
            }
        }
    }
});

test("Pratt 编译保留错误名称、位置和不完整表达式的报错顺序", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const cases = [
        ["sin@", "Illegal input (3)."],
        ["1&2", "Illegal input (1)."],
        ["log2", "A prefix binary function must be followed by a left parenthesis (3)."],
        ["|1)", "Absolute value internal parentheses do not match (2)."],
        ["log(2)", "Missing comma in binary function log."],
        ["log(2,)", "Insufficient parameters for function log."],
        ["log(2,3,4)", "Commas mismatch or incorrect position."],
        ["log(2,(3,4))", "Commas mismatch or incorrect position."],
        ["1+*2", "Insufficient parameters for function +."],
        ["sin!2", "Insufficient parameters for function !."],
        ["*-*", "Insufficient parameters for function N."],
        ["2sinsin,", "Commas mismatch or incorrect position."],
        ["sin1+^+", "The parentheses do not match."],
        ["()", "The final stack should have exactly one value."]
    ];
    for (const [input, message] of cases) {
        assert.throws(() => MathPlus.compile(input), {
            name: "ExpressionSyntaxError",
            message: `[MathPlus] syntax error: ${message}`
        }, input);
    }
});

test("Pratt 编译支持一万层括号、前缀函数和右结合幂", async () => {
    const {MathPlus} = await createCalcCoreWindow();
    const count = 10000;
    const brackets = "|sin" + "(".repeat(count) + "1/2[x]|+1";
    assert.equal(MathPlus.compile(brackets).expr,
        "|sin" + "(".repeat(count) + "1/(2[cdot][x])" + ")".repeat(count) + "|+1");
    const prefixes = MathPlus.compile("sin".repeat(count) + "1");
    assert.equal(prefixes.expr, "sin(".repeat(count) + "1" + ")".repeat(count));
    assert.equal(prefixes.rpn.length, count + 1);
    assert.equal(prefixes.rpn[0].operand, "1");
    const powers = MathPlus.compile("1^".repeat(count) + "1");
    assert.equal(powers.rpn.length, 2 * count + 1);
    assert.equal(powers.rpn[count].operand, "1");
    assert.equal(powers.rpn[count + 1].token, "^");
    for (const suffix of [")".repeat(count), ""]) {
        const denominators = MathPlus.compile("1/2(".repeat(count) + "1" + suffix);
        assert.equal(denominators.expr, "1/(2[cdot](".repeat(count) + "1" + "))".repeat(count));
        assert.equal(denominators.rpn.length, 4 * count + 1);
    }
});
