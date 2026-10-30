// Bundles the extension host (Node, CJS) and each webview (browser, IIFE) into dist/.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

const builds = [
  {
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node18",
    external: ["vscode", "bufferutil", "utf-8-validate"],
  },
  ...["vnc", "webgui", "control"].map((name) => ({
    ...common,
    entryPoints: [`webview/${name}/main.ts`],
    outfile: `dist/webview/${name}.js`,
    platform: "browser",
    format: "iife",
    target: "es2022",
  })),
];

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
