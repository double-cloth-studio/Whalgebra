import assert from "node:assert/strict";
import {mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {reverseBuild} from "../../tools/cli/reverse_build.js";
import {temporaryDirectory} from "./helpers/temp_directory.js";

test("逆向构建会提取有效的内联 CSS 和 JavaScript", async (t) => {
    const directory = await temporaryDirectory(t);
    const inputFile = path.join(directory, "single.html");
    const outputDir = path.join(directory, "output");
    await writeFile(inputFile, `<!doctype html>
<html><head>
    <style id="theme" media="screen">
        body { color: red; }
    </style>
    <style id="theme">p { margin: 0; }</style>
    <script src="./external.js"></script>
    <script type="application/json">{"skip": true}</script>
    <script id="app" type="module">
        const template = '<style id="not-a-tag">.ignored { color: blue; }</style>';
        console.log("ok");
    </script>
</head><body></body></html>`, "utf8");
    await mkdir(outputDir);
    await writeFile(path.join(outputDir, "old.txt"), "旧产物", "utf8");

    const result = await reverseBuild({
        inputFile, outputDir, force: true, logger: () => {
        }
    });
    assert.equal(result.cssCount, 2);
    assert.equal(result.jsCount, 1);
    assert.deepEqual((await readdir(directory)).sort(), ["output", "single.html"]);
    assert.deepEqual((await readdir(outputDir)).sort(), [".nojekyll", "css", "index.html", "js"]);
    assert.deepEqual((await readdir(path.join(outputDir, "css"))).sort(), ["theme.css", "theme_1.css"]);
    assert.deepEqual(await readdir(path.join(outputDir, "js")), ["app.js"]);
    assert.equal(await readFile(path.join(outputDir, "css", "theme.css"), "utf8"), "body { color: red; }");

    const html = await readFile(path.join(outputDir, "index.html"), "utf8");
    assert.match(html, /<link rel="stylesheet" href="\.\/css\/theme\.css" media="screen">/u);
    assert.match(html, /<script src="\.\/external\.js"><\/script>/u);
    assert.match(html, /<script type="application\/json">\{"skip": true\}<\/script>/u);
    assert.match(html, /src="\.\/js\/app\.js"/u);
    assert.equal((await readFile(path.join(outputDir, "js", "app.js"), "utf8")).replaceAll("\r\n", "\n"), `const template = '<style id="not-a-tag">.ignored { color: blue; }</style>';
console.log("ok");`);
});

test("强制逆向构建在输入无效或提取失败时保留旧产物", async (t) => {
    const directory = await temporaryDirectory(t);
    const inputDir = path.join(directory, "input-dir");
    const inputFile = path.join(directory, "single.html");
    const outputDir = path.join(directory, "output");
    const oldFile = path.join(outputDir, "index.html");
    await mkdir(inputDir);
    await mkdir(outputDir);
    await writeFile(oldFile, "旧产物", "utf8");
    await writeFile(inputFile, `<style>body{}</style><script id="${"a".repeat(300)}">true;</script>`, "utf8");

    const options = {outputDir, force: true, logger: () => {}};
    await assert.rejects(reverseBuild({...options, inputFile: path.join(directory, "missing.html")}), {
        code: "INPUT_NOT_FOUND"
    });
    await assert.rejects(reverseBuild({...options, inputFile: inputDir}), {code: "INVALID_INPUT_FILE"});
    await assert.rejects(reverseBuild({...options, inputFile}), {syscall: "open"});

    assert.equal(await readFile(oldFile, "utf8"), "旧产物");
    assert.deepEqual(await readdir(outputDir), ["index.html"]);
    assert.deepEqual((await readdir(directory)).sort(), ["input-dir", "output", "single.html"]);
});

test("逆向构建拒绝可能清理输入数据的输出路径", async (t) => {
    const directory = await temporaryDirectory(t);
    const inputFile = path.join(directory, "inside.html");
    await writeFile(inputFile, "<style>body{}</style>", "utf8");

    await assert.rejects(
        reverseBuild({
            inputFile, outputDir: directory, force: true, logger: () => {
            }
        }),
        {code: "UNSAFE_OUTPUT"}
    );
});
