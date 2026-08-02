import "dotenv/config";
import mysql from "mysql2/promise";

type BlogRow = {
  id: number;
  url: string;
  title: string | null;
  active_flg: number;
  post_date: string | null;
  remarks: string | null;
};

type PickupMatch = {
  row: BlogRow;
  matchedBy: string[];
  snippet: string;
};

const keyword =
  process.argv
    .find((arg) => arg.startsWith("--keyword="))
    ?.split("=")
    .slice(1)
    .join("=") || "真由";

const activeFlgs = (
  process.argv
    .find((arg) => arg.startsWith("--active-flgs="))
    ?.split("=")[1] || "0,2"
)
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value));

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;
const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="));
const concurrency = Math.max(
  1,
  Math.min(10, Number(concurrencyArg?.split("=")[1] || 4)),
);

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildRssUrl = (blogUrl: string) => {
  const rssUrl = new URL(blogUrl);
  rssUrl.hash = "";
  rssUrl.search = "?xml";
  if (/\/blog-entry-\d+\.html$/i.test(rssUrl.pathname)) {
    rssUrl.pathname = "/";
  }
  return rssUrl.toString();
};

const includesKeyword = (value: unknown) =>
  String(value ?? "").toLowerCase().includes(keyword.toLowerCase());

const extractSnippet = (text: string) => {
  const normalized = decodeHtmlEntities(text);
  const index = normalized.toLowerCase().indexOf(keyword.toLowerCase());
  if (index < 0) {
    return "";
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(normalized.length, index + keyword.length + 90);
  return normalized.slice(start, end);
};

const fetchText = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FC2-Selenium-Pickup/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

const inspectBlog = async (row: BlogRow): Promise<PickupMatch | null> => {
  const matchedBy: string[] = [];
  const localText = `${row.url}\n${row.title ?? ""}\n${row.remarks ?? ""}`;
  let snippet = extractSnippet(localText);

  if (includesKeyword(row.url)) {
    matchedBy.push("url");
  }
  if (includesKeyword(row.title)) {
    matchedBy.push("db-title");
  }
  if (includesKeyword(row.remarks)) {
    matchedBy.push("remarks");
  }

  const targets = [{ label: "blog-page", url: row.url }];
  try {
    targets.push({ label: "rss", url: buildRssUrl(row.url) });
  } catch (error: any) {
    console.warn(`skip rss id=${row.id} ${row.url}: ${error.message}`);
  }

  for (const { label, url } of targets) {
    if (matchedBy.includes(label)) {
      continue;
    }
    try {
      const text = await fetchText(url);
      if (includesKeyword(decodeHtmlEntities(text))) {
        matchedBy.push(label);
        snippet ||= extractSnippet(text);
      }
    } catch (error: any) {
      console.warn(`skip ${label} id=${row.id} ${row.url}: ${error.message}`);
    }
  }

  if (matchedBy.length === 0) {
    return null;
  }

  return {
    row,
    matchedBy,
    snippet,
  };
};

const runLimited = async <T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  let nextIndex = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
};

const pickupMayuBlogs = async () => {
  if (activeFlgs.length === 0) {
    throw new Error("No valid --active-flgs values. Example: --active-flgs=0,2");
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "rootpass",
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE || "seleniumdb",
  });

  try {
    const placeholders = activeFlgs.map(() => "?").join(",");
    const sql = `select id, url, title, active_flg, post_date, remarks from selenium_url_fc2 where active_flg in (${placeholders}) order by active_flg, id`;
    const [rows] = await connection.execute(sql, activeFlgs);
    const targets = (rows as BlogRow[]).slice(0, limit > 0 ? limit : undefined);

    console.log(
      `pickup keyword="${keyword}" active_flg=${activeFlgs.join(",")} targets=${targets.length} concurrency=${concurrency}`,
    );

    const inspected = await runLimited(targets, inspectBlog);
    const matches = inspected.filter(
      (match): match is PickupMatch => match !== null,
    );

    for (const match of matches) {
      console.log(
        [
          `MATCH id=${match.row.id}`,
          `active_flg=${match.row.active_flg}`,
          `post_date=${match.row.post_date ?? ""}`,
          `matched_by=${match.matchedBy.join("+")}`,
          `url=${match.row.url}`,
          `title=${match.row.title ?? ""}`,
        ].join(" "),
      );
      if (match.snippet) {
        console.log(`  snippet: ${match.snippet}`);
      }
    }

    console.log(`matched ${matches.length} / ${targets.length}`);
  } finally {
    await connection.end();
  }
};

pickupMayuBlogs().catch((error) => {
  console.error(error);
  process.exit(1);
});
