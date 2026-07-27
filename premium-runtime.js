(() => {
  const heroImages = {
    rally: "https://images.unsplash.com/photo-1628472235861-21cb85debe9e?auto=format&fit=crop&w=1600&q=86",
    entertainment: "https://images.unsplash.com/photo-1761998535969-11ca31e89f78?auto=format&fit=crop&w=1600&q=84",
    event: "https://images.unsplash.com/photo-1761998535969-11ca31e89f78?auto=format&fit=crop&w=1600&q=84",
    travel: "https://images.unsplash.com/photo-1758473788156-e6b2ae00c77d?auto=format&fit=crop&w=1600&q=84",
  };

  const els = {
    card: document.getElementById("nextEventCard"),
    title: document.getElementById("nextEventTitle"),
    time: document.getElementById("nextEventTime"),
    countdown: document.getElementById("heroCountdown"),
    primary: document.getElementById("heroCountPrimary"),
    primaryLabel: document.getElementById("heroCountPrimaryLabel"),
    secondaryUnit: document.getElementById("heroCountSecondaryUnit"),
    secondary: document.getElementById("heroCountSecondary"),
    secondaryLabel: document.getElementById("heroCountSecondaryLabel"),
  };

  if (!els.card || !els.title || !els.time || !els.countdown) return;

  let targetTime = null;
  let sourceTimeText = "";
  let syncQueued = false;
  let syncing = false;

  function classify(title) {
    const value = title.toLowerCase();
    if (/(rally|sturgis|festival|fest)/.test(value)) return "rally";
    if (/(band|concert|music|show|dj|entertainment)/.test(value)) return "entertainment";
    if (/(meeting|call|review|sync|appointment)/.test(value)) return "meeting";
    if (/(travel|flight|hotel|drive|trip|load-in|load in)/.test(value)) return "travel";
    if (/(deadline|due|launch|final|deliver)/.test(value)) return "deadline";
    return "event";
  }

  function cleanTitle(value) {
    return String(value || "")
      .replace(/^(?:🏍️?|🎵|📅|🤝|✈️|🔴|●)\s*/u, "")
      .trim();
  }

  function parseHeroTime(value) {
    const text = String(value || "").trim();
    if (!text) return null;

    if (/open now|in progress/i.test(text)) {
      return { live: true, dateText: text.replace(/\s+-\s+/g, " • ") };
    }

    const parts = text.split(/\s+-\s+Starts in\s+/i);
    const dateText = parts[0].replace(/\s+at\s+/i, " • ").toUpperCase();
    if (parts.length < 2) return { live: false, dateText, target: null };

    let durationMs = 0;
    const unitMs = { day: 86400000, hour: 3600000, minute: 60000, second: 1000 };
    for (const match of parts[1].matchAll(/(\d+)\s+(DAY|HOUR|MINUTE|SECOND)S?/gi)) {
      durationMs += Number(match[1]) * unitMs[match[2].toLowerCase()];
    }

    return {
      live: false,
      dateText,
      target: durationMs > 0 ? Date.now() + durationMs : null,
    };
  }

  function setCount(primary, primaryLabel, secondary, secondaryLabel) {
    els.primary.textContent = String(primary).padStart(2, "0");
    els.primaryLabel.textContent = primaryLabel;
    els.secondary.textContent = String(secondary).padStart(2, "0");
    els.secondaryLabel.textContent = secondaryLabel;
    els.secondaryUnit.hidden = false;
  }

  function updateCountdown() {
    if (!targetTime) return;
    const diff = Math.max(targetTime - Date.now(), 0);
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    if (days > 0) setCount(days, "Days", hours, "Hours");
    else if (hours > 0) setCount(hours, "Hours", minutes, "Minutes");
    else setCount(minutes, "Minutes", seconds, "Seconds");
  }

  function eventImageDirective() {
    const description = document.querySelector(".event-card .event-description");
    if (!description) return "";
    const match = description.textContent.match(/(?:^|\n)\s*(?:IMAGE|IMAGE_URL)\s*:\s*(https?:\/\/\S+)/i);
    if (!match) return "";
    description.textContent = description.textContent
      .replace(/(?:^|\n)\s*(?:IMAGE|IMAGE_URL)\s*:\s*https?:\/\/\S+\s*/i, "\n")
      .trim();
    return match[1].replace(/[),.;]+$/, "");
  }

  function syncHero() {
    if (syncing) return;
    syncing = true;

    const title = cleanTitle(els.title.textContent);
    if (title && els.title.textContent !== title) els.title.textContent = title;

    const tone = classify(title);
    els.card.dataset.tone = tone;
    const image = eventImageDirective() || heroImages[tone] || "";
    if (image) els.card.style.setProperty("--hero-image", `url(${JSON.stringify(image)})`);

    const currentTime = els.time.textContent.trim();
    if (/Starts in|open now|in progress/i.test(currentTime)) sourceTimeText = currentTime;
    const parsed = parseHeroTime(sourceTimeText || currentTime);

    if (!parsed) {
      targetTime = null;
      els.countdown.hidden = true;
    } else if (parsed.live) {
      targetTime = null;
      els.time.textContent = parsed.dateText;
      els.countdown.hidden = false;
      els.primary.textContent = "LIVE";
      els.primaryLabel.textContent = "Now";
      els.secondaryUnit.hidden = true;
    } else {
      els.time.textContent = parsed.dateText;
      targetTime = parsed.target;
      els.countdown.hidden = !targetTime;
      if (targetTime) updateCountdown();
    }

    syncing = false;
  }

  function queueSync() {
    if (syncQueued || syncing) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      syncHero();
    });
  }

  new MutationObserver(queueSync).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  queueSync();
  window.setInterval(updateCountdown, 1000);
})();
