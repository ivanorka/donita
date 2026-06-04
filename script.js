const navToggle = document.querySelector(".nav-toggle");
const mainNav = document.querySelector(".main-nav");
const filterButtons = document.querySelectorAll("[data-filter]");
const priceCards = document.querySelectorAll(".price-card");
const contactForm = document.querySelector("#contactForm");
const formStatus = document.querySelector(".form-status");
const priceEmpty = document.querySelector(".price-empty");
const priceModeButtons = document.querySelectorAll("[data-price-mode]");
const priceNote = document.querySelector("#priceNote");
const giftInquiry = document.querySelector("[data-gift-inquiry]");
let activePriceMode = "cash";

function updateIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function closeNavigation() {
  mainNav?.classList.remove("open");
  navToggle?.setAttribute("aria-expanded", "false");
}

function applyPriceFilter() {
  const activeFilter = document.querySelector("[data-filter].active")?.dataset.filter || "all";
  let visibleCount = 0;

  priceCards.forEach((card) => {
    const matchesCategory = activeFilter === "all" || card.dataset.category === activeFilter;
    card.hidden = !matchesCategory;
    if (matchesCategory) {
      visibleCount += 1;
    }
  });

  if (priceEmpty) {
    priceEmpty.hidden = visibleCount > 0;
  }
}

function formatEuro(value) {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

function discountedPriceText(originalText) {
  const match = originalText.match(/(\d+(?:,\d{2})?)\s*€/);
  if (!match) return originalText;

  const originalValue = Number(match[1].replace(",", "."));
  if (!Number.isFinite(originalValue)) return originalText;

  const discounted = formatEuro(originalValue * 0.95);
  return originalText.replace(match[0], discounted);
}

function applyPriceMode() {
  priceCards.forEach((card) => {
    card.querySelectorAll("strong").forEach((price) => {
      if (!price.dataset.cardPrice) {
        price.dataset.cardPrice = price.textContent.trim();
      }

      const cardPrice = price.dataset.cardPrice;
      price.textContent = activePriceMode === "cash" ? discountedPriceText(cardPrice) : cardPrice;
    });
  });

  if (priceNote) {
    priceNote.textContent =
      activePriceMode === "cash"
        ? "Prikazane su cijene za gotovinsko plaćanje s uključenim popustom od 5%. Za kartično plaćanje prebacite prikaz na “Kartica”."
        : "Cijene su izražene u eurima. Odobravamo popust od 5% za gotovinsko plaćanje i kartično plaćanje iznad 70,00 EUR. Za detalje o tretmanima i terminima slobodno kontaktirajte salon.";
  }
}

navToggle?.addEventListener("click", () => {
  const isOpen = mainNav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

mainNav?.addEventListener("click", (event) => {
  if (event.target.matches("a")) {
    closeNavigation();
  }
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    filterButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    applyPriceFilter();
  });
});

priceModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activePriceMode = button.dataset.priceMode || "cash";
    priceModeButtons.forEach((item) => item.classList.toggle("active", item === button));
    applyPriceMode();
  });
});

giftInquiry?.addEventListener("click", () => {
  const message = contactForm?.elements.message;
  if (message && !message.value.trim()) {
    message.value = "Upit za Donita darovnicu. Molim Vas javite mi mogućnosti poklon bona.";
  }

  requestAnimationFrame(() => message?.focus());
});

contactForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = contactForm.querySelector("button[type='submit']");
  const formData = new FormData(contactForm);
  const payload = Object.fromEntries(formData.entries());

  formStatus.textContent = "";
  formStatus.className = "form-status";
  submitButton.disabled = true;
  submitButton.textContent = "Šaljem...";

  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Slanje nije uspjelo.");
    }

    contactForm.reset();
    formStatus.textContent = result.message || "Hvala, upit je zaprimljen.";
    formStatus.classList.add(result.emailSent ? "success" : "warning");
  } catch (error) {
    formStatus.textContent = error.message || "Trenutno ne možemo poslati upit. Molimo nazovite salon.";
    formStatus.classList.add("error");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = '<i data-lucide="send"></i>Pošalji rezervaciju';
    updateIcons();
  }
});

document.addEventListener("DOMContentLoaded", updateIcons);
document.addEventListener("DOMContentLoaded", applyPriceMode);
window.addEventListener("load", updateIcons);
