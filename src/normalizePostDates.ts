import mysql from "mysql2/promise";

type BlogRow = {
  id: number;
  url: string;
  title: string | null;
  post_date: string | null;
};

const shouldApply = process.argv.includes("--apply");

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatPostDateParts = (
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
) => `${year}/${pad2(month)}/${pad2(day)} ${pad2(hours)}:${pad2(minutes)}`;

const normalizePostDate = (value: unknown) => {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value)
    .trim()
    .replace(/\u3000/g, " ")
    .replace(/(\d)[;\]](\d)/g, "$1:$2")
    .replace(/:+$/, "");
  if (!text) {
    return null;
  }

  const patterns = [
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::\d{1,2})?)?$/,
    /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::\d{1,2})?)?$/,
    /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2})時(\d{1,2})分?)?$/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hours = match[4] === undefined ? 0 : Number(match[4]);
    const minutes = match[5] === undefined ? 0 : Number(match[5]);

    const date = new Date(year, month - 1, day, hours, minutes);
    const isValidDate =
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day &&
      date.getHours() === hours &&
      date.getMinutes() === minutes;

    if (!isValidDate) {
      return null;
    }

    return formatPostDateParts(year, month, day, hours, minutes);
  }

  return null;
};

const normalizeSeleniumUrlFc2PostDates = async () => {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "rootpass",
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE || "seleniumdb",
  });

  try {
    const [rows] = await connection.execute(
      "select id, url, title, post_date from selenium_url_fc2 where post_date is not null and trim(post_date) <> '' order by id",
    );

    let changed = 0;
    let skipped = 0;

    for (const row of rows as BlogRow[]) {
      const normalized = normalizePostDate(row.post_date);
      if (!normalized) {
        skipped++;
        console.warn(
          `skip id=${row.id} post_date="${row.post_date}" title="${row.title ?? ""}"`,
        );
        continue;
      }

      if (normalized === row.post_date) {
        continue;
      }

      changed++;
      console.log(
        `${shouldApply ? "update" : "dry-run"} id=${row.id} "${row.post_date}" -> "${normalized}" ${row.url}`,
      );

      if (shouldApply) {
        await connection.execute(
          "update selenium_url_fc2 set post_date = ? where id = ?",
          [normalized, row.id],
        );
      }
    }

    console.log(
      `${shouldApply ? "updated" : "would update"} ${changed} rows, skipped ${skipped} rows`,
    );
    if (!shouldApply) {
      console.log("Run with -- --apply to update the database.");
    }
  } finally {
    await connection.end();
  }
};

normalizeSeleniumUrlFc2PostDates().catch((error) => {
  console.error(error);
  process.exit(1);
});
