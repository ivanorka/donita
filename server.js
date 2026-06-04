const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dataDir = path.join(root, "data");
const submissionsPath = path.join(dataDir, "contact-submissions.jsonl");
const defaultMailTo = "ilozancic@gmail.com";
const redirects = new Map([
  ["/admin.html", "/"],
  ["/blog", "/blog/"],
  ["/contact/", "/#kontakt"],
  ["/o-nama/", "/#top"],
  ["/about/", "/#top"],
  ["/cjenik/", "/#cjenik"],
  ["/category/cjenik/", "/#cjenik"],
  ["/klasicni-tretmani-lica/", "/blog/tretmani-lica.html"],
  ["/specijalni-tretmani-za-lice/", "/blog/tretmani-lica.html"],
  ["/tretmani-lica/", "/blog/tretmani-lica.html"],
  ["/klasicni-tretmani-tijela/", "/blog/tretmani-tijela.html"],
  ["/anticelulitni-tretmani/", "/blog/tretmani-tijela.html"],
  ["/maderoterapija/", "/blog/maderoterapija-i-oblikovanje.html"],
  ["/oblikovanje-tijela/", "/blog/maderoterapija-i-oblikovanje.html"],
  ["/tretmani-trajna-sminka/", "/blog/trajna-sminka.html"],
  ["/trajna-sminka/", "/blog/trajna-sminka.html"],
  ["/priprema-za-trajnu-sminku/", "/blog/priprema-za-trajnu-sminku.html"],
  ["/njega-koze/", "/blog/kako-odabrati-tretman.html"],
  ["/njega-koze-nakon-tretmana/", "/blog/rutina-nakon-tretmana.html"],
  ["/tretmani-za-ruke-i-nokte/", "/blog/ruke-stopala.html"],
  ["/tretmani-za-stopala/", "/blog/ruke-stopala.html"],
  ["/category/onama/", "/#top"],
  ["/1650-2/", "/#top"],
]);

loadEnvFile();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
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

function getSmtpStatus() {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((key) => !process.env[key]);

  return {
    configured: missing.length === 0,
    missing,
    host: process.env.SMTP_HOST || "",
    port: process.env.SMTP_PORT || "",
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    user: process.env.SMTP_USER || "",
    mailTo: process.env.MAIL_TO || defaultMailTo,
    mailFrom: process.env.MAIL_FROM || process.env.SMTP_USER || "",
  };
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
      ? "Hvala, upit je zaprimljen. Javit ćemo Vam se uskoro."
      : "Upit je zaprimljen, ali email slanje trenutno nije uspjelo. Molimo nazovite salon ako je hitno.",
    submissionId: submission.id,
    emailSent: mailResult.allSent,
    emailConfigured: mailResult.configured,
  });
}

async function appendSubmission(submission) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.appendFile(submissionsPath, `${JSON.stringify(submission)}\n`, "utf8");
}

async function sendContactEmails(submission) {
  const smtpStatus = getSmtpStatus();

  if (!smtpStatus.configured) {
    return {
      configured: false,
      allSent: false,
      emails: [
        {
          type: "salon",
          to: smtpStatus.mailTo,
          sent: false,
          error: `SMTP nije konfiguriran. Nedostaje: ${smtpStatus.missing.join(", ")}`,
        },
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
        { type: "salon", to: smtpStatus.mailTo, sent: false, error: "nodemailer nije instaliran." },
      ],
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtpStatus.host,
    port: Number(smtpStatus.port),
    secure: smtpStatus.secure,
    auth: {
      user: smtpStatus.user,
      pass: process.env.SMTP_PASS,
    },
  });

  const from = smtpStatus.mailFrom;
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
  const emails = [];

  emails.push(
    await sendMailSafely(transporter, {
      type: "salon",
      from,
      to: smtpStatus.mailTo,
      replyTo,
      subject: `Donita upit: ${submission.name}`,
      text: salonText,
    })
  );

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

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const redirectTarget =
    redirects.get(url.pathname) ||
    (url.pathname.startsWith("/category/cjenik/") ? "/#cjenik" : "") ||
    (url.pathname.startsWith("/category/onama/") ? "/#top" : "");

  if (redirectTarget) {
    response.writeHead(301, { Location: redirectTarget });
    response.end();
    return;
  }

  const requestedPath =
    url.pathname === "/"
      ? "/index.html"
      : url.pathname.endsWith("/")
        ? `${decodeURIComponent(url.pathname)}index.html`
        : decodeURIComponent(url.pathname);
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
