import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium, type Browser } from "playwright";
import type { Concept, RenamePreview } from "../../core/src/contracts.ts";

let server: Server, browser: Browser, origin: string;
const enabled = process.env.OKF_BROWSER_TEST === "1";
const concepts = new Map<string, Concept>();
let forceConflict = false,
  publishAttempts = 0;
let repositoryRoot = "/work/repo/.okf";
let renamePreview: RenamePreview | null = null;
const writes: Array<Record<string, unknown>> = [];
const initialRaw =
  "---\ntype: rule\ntitle: Clean test artifacts\nproducer:\n  unknown: keep-me\n---\n\n# Cleanup\n\nRemove test files. [Related](other.md). [Missing](missing.md). [Nested](nested/). [Query target](other.md?view=1#related).\n\n![Remote image](https://example.invalid/image.png)\n\n<script>window.markdownExecuted = true</script>\n";
const make = (path: string, raw: string, hash = "hash-1"): Concept => ({
  bundle: "repo",
  path,
  title: path === "cleanup.md" ? "Clean test artifacts" : path,
  type: "rule",
  description: "Keep test runs tidy.",
  tags: ["testing"],
  hash,
  malformed: false,
  raw,
  body: raw.replace(/^---\n[\s\S]*?\n---\n/, ""),
  metadata: { type: "rule", producer: { unknown: "keep-me" } },
  diagnostics: [],
  links: [
    { target: "other.md", label: "Related", external: false, broken: false },
    { target: "missing.md", label: "Missing", external: false, broken: true },
  ],
  backlinks:
    path === "cleanup.md" || path === "renamed.md"
      ? [{ bundle: "repo", path: "other.md", title: "Referring document" }]
      : [],
});

