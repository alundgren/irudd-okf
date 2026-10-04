# Stack and distribution findings

Accessed and probed 2026-10-04. Versions below are observed, not future compatibility promises. No application code or release installer was implemented; `probes/` contains a deliberately small build/browser experiment.

## Cloudflare command discovery

Cloudflare's [agent documentation](https://developers.cloudflare.com/cf/agents/) describes local `cf cli search "task"`, bounded command matches, `cf schema ...`, command help and dry-run behavior. JSON results and separated diagnostics support agent use. irudd-okf can use that search/inspect/execute sequence with its own small command registry. This does not require Cloudflare's generated SDK or API infrastructure.

The [launch article](https://blog.cloudflare.com/cloudflare-cf-cli-launch/) was published 2026-09-28. The independently inspected [cf source](https://github.com/cloudflare/cf/tree/1f0303ea605b458c800f0a9b0040f674a8096c3d) uses Vite+ workspace commands. Its workspace catalog pins `vite-plus` to `1.0.0-rc.0`; do not describe that source as already pinned to stable 1.0.0. Cloudflare's public install route is npm. Our standalone binary and curl installer are our distribution design, not a claim that cf already ships that exact arrangement.

## Foldkit and Effect

The npm registry reports `effect@4.0.0`, `@effect/platform-node@4.0.0`, and `@effect/platform-browser@4.0.0` as available. `foldkit@0.165.0` declares exact Effect/browser-adapter 4.0.0 peers. [Foldkit package metadata](https://github.com/foldkit/foldkit/blob/0ec94a178c504827060a5e475200599193b0387e/packages/foldkit/package.json) supports those pins and reports MIT. Its framework is still pre-1.0; pin versions and revalidate upgrades. Older copied examples can differ from the current API.

The installed Effect 4 package exposes `effect/cli`, `effect/http`, `effect/http-api` and `effect/process`. The [Effect 4 CLI implementation](https://github.com/Effect-TS/effect/tree/effect%404.0.0/packages/effect/src/cli) marks its command API unstable despite the stable package release. Recheck module exports and signatures when upgrading. The separately published `@effect/cli@0.77.2` still has Effect 3 peers; do not install it into an all-Effect-4 product.

The probe uses Foldkit's current `Runtime.makeElement` and object-returning updates. Type checking passed. A headless Chromium session loaded the Vite-built page, clicked its button, observed the updated state and recorded no browser errors. This verifies a minimal Foldkit/Effect 4/Vite+ combination. It does not validate a graph, Markdown editor, HTTP RPC, hot reload plugin or production UI.

Registry checks can be reproduced with `npm view foldkit@0.165.0 peerDependencies --json`, `npm view effect@4.0.0 version --json`, and the equivalent platform package commands. Package metadata URLs are [Foldkit](https://registry.npmjs.org/foldkit/0.165.0), [Effect](https://registry.npmjs.org/effect/4.0.0), [Node adapters](https://registry.npmjs.org/@effect%2fplatform-node/4.0.0), and [Vite+](https://registry.npmjs.org/vite-plus/1.0.0).

## Vite+ standalone packaging

[Vite+ pack documentation](https://viteplus.dev/guide/pack) confirms `vp pack` uses tsdown and bundles standalone executable support. [tsdown's executable documentation](https://tsdown.dev/options/exe) describes the experimental option, Node SEA assets, architecture targets and platform signing limitations. [Node SEA documentation](https://nodejs.org/docs/latest-v26.x/api/single-executable-applications.html) explains embedded asset access. Build-time Node must be at least 25.7.0. Vite+ engines exclude the interim Node 25 line, so a pinned supported Node 26 is the straightforward build choice.

The isolated probe used Vite+ 1.0.0 and official Node 26.10.0 on Linux x64. `vp build` built the Foldkit page. The probe inlined its generated JS into its HTML and embedded that file as a SEA asset. The same Vite+ pack entry point built an executable with Effect 4 CLI and Node services included. Running the binary under an otherwise empty environment with `PATH=/nonexistent` returned valid JSON and confirmed embedded viewer HTML. It required no installed Node, npm, vp or Bun at runtime.

Observed artifact size was 151,198,845 bytes, about 151.2 MB before archive compression. This is a meaningful distribution cost, largely including the Node runtime; do not promise a tiny binary. The ELF executable dynamically links to the platform system runtime, so standalone does not mean a static binary that runs on every Linux distribution. Linux glibc minimums need native-runner checks.

The global vp launcher selected the workspace's managed Node 24 despite a PATH override. The successful packaging probe therefore invoked Vite+'s installed `dist/pack-bin.js` through the explicit Node 26 executable. The product build should use a declared `vp env`/CI runtime pin, not assume PATH selection is enough. No global Node runtime or main session setting was changed.

Not checked here: macOS execution, macOS signing/notarization, Linux arm64, install-shell behavior, source builds on a clean Mac, binary compression/startup tuning, or serving all embedded files over HTTP. These are release-stage acceptance requirements. Cross-compilation is available but does not replace native testing. Do not claim macOS support has already been validated.

## Reproducing the small probe

Copy `probes/` into a scratch directory, install its locked dependencies with a supported runtime, type-check, and run `vp build`. Run `python3 inline-web.py` to embed the generated JS in the probe HTML. The exact successful packaging invocation used `/tmp/irudd-okf-node26/bin/node node_modules/vite-plus/dist/pack-bin.js`, followed by `build/okf-feasibility context`. That explicit Node executable was the official 26.10.0 binary. Use an equivalent absolute Node 26 path when reproducing; the normal `vp pack` route also works after verifying vp's managed runtime is Node 26. For a browser check, serve `web-dist` on loopback and verify `Count 0` becomes `Count 1` after a click. The probe is not part of the shipped CLI and should not be mistaken for a product prototype.

The complete product should embed an asset manifest with every JS/CSS/font file rather than assume one HTML file is sufficient. Native release tests must launch the actual executable with no external JS runtime, serve its embedded UI, retrieve data, and save an edit in a temporary bundle. Record all native platform results before claiming support.
