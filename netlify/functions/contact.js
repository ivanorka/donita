const nodemailer = require("nodemailer");

const defaultMailTo = "ilozancic@gmail.com";

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
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

function normalizePayload(body) {
  const payload = JSON.parse(body || "{}");
  return {
    createdAt: new Date().toISOString(),
    name: String(payload.name || "").trim(),
    phone: String(payload.phone || "").trim(),
    email: String(payload.email || "").trim(),
    message: String(payload.message || "").trim(),
  };
}

async function sendContactEmail(submission) {
  const smtpStatus = getSmtpStatus();

  if (!smtpStatus.configured) {
    return {
      configured: false,
      sent: false,
      error: `SMTP nije konfiguriran. Nedostaje: ${smtpStatus.missing.join(", ")}`,
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

  const text = [
    "Novi upit s Donita web stranice",
    "",
    `Ime: ${submission.name}`,
    `Telefon: ${submission.phone}`,
    `Email: ${submission.email}`,
    "",
    "Napomena:",
    submission.message || "-",
    "",
    `Zaprimljeno: ${submission.createdAt}`,
  ].join("\n");

  await transporter.sendMail({
    from: smtpStatus.mailFrom,
    to: smtpStatus.mailTo,
    replyTo: submission.email,
    subject: `Donita upit: ${submission.name}`,
    text,
  });

  return {
    configured: true,
    sent: true,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { message: "Metoda nije podržana." });
  }

  let submission;
  try {
    submission = normalizePayload(event.body);
  } catch {
    return json(400, { message: "Podaci nisu ispravno poslani." });
  }

  if (!submission.name || !submission.phone) {
    return json(422, { message: "Molimo upišite ime i telefon." });
  }

  if (!submission.email) {
    return json(422, { message: "Molimo upišite email adresu." });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.email)) {
    return json(422, { message: "Email adresa nije ispravna." });
  }

  try {
    const mail = await sendContactEmail(submission);

    if (!mail.sent) {
      return json(503, {
        message: "Upit je zaprimljen, ali email slanje trenutno nije konfigurirano.",
        emailSent: false,
        emailConfigured: mail.configured,
      });
    }

    return json(201, {
      message: "Hvala, upit je zaprimljen. Javit ćemo Vam se uskoro.",
      emailSent: true,
      emailConfigured: true,
    });
  } catch (error) {
    console.error("Email slanje nije uspjelo:", error);
    return json(500, {
      message: "Trenutno ne možemo poslati upit. Molimo nazovite salon.",
      emailSent: false,
      emailConfigured: true,
    });
  }
};
