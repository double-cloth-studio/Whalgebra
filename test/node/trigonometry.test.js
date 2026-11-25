import assert from "node:assert/strict";
import test from "node:test";
import {createCalcCoreWindow} from "./helpers/calc_core.js";

test("精确大角度的三角函数不应被相对判零", async (t) => {
    const win = await createCalcCoreWindow();
    // 参考值由 Python Decimal 的 540 位 Chudnovsky π 和泰勒级数独立计算。
    const cases = [
        [32, "0.390197025433363049169761321289342576778380", "-0.920731383924190687598257344029624574623763"],
        [33, "0.762302394952697919888164151088236192746013", "-0.647221027663178564711113268164410705077765"],
        [35, "0.957523800671605157338027311918183083128436", "0.288354245932679400941789595073344870633619"],
        [212, "0.874289895228806043429168069495678828691825", "0.485404139970811694742333938986403645926349"],
        [213, "-0.937345612648617993603167415306887022617241", "-0.348400921997039203074984744123590359015650"],
        [219, "0.636253003851248100909407375377935078862172", "-0.771480469675197720278366348481017374202748"]
    ];

    for (const acc of [36, 220]) {
        for (const [exponent, sin, cos] of cases) {
            await t.test(`${acc} 位精度下的正负 10^${exponent}`, () => {
                for (const sign of [1, -1]) {
                    const input = new win.BigNumber(`${sign}E${exponent}`, {acc});
                    assert.equal(input.noiseMag, -Infinity);

                    for (const [name, expected] of [["sin", sin], ["cos", cos]]) {
                        const actual = win.MathPlus[name](input);
                        const expectedValue = new win.BigNumber(expected, {acc});
                        const signedExpected = name === "sin" && sign < 0
                                               ? win.MathPlus.oppositeNumber(expectedValue)
                                               : expectedValue;
                        assert.equal(actual.acc, acc);
                        assert.equal(actual.toString({acc: 25}), signedExpected.toString({acc: 25}), name);
                    }

                    assert.equal(input.noiseMag, -Infinity);
                    assert.equal(input.toString(), `${sign}E+${exponent}`);
                }
            });
        }
    }
});

test("归约按相位噪声判零并保留可分辨的余角", async () => {
    const win = await createCalcCoreWindow();

    for (const acc of [36, 220]) {
        const precise = new win.BigNumber("1E35", {acc, noiseMag: -50});
        const exact = new win.BigNumber("1E35", {acc});
        for (const name of ["sin", "cos"]) {
            assert.equal(win.MathPlus[name](precise).toString(), win.MathPlus[name](exact).toString());
        }

        const uncertain = new win.BigNumber("1E35", {acc, noiseMag: -1});
        assert.equal(win.MathPlus.sin(uncertain).toString(), "0");
        assert.equal(win.MathPlus.cos(uncertain).toString(), "1");

        for (const expr of ["sin([pi])", "sin(2*[pi])", "sin(-10^10*[pi])", "sin(10^35*[pi])", "cos([pi]/2)"]) {
            assert.equal(win.MathPlus.calc(expr, {acc})[0].toString(), "0", `${acc}: ${expr}`);
        }

        const approximateAngle = win.MathPlus.calc("10^10*[pi]", {acc})[0].re;
        const exactAngle = new win.BigNumber([approximateAngle.power, approximateAngle.mantissa, acc]);
        assert.equal(win.MathPlus.sin(approximateAngle).toString(), "0");
        assert.notEqual(win.MathPlus.sin(exactAngle).toString(), "0");

        const tiny = new win.BigNumber("1E-100", {acc});
        assert.equal(win.MathPlus._toLessThanHalfPi(tiny, "sin")[0].toString(), tiny.toString());
        assert.equal(win.MathPlus.sin(tiny).toString({acc: 25}), "1E-100");
        assert.equal(win.MathPlus.cos(tiny).toString({acc: 25}), "1");
        assert.equal(win.MathPlus.calc("sin(1E35)", {acc})[0].toString({acc: 25}),
            "0.9575238006716051573380273");
    }
});

test("正弦以首个省略项的量级记录截断噪声", async () => {
    const {BigNumber, MathPlus} = await createCalcCoreWindow();
    const angle = new BigNumber("3E-100", {acc: 36});
    const result = MathPlus.sin(angle).re;

    assert.equal(result.toString(), "3E-100");
    // 首个省略项 -x³/6 的绝对值为 4.5E-300。
    assert.equal(result.noiseMag, -300);
});
