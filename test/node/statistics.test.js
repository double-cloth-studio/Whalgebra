import assert from "node:assert/strict";
import test from "node:test";
import {createCalcCoreWindow} from "./helpers/calc_core.js";

test("全零因变量仍需满足回归定义域及参数唯一性", async (t) => {
    const win = await createCalcCoreWindow();
    const models = ["linear", "square", "ln", "reciprocal", "exp", "abx", "axb"];
    const cases = [
        {name: "正数常量自变量", a: [2, 2, 2], valid: []},
        {name: "负数常量自变量", a: [-2, -2, -2], valid: []},
        {name: "全零自变量", a: [0, 0, 0], valid: []},
        {name: "等值表达式自变量", a: ["2", "1+1", "4/2"], valid: []},
        {name: "仅两个不同取值的重复样本", a: [1, 1, 2, 2], valid: ["linear", "ln", "reciprocal"]},
        {name: "两个样本", a: [1, 2], valid: ["linear", "ln", "reciprocal"]},
        {name: "三个不同正数", a: [1, 2, 3], valid: ["linear", "square", "ln", "reciprocal"]},
        {name: "含零和负数", a: [-1, 0, 1], valid: ["linear", "square"]},
        {name: "负数样本", a: [-3, -2, -1], valid: ["linear", "square", "reciprocal"]},
        {name: "单个样本", a: [2], valid: []}
    ];

    for (const {name, a, valid} of cases) {
        await t.test(name, () => {
            const b = a.map(() => "0");
            const originalA = [...a];
            const originalB = [...b];
            const result = win.StatisticsTools.statisticsCalc(a, b);

            for (const model of models) {
                const expected = valid.includes(model) ? "0" : "error";
                const actual = result[model];
                assert.deepEqual(Array.from(actual.parameter), Array(model === "square" ? 3 : 2).fill(expected), model);
                assert.equal(actual.regressionEquation, expected, model);
                assert.equal(actual.R2, "error", model);
                assert.equal(actual.model, model);
            }

            assert.equal(result.bestModel, "linear");
            assert.equal(result.averageB, "0");
            assert.equal(result.sumB, "0");
            assert.equal(result.r, "error");
            assert.deepEqual(a, originalA);
            assert.deepEqual(b, originalB);
        });
    }
});
