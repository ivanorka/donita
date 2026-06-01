const loginPanel = document.querySelector("#loginPanel");
const submissionsPanel = document.querySelector("#submissionsPanel");
const loginForm = document.querySelector("#adminLoginForm");
const loginStatus = loginForm?.querySelector(".form-status");
const submissionsList = document.querySelector("#submissionsList");
const refreshButton = document.querySelector("#refreshButton");
const logoutButton = document.querySelector("#logoutButton");

function updateIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message;
  element.className = `form-status ${type}`.trim();
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("hr-HR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailBadge(email) {
  const label = email.type === "client" ? "Odgovor klijentu" : "Obavijest salonu";
  const state = email.sent ? "Poslano" : "Nije poslano";
  return `
    <li class="${email.sent ? "sent" : "not-sent"}">
      <span>${label}</span>
      <strong>${state}</strong>
      <small>${escapeHtml(email.to || "nema emaila")}${email.error ? ` · ${escapeHtml(email.error)}` : ""}</small>
    </li>
  `;
}

function renderSubmissions(submissions) {
  if (!submissions.length) {
    submissionsList.innerHTML = `<p class="admin-empty">Još nema zaprimljenih upita.</p>`;
    return;
  }

  submissionsList.innerHTML = submissions
    .map(
      (submission) => `
        <article class="admin-item">
          <div class="admin-item-head">
            <div>
              <h2>${escapeHtml(submission.name)}</h2>
              <p>${formatDate(submission.createdAt)}</p>
            </div>
            <span>${escapeHtml(submission.id)}</span>
          </div>
          <div class="admin-meta">
            <a href="tel:${escapeHtml(submission.phone)}">${escapeHtml(submission.phone)}</a>
            ${
              submission.email
                ? `<a href="mailto:${escapeHtml(submission.email)}">${escapeHtml(submission.email)}</a>`
                : `<span>Nema emaila</span>`
            }
          </div>
          <p class="admin-message">${escapeHtml(submission.message || "Bez napomene.")}</p>
          <ul class="email-statuses">
            ${(submission.emails || []).map(emailBadge).join("")}
          </ul>
        </article>
      `
    )
    .join("");
}

async function loadSubmissions() {
  const response = await fetch("/api/admin/submissions");

  if (response.status === 401) {
    loginPanel.hidden = false;
    submissionsPanel.hidden = true;
    logoutButton.hidden = true;
    return;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "Ne mogu učitati upite.");
  }

  loginPanel.hidden = true;
  submissionsPanel.hidden = false;
  logoutButton.hidden = false;
  renderSubmissions(payload.submissions || []);
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector("button[type='submit']");
  const payload = Object.fromEntries(new FormData(loginForm).entries());

  submitButton.disabled = true;
  setStatus(loginStatus, "Prijavljujem...");

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Prijava nije uspjela.");
    }

    loginForm.reset();
    setStatus(loginStatus, "");
    await loadSubmissions();
  } catch (error) {
    setStatus(loginStatus, error.message, "error");
  } finally {
    submitButton.disabled = false;
    updateIcons();
  }
});

refreshButton?.addEventListener("click", loadSubmissions);

logoutButton?.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  loginPanel.hidden = false;
  submissionsPanel.hidden = true;
  logoutButton.hidden = true;
});

document.addEventListener("DOMContentLoaded", () => {
  updateIcons();
  loadSubmissions().catch((error) => {
    submissionsList.innerHTML = `<p class="admin-empty">${error.message}</p>`;
  });
});
