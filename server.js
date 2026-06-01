const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dataDir = path.join(root, "data");
const submissionsPath = path.join(dataDir, "contact-submissions.jsonl");
const adminUser = "Ivan";
const adminPass = "Donita123*";
const sessions = new Set();

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

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separator = cookie.indexOf("=");
        return separator === -1
          ? [cookie, ""]
          : [cookie.slice(0, separator), decodeURIComponent(cookie.slice(separator + 1))];
      })
  );
}

function isAdmin(request) {
  const token = parseCookies(request).donita_admin;
  return Boolean(token && sessions.has(token));
}

function sendAuthRequired(response) {
  sendJson(response, 401, { message: "Potrebna je prijava." });
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

  let submission = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    name: String(payload.name || "").trim(),
    phone: String(payload.phone || "").trim(),
    email: String(payload.email || "").trim(),
    message: String(payload.message || "").trim(),
    emails: [],
  };

  if (!submission.name || !submission.phone) {
    sendJson(response, 422, { message: "Molimo upišite ime i telefon." });
    return;
  }

  if (!submission.email) {
    sendJson(response, 422, { message: "Molimo upišite email adresu." });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.email)) {
    sendJson(response, 422, { message: "Email adresa nije ispravna." });
    return;
  }

  const mailResult = await sendContactEmails(submission);
  submission = { ...submission, emails: mailResult.emails };

  await appendSubmission(submission);
  sendJson(response, 201, {
    message: mailResult.allSent
      ? "Hvala, upit je zaprimljen i poslan."
      : "Upit je spremljen lokalno. Email slanje još nije konfigurirano.",
    submissionId: submission.id,
    emailSent: mailResult.allSent,
    emailConfigured: mailResult.configured,
  });
}

async function appendSubmission(submission) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.appendFile(submissionsPath, `${JSON.stringify(submission)}\n`, "utf8");
}

async function readSubmissions() {
  try {
    const contents = await fs.readFile(submissionsPath, "utf8");
    return contents
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch {
    return [];
  }
}

async function sendContactEmails(submission) {
  const configured = Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.MAIL_TO
  );

  if (!configured) {
    return {
      configured: false,
      allSent: false,
      emails: [
        { type: "salon", to: process.env.MAIL_TO || "", sent: false, error: "SMTP nije konfiguriran." },
        { type: "client", to: submission.email || "", sent: false, error: "SMTP nije konfiguriran." },
      ],
    };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    console.warn("nodemailer nije instaliran. Pokreni npm install za slanje emaila.");
    return {
      configured: true,
      allSent: false,
      emails: [
        { type: "salon", to: process.env.MAIL_TO, sent: false, error: "nodemailer nije instaliran." },
        { type: "client", to: submission.email || "", sent: false, error: "nodemailer nije instaliran." },
      ],
    };
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
  const salonText = [
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
  const clientText = [
    `Poštovani/a ${submission.name},`,
    "",
    "hvala na upitu za Kozmetički centar Donita.",
    "Vaša poruka je zaprimljena i javit ćemo Vam se uskoro radi potvrde termina ili dodatnih informacija.",
    "",
    "Srdačan pozdrav,",
    "Kozmetički centar Donita",
    "Vinogradska 2b, Zagreb",
    "Tel. 01 / 37 05 027",
    "Mob. 091 531 66 98",
  ].join("\n");

  const emails = [];

  emails.push(
    await sendMailSafely(transporter, {
      type: "salon",
      from,
      to: process.env.MAIL_TO,
      replyTo,
      subject: `Donita upit: ${submission.name}`,
      text: salonText,
    })
  );

  if (submission.email) {
    emails.push(
      await sendMailSafely(transporter, {
        type: "client",
        from,
        to: submission.email,
        subject: "Donita: Vaš upit je zaprimljen",
        text: clientText,
      })
    );
  } else {
    emails.push({ type: "client", to: "", sent: false, error: "Klijent nije upisao email." });
  }

  const allSent = emails.every((email) => email.sent);

  return {
    configured: true,
    allSent,
    emails,
  };
}

async function sendMailSafely(transporter, mail) {
  try {
    await transporter.sendMail({
      from: mail.from,
      to: mail.to,
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
    });
    return {
      type: mail.type,
      to: mail.to,
      subject: mail.subject,
      sent: true,
      sentAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Email slanje nije uspjelo:", error);
    return {
      type: mail.type,
      to: mail.to,
      subject: mail.subject,
      sent: false,
      error: error.message,
    };
  }
}

async function loginAdmin(request, response) {
  let payload;

  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch {
    sendJson(response, 400, { message: "Podaci nisu ispravno poslani." });
    return;
  }

  if (payload.username !== adminUser || payload.password !== adminPass) {
    sendJson(response, 401, { message: "Neispravno korisničko ime ili lozinka." });
    return;
  }

  const token = randomUUID();
  sessions.add(token);
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": `donita_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
  });
  response.end(JSON.stringify({ message: "Prijava uspješna." }));
}

async function logoutAdmin(request, response) {
  const token = parseCookies(request).donita_admin;
  if (token) sessions.delete(token);
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": "donita_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  });
  response.end(JSON.stringify({ message: "Odjavljeni ste." }));
}

async function getAdminSubmissions(request, response) {
  if (!isAdmin(request)) {
    sendAuthRequired(response);
    return;
  }

  sendJson(response, 200, { submissions: await readSubmissions() });
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

    if (request.method === "POST" && url.pathname === "/api/contact") {
      await saveContact(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/login") {
      await loginAdmin(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/logout") {
      await logoutAdmin(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/submissions") {
      await getAdminSubmissions(request, response);
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
