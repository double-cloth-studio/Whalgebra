import assert from "node:assert/strict";
import test from "node:test";
import {createCalcCoreWindow} from "./helpers/calc_core.js";

test("接近对称的四次多项式开方舍入时保留四个纯实根", async () => {
    const {BigNumber, CalcConfig, PowerFunctionTools} = await createCalcCoreWindow();
    CalcConfig.globalCalcAccuracy = 20;
    // (x²-4)(x²-10⁻¹³x-16) 的四个根均为实数。
    const coeffs = ["1", "-1E-13", "-20", "4E-13", "64"].map((value) => new BigNumber(value));
    const roots = PowerFunctionTools._solveQuartic(coeffs);

    assert.ok(roots.every((root) => root.onlyReal));
    assert.deepEqual(Array.from(roots, (root) => root.re.toString({acc: 12})), ["4", "-4", "2", "-2"]);
});
