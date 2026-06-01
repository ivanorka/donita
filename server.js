const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dataDir = path.join(root, "data");
const submissionsPath = path.join(dataDir, "contact-submissions.jsonl");

loadEnvFile();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function loadEnvFile() {
  try {
    const contents = fsSync.readFileSync(path.join(root, ".env"), "utf8");
    contents.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
  } catch {}
}

function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("hr-HR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeEntities(String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

async function loadPrices() {
  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const cards = [];
  const cardPattern = /<article class="price-card" data-category="([^"]+)">([\s\S]*?)<\/article>/g;
  let cardMatch;

  while ((cardMatch = cardPattern.exec(html))) {
    const [, category, cardHtml] = cardMatch;
    const title = stripTags(cardHtml.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] || "");
    const items = [];
    const itemPattern = /<li><span>([\s\S]*?)<\/span><strong>([\s\S]*?)<\/strong><\/li>/g;
    let itemMatch;

    while ((itemMatch = itemPattern.exec(cardHtml))) {
      items.push({
        name: stripTags(itemMatch[1]),
        price: stripTags(itemMatch[2]),
      });
    }

    cards.push({ category, title, items });
  }

  return cards;
}

let priceCache;

async function searchPrices(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const query = normalize(url.searchParams.get("q"));
  const category = url.searchParams.get("category");
  priceCache ||= await loadPrices();

  const results = priceCache
    .filter((card) => !category || category === "all" || card.category === category)
    .map((card) => {
      const searchable = normalize([
        card.category,
        card.title,
        ...card.items.flatMap((item) => [item.name, item.price]),
      ].join(" "));

      return { card, searchable };
    })
    .filter(({ searchable }) => !query || searchable.includes(query))
    .map(({ card }) => card);

  sendJson(response, 200, { query, count: results.length, results });
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      throw new Error("Zahtjev je prevelik.");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function saveContact(request, response) {
  let payload;

  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch {
    sendJson(response, 400, { message: "Podaci nisu ispravno poslani." });
    return;
  }

  const submission = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    name: String(payload.name || "").trim(),
    phone: String(payload.phone || "").trim(),
    email: String(payload.email || "").trim(),
    message: String(payload.message || "").trim(),
  };

  if (!submission.name || !submission.phone) {
    sendJson(response, 422, { message: "Molimo upišite ime i telefon." });
    return;
  }

  if (submission.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.email)) {
    sendJson(response, 422, { message: "Email adresa nije ispravna." });
    return;
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.appendFile(submissionsPath, `${JSON.stringify(submission)}\n`, "utf8");

  const mailResult = await sendContactEmail(submission);
  sendJson(response, 201, {
    message: mailResult.sent
      ? "Hvala, upit je zaprimljen i poslan."
      : "Upit je spremljen lokalno. Email slanje još nije konfigurirano.",
    submissionId: submission.id,
    emailSent: mailResult.sent,
    emailConfigured: mailResult.configured,
  });
}

async function sendContactEmail(submission) {
  const configured = Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.MAIL_TO
  );

  if (!configured) {
    return { configured: false, sent: false };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    console.warn("nodemailer nije instaliran. Pokreni npm install za slanje emaila.");
    return { configured: true, sent: false };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const replyTo = submission.email || undefined;
  const subject = `Donita upit: ${submission.name}`;
  const text = [
    "Novi upit s Donita web stranice",
    "",
    `Ime: ${submission.name}`,
    `Telefon: ${submission.phone}`,
    `Email: ${submission.email || "-"}`,
    "",
    "Napomena:",
    submission.message || "-",
    "",
    `Zaprimljeno: ${submission.createdAt}`,
  ].join("\n");

  try {
    await transporter.sendMail({
      from,
      to: process.env.MAIL_TO,
      replyTo,
      subject,
      text,
    });
    return { configured: true, sent: true };
  } catch (error) {
    console.error("Email slanje nije uspjelo:", error);
    return { configured: true, sent: false };
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(root, `.${requestedPath}`);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/search") {
      await searchPrices(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/contact") {
      await saveContact(request, response);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { message: "Metoda nije podržana." });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { message: "Došlo je do greške na serveru." });
  }
});

server.listen(port, () => {
  console.log(`Donita server running at http://localhost:${port}/`);
});