beforeAll(async () => {
  if (!enabled) return;
  execFileSync("node_modules/.bin/vp", ["build"], { cwd: process.cwd(), stdio: "pipe" });
  concepts.set("cleanup.md", make("cleanup.md", initialRaw));
  concepts.set(
    "other.md",
    make(
      "other.md",
      "---\ntype: concept\n---\n\n# Related\n\nRelated facts. [Cleanup](cleanup.md).",
    ),
  );
  for (let index = 0; index < 40; index++)
    concepts.set(`rule-${index}.md`, make(`rule-${index}.md`, "---\ntype: rule\n---\n\nA rule."));
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost");
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (url.pathname.startsWith("/api/")) {
        if (req.headers["x-okf-session"] !== "browser-test-session")
          return json(
            { version: 1, error: { code: "session", message: "Wrong capability", details: {} } },
            403,
          );
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        const path = url.searchParams.get("path") ?? "cleanup.md";
        switch (url.pathname) {
          case "/api/context":
            return json({
              version: 1,
              cwd: "/work/repo",
              gitRoot: "/work/repo",
              configPath: "/work/config.json",
              bundles: [
                { name: "repo", root: repositoryRoot, kind: "repository", writable: true },
                { name: "me", root: "/work/personal", kind: "personal", writable: true },
              ],
            });
          case "/api/list":
            return json({
              version: 1,
              concepts: [...concepts.values()].filter((concept) => concept.path !== "index.md"),
            });
          case "/api/index":
            return json(
              concepts.get("index.md") ??
                make("index.md", "# Memory index\n\n[Cleanup](cleanup.md)", ""),
            );
          case "/api/concept":
            if (req.method === "POST" || req.method === "DELETE") {
              writes.push(body);
              const current = concepts.get(body.path);
              if (forceConflict || (body.expectedHash === null && current)) {
                forceConflict = false;
                concepts.set(
                  body.path,
                  make(body.path, `${current?.raw}\nExternal update.`, "hash-external"),
                );
                return json(
                  {
                    version: 1,
                    error: {
                      code: "conflict",
                      message: "The file changed.",
                      details: { currentHash: "hash-external" },
                    },
                  },
                  409,
                );
              }
              if (req.method === "DELETE") concepts.delete(body.path);
              else concepts.set(body.path, make(body.path, body.raw, "hash-saved"));
              return json({
                version: 1,
                bundle: body.bundle,
                path: body.path,
                hash: req.method === "DELETE" ? null : "hash-saved",
                changedPaths: [body.path],
                recoveryPath: req.method === "DELETE" ? "/recovery/deleted.md" : undefined,
              });
            }
            if (path === "nested/index.md")
              return json(make(path, "# Nested authored index\n\nNested navigation."));
            return concepts.has(path)
              ? json(concepts.get(path))
              : json(
                  { version: 1, error: { code: "missing", message: "File missing", details: {} } },
                  404,
                );
          case "/api/rename/preview": {
            const current = concepts.get(body.path)!;
            const referrer = concepts.get("other.md")!;
            renamePreview = {
              version: 1,
              bundle: body.bundle,
              path: body.path,
              newPath: body.newPath,
              previewHash: "reviewed-rename-digest",
              changes: [
                { path: body.path, before: current.raw, after: "" },
                { path: body.newPath, before: "", after: current.raw },
                ...(body.updateLinks
                  ? [
                      {
                        path: "other.md",
                        before: referrer.raw,
                        after: referrer.raw.replaceAll(body.path, body.newPath),
                      },
                    ]
                  : []),
              ],
            };
            return json(renamePreview);
          }
          case "/api/rename": {
            if (!renamePreview || body.previewHash !== renamePreview.previewHash)
              return json(
                {
                  version: 1,
                  error: {
                    code: "REVIEW_REQUIRED",
                    message: "Preview every affected file before renaming.",
                    details: {},
                  },
                },
                409,
              );
            writes.push(body);
            for (const change of renamePreview.changes) {
              if (!change.after) concepts.delete(change.path);
              else concepts.set(change.path, make(change.path, change.after, "hash-renamed"));
            }
            return json({
              version: 1,
              bundle: body.bundle,
              path: body.newPath,
              hash: "hash-renamed",
              changedPaths: renamePreview.changes.map((change) => change.path),
            });
          }
          case "/api/search": {
            const offset = Number(url.searchParams.get("offset") ?? 0),
              limit = 10;
            const results = [...concepts.values()].map((concept) => ({
              ...concept,
              score: 1,
              excerpt: "Keep test runs tidy.",
              matched: ["body"],
            }));
            return json({
              version: 1,
              query: url.searchParams.get("q"),
              results: results.slice(offset, offset + limit),
              total: results.length,
              offset,
              limit,
              truncated: offset + limit < results.length,
            });
          }
          case "/api/graph":
            return json({
              version: 1,
              nodes: [...concepts.values()]
                .filter((concept) => concept.path !== "index.md")
                .slice(0, Number(url.searchParams.get("limit") ?? 80)),
              edges: [
                {
                  from: "repo:cleanup.md",
                  to: "repo:other.md",
                  label: "Related",
                  external: false,
                  broken: false,
                },
                {
                  from: "repo:cleanup.md",
                  to: "repo:missing.md",
                  label: "Missing",
                  external: false,
                  broken: true,
                },
              ],
              truncated: false,
              limit: 80,
            });
          case "/api/validate":
            return json({
              version: 1,
              files: concepts.size,
              errors: 0,
              warnings: 1,
              diagnostics: [
                {
                  level: "warning",
                  code: "broken-link",
                  path: "cleanup.md",
                  message: "Missing target.",
                },
              ],
            });
          case "/api/git/status":
            return json({
              version: 1,
              available: true,
              root: "/work/repo",
              branch: "work",
              remote: "origin",
              files: [{ path: "cleanup.md", status: "M" }],
            });
          case "/api/git/preview":
            return json({
              version: 1,
              token: "preview-token",
              bundle: body.bundle,
              base: "base-commit",
              baseRef: "main",
              repository: "example/repo",
              branch: "memory-edits",
              paths: body.paths,
              diff: "diff --git a/.okf/cleanup.md b/.okf/cleanup.md\n+Keep test runs tidy.",
              expiresAt: new Date(Date.now() + 1800000).toISOString(),
              warnings: [],
            });
          case "/api/git/pr":
            publishAttempts++;
            return publishAttempts === 1
              ? json(
                  {
                    version: 1,
                    error: {
                      code: "gh_missing",
                      message: "GitHub CLI is unavailable.",
                      details: { worktree: "/tmp/prepared-edits" },
                    },
                  },
                  503,
                )
              : json({
                  version: 1,
                  url: "https://github.com/example/repo/pull/1",
                  branch: "memory-edits",
                  worktree: "/tmp/prepared-edits",
                  state: "created",
                });
        }
        return json(
          { version: 1, error: { code: "unknown", message: "Unknown API", details: {} } },
          404,
        );
      }
      if (url.pathname === "/wiki" || url.pathname === "/graph" || url.pathname === "/") {
        res.setHeader("Content-Type", "text/html");
        const html = await readFile("web-dist/index.html", "utf8");
        return res.end(
          html.replace("<head>", '<head><meta name="okf-session" content="browser-test-session">'),
        );
      }
      const asset = await readFile(`web-dist${url.pathname}`);
      res.setHeader(
        "Content-Type",
        url.pathname.endsWith(".js") ? "application/javascript" : "text/css",
      );
      res.end(asset);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.OKF_CHROMIUM_PATH,
  });
}, 30000);
afterAll(async () => {
  if (browser) await browser.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

it.runIf(enabled)(
  "completes reading, paging, preview, conflict, recovery, rename, deletion, graph and publishing retry",
  async () => {
    const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
    const external: string[] = [],
      errors: string[] = [];
    page.on("request", (req) => {
      if (!req.url().startsWith(origin)) external.push(req.url());
    });
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${origin}/wiki?bundle=repo&path=cleanup.md`);
    await page.getByRole("heading", { name: "Clean test artifacts" }).waitFor();
    expect(await page.locator("img").count()).toBe(0);
    expect(await page.evaluate(() => "markdownExecuted" in window)).toBe(false);
    expect(external).toEqual([]);
    const nestedLink = page.locator(".markdown").getByRole("link", { name: "Nested", exact: true });
    expect(await nestedLink.getAttribute("href")).toContain("path=nested%2Findex.md");
    expect(
      await page
        .locator(".markdown")
        .getByRole("link", { name: "Query target", exact: true })
        .getAttribute("href"),
    ).toContain("path=other.md#related");
    await nestedLink.click();
    await page.getByRole("heading", { name: "nested/index.md", exact: true }).waitFor();
    await page
      .locator(".browse")
      .getByRole("link", { name: "Clean test artifacts", exact: true })
      .click();
    await page.getByRole("heading", { name: "Clean test artifacts", exact: true }).waitFor();
    expect(await page.getByText("Missing · missing · missing.md", { exact: true }).count()).toBe(1);
    await page.getByRole("searchbox").fill("cleanup");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("heading", { name: "Search results for “cleanup”" }).waitFor();
    await page.locator(".search-results").getByRole("button", { name: "Next" }).click();
    await page.getByText("11–20 of 42", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Bundle index" }).click();
    await page.getByRole("button", { name: "Save as index" }).click();
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByRole("button", { name: "Save file" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    expect(writes.at(-1)?.expectedHash).toBe(null);
    expect(concepts.has("index.md")).toBe(true);
    await page.locator(".browse").getByRole("link", { name: "Clean test artifacts" }).click();
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await page.locator("svg .graph-edge").waitFor();
    expect(await page.locator("svg .graph-edge").count()).toBe(1);
    expect(
      await page
        .getByText("repo:cleanup.md → Missing · missing · repo:missing.md", { exact: true })
        .count(),
    ).toBe(1);
    await page.screenshot({ path: "/tmp/okf-viewer-linked-graph.png", fullPage: true });
    await page.getByRole("button", { name: "Wiki", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const textarea = page.getByLabel("Raw Markdown, including YAML metadata");
    await textarea.fill(`${initialRaw}\nMy draft.\n`);
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByText("+ My draft.", { exact: false }).waitFor();
    expect(await page.getByText("+ My draft.", { exact: false }).count()).toBeGreaterThan(0);
    forceConflict = true;
    await page.getByRole("button", { name: "Save file" }).click();
    await page.getByRole("heading", { name: "The file changed since you opened it" }).waitFor();
    expect(await page.locator(".compare").textContent()).toContain("External update.");
    expect(await page.locator(".compare").textContent()).toContain("My draft.");
    await page.getByRole("button", { name: "Continue with draft" }).click();
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByRole("button", { name: "Save file" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    expect(writes.at(-1)?.expectedHash).toBe("hash-external");
    expect(writes.at(-1)?.authorizePersonal).toBe(true);
    expect(concepts.get("cleanup.md")?.raw).toContain("unknown: keep-me");
    await page.getByRole("button", { name: "Add concept" }).click();
    await page.getByLabel("File path within bundle").fill("other.md");
    await page
      .getByLabel("Raw Markdown, including YAML metadata")
      .fill("---\ntype: concept\n---\n\nA conflicting new concept.");
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByRole("button", { name: "Save file" }).click();
    await page.getByRole("heading", { name: "The file changed since you opened it" }).waitFor();
    expect(await page.locator(".compare").textContent()).toContain("Related facts.");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Discard and continue" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await textarea.fill(`${concepts.get("cleanup.md")!.raw}\nRecovered text.\n`);
    await page.route("**/api/validate*", (route) => route.abort("connectionrefused"));
    await page.getByRole("button", { name: "Check bundle" }).click();
    await page.getByRole("button", { name: "Reload viewer" }).waitFor();
    expect(await textarea.inputValue()).toContain("Recovered text.");
    await page.unroute("**/api/validate*");
    await page.reload();
    await page.getByRole("button", { name: "Recover draft" }).waitFor();
    await page.getByRole("button", { name: "Recover draft" }).click();
    expect(await textarea.inputValue()).toContain("Recovered text.");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Discard and continue" }).click();
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await page.getByLabel("New file path").fill("renamed.md");
    const beforeRename = writes.length;
    await page.route("**/api/rename/preview", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          error: {
            code: "PREVIEW_FAILED",
            message: "The rename preview could not be prepared.",
            details: {},
          },
        }),
      }),
    );
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByText("The rename preview could not be prepared.", { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Rename file" }).count()).toBe(0);
    expect(writes.length).toBe(beforeRename);
    await page.unroute("**/api/rename/preview");
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByRole("button", { name: "Rename file" }).waitFor();
    expect(writes.length).toBe(beforeRename);
    expect(await page.locator(".rename-changes summary").allTextContents()).toEqual([
      "cleanup.md",
      "renamed.md",
      "other.md",
    ]);
    expect(await page.locator(".rename-changes").textContent()).toContain("[Cleanup](renamed.md)");
    await page.getByRole("button", { name: "Rename file" }).click();
    expect(writes.at(-1)?.previewHash).toBe("reviewed-rename-digest");
    await page.getByRole("heading", { name: "renamed.md", exact: true }).waitFor();
    expect(concepts.has("cleanup.md")).toBe(false);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByRole("button", { name: "Delete file" }).waitFor();
    expect(await page.locator(".delete-referrers").textContent()).toContain("other.md");
    expect(await page.locator(".delete-referrers").textContent()).toContain(
      "pointing to a missing file",
    );
    await page.getByRole("button", { name: "Delete file" }).click();
    await page.getByRole("heading", { name: "index.md", exact: true }).waitFor();
    expect(concepts.has("renamed.md")).toBe(false);
    await page.getByRole("button", { name: "Add concept" }).click();
    await page.getByLabel("File path within bundle").fill("new.md");
    await textarea.fill("---\ntype: concept\n---\n\nA new fact.");
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByRole("button", { name: "Save file" }).click();
    await page.getByRole("heading", { name: "new.md", exact: true }).waitFor();
    expect(writes.at(-1)?.expectedHash).toBe(null);
    await page.getByRole("button", { name: "Add concept" }).click();
    await page.getByLabel("File path within bundle").fill("unsaved-new.md");
    await textarea.fill("---\ntype: concept\n---\n\nNew draft recovery.");
    await page.reload();
    await page.getByRole("button", { name: "Recover draft" }).click();
    expect(await page.getByLabel("File path within bundle").inputValue()).toBe("unsaved-new.md");
    expect(await textarea.inputValue()).toContain("New draft recovery.");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Discard and continue" }).click();
    await page.locator(".browse").getByRole("button", { name: "Next" }).click();
    await page.locator(".browse").getByRole("link", { name: "new.md", exact: true }).click();
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await page.locator("svg .graph-node").first().waitFor();
    expect(new URL(page.url()).pathname).toBe("/graph");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "←", exact: true }).click();
    expect(await page.locator("svg > g").getAttribute("transform")).toContain("scale(1.25)");
    expect(await page.locator(".graph-list li").count()).toBe(concepts.size - 1);
    await page.screenshot({ path: "/tmp/okf-viewer-graph.png", fullPage: true });
    await page.getByRole("button", { name: "Review changes" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Preview selected changes" }).click();
    await page.getByRole("button", { name: "Create pull request" }).waitFor();
    expect(await page.locator(".submission").textContent()).toContain(
      "example/repo, base branch main",
    );
    expect(publishAttempts).toBe(0);
    await page.getByRole("button", { name: "Create pull request" }).click();
    await page.getByRole("button", { name: "Retry pull request" }).waitFor();
    await page.getByRole("button", { name: "Retry pull request" }).click();
    await page.getByRole("link", { name: "Open pull request" }).waitFor();
    expect(publishAttempts).toBe(2);
    await page.screenshot({ path: "/tmp/okf-viewer-review.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Wiki", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: "/tmp/okf-viewer-mobile.png", fullPage: true });
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.close();
  },
  60000,
);

it.runIf(enabled)(
  "keeps recovered drafts inside the canonical bundle root when the same server address is reused",
  async () => {
    const page = await browser.newPage();
    repositoryRoot = "/work/repository-A/.okf";
    await page.goto(`${origin}/wiki?bundle=repo&path=other.md`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByLabel("Raw Markdown, including YAML metadata")
      .fill("---\ntype: rule\n---\n\nRepository A private draft.");
    repositoryRoot = "/work/repository-B/.okf";
    await page.reload();
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Recover draft" }).count()).toBe(0);
    expect(await page.locator("body").textContent()).not.toContain("Repository A private draft.");
    expect(await page.locator(".scope-detail").textContent()).toContain("/work/repository-B/.okf");
    repositoryRoot = "/work/repository-A/.okf";
    await page.reload();
    await page.getByRole("button", { name: "Recover draft" }).click();
    expect(await page.getByLabel("Raw Markdown, including YAML metadata").inputValue()).toContain(
      "Repository A private draft.",
    );
    await page.close();
    repositoryRoot = "/work/repo/.okf";
  },
);
