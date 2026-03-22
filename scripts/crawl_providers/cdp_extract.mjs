import { chromium } from "playwright-core";

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = value;
    index += 1;
  }
  return out;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value, limit) {
  const text = cleanText(value);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function buildMarkdown(url, title, summary, content) {
  const lines = [];
  if (title) {
    lines.push(`# ${title}`);
    lines.push("");
  }
  lines.push(`Source: ${url}`);
  lines.push("");
  if (summary) {
    lines.push(summary);
    lines.push("");
  }
  if (content) {
    lines.push(content);
  }
  return lines.join("\n").trim();
}

async function extractPage(page) {
  return page.evaluate(() => {
    const toText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const title =
      toText(document.querySelector("meta[property='og:title']")?.getAttribute("content")) ||
      toText(document.querySelector("title")?.textContent) ||
      toText(document.querySelector("h1")?.textContent);
    const summary =
      toText(document.querySelector("meta[name='description']")?.getAttribute("content")) ||
      toText(document.querySelector("meta[property='og:description']")?.getAttribute("content"));
    const article =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector("[role='main']") ||
      document.body;
    const content = toText(article?.innerText || document.body?.innerText || "");
    return {
      title,
      summary,
      content,
      canonicalUrl:
        toText(document.querySelector("link[rel='canonical']")?.getAttribute("href")) ||
        window.location.href,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cdpUrl = cleanText(args["cdp-url"]);
  const url = cleanText(args.url);
  if (!cdpUrl || !url) {
    throw new Error("Both --cdp-url and --url are required");
  }

  const browser = await chromium.connectOverCDP(cdpUrl);
  let createdContext = null;
  const context = browser.contexts()[0] ?? (createdContext = await browser.newContext());
  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForLoadState("networkidle", {
      timeout: 8000,
    }).catch(() => {});

    const extracted = await extractPage(page);
    const title = cleanText(extracted.title);
    const summary = truncate(extracted.summary || extracted.content, 480);
    const content = truncate(extracted.content, 12000);
    const canonicalUrl = cleanText(extracted.canonicalUrl) || url;
    const markdown = buildMarkdown(canonicalUrl, title, summary, content);
    process.stdout.write(
      JSON.stringify({
        provider: cleanText(args.provider) || "steel",
        url: canonicalUrl,
        summary,
        content,
        markdown,
        metadata: {
          title,
          provider: cleanText(args.provider) || "steel",
          cdpUrl,
        },
      }),
    );
  } finally {
    await page.close().catch(() => {});
    if (createdContext) {
      await createdContext.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  const message = cleanText(error?.stack || error?.message || error);
  process.stderr.write(message ? `${message}\n` : "unknown cdp extract error\n");
  process.exit(1);
});
