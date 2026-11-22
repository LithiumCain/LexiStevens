/**
 * ZLS Executive Concierge — booking form
 * Mobile-first, voice-friendly, SMS handoff (no backend).
 */
(function () {
  "use strict";

  const P = window.ZLSPricing;
  if (!P) return;
  const cfg = P.CONFIG;
  const METERS_PER_MILE = 1609.344;

  const ALIASES = {
    "the domain": place("The Domain, Austin, TX", 30.4022, -97.7253),
    domain: place("The Domain, Austin, TX", 30.4022, -97.7253),
    aus: place("Austin-Bergstrom International Airport (AUS)", 30.1945, -97.6699),
    "austin airport": place("Austin-Bergstrom International Airport (AUS)", 30.1945, -97.6699),
    bergstrom: place("Austin-Bergstrom International Airport (AUS)", 30.1945, -97.6699),
    "downtown houston": place("Downtown Houston, TX", 29.7589, -95.3677),
    houston: place("Downtown Houston, TX", 29.7589, -95.3677),
    "downtown austin": place("Downtown Austin, TX", 30.2672, -97.7431),
  };

  const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEKDAY_CODE = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
  const WEEKDAY_WORD = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
  };

  function place(label, lat, lng) {
    return { label: label, lat: lat, lng: lng };
  }
  function $(id) {
    return document.getElementById(id);
  }
  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function truthy(v) {
    return /^(1|true|yes|y)$/i.test(String(v || "").trim());
  }
  function val(id) {
    const el = $(id);
    return el ? String(el.value || "").trim() : "";
  }
  function setVal(id, value) {
    const el = $(id);
    if (el && value != null && value !== "") el.value = value;
  }

  const loc = {
    pickup: { text: "", lat: null, lng: null },
    dropoff: { text: "", lat: null, lng: null },
    returnPickup: { text: "", lat: null, lng: null },
    returnDropoff: { text: "", lat: null, lng: null },
  };

  let step = 1;
  let outboundRoute = null;
  let returnRoute = null;
  let routeTimer = 0;
  let lastNominatim = 0;
  let quote = null;
  let returnDefaultsApplied = false;

  function currentPackage() {
    const checked = document.querySelector('input[name="package"]:checked');
    return P.getPackage(checked ? checked.value : "");
  }
  function isRecurring() {
    const checked = document.querySelector('input[name="recurring"]:checked');
    return checked && checked.value === "yes" && !currentPackage();
  }
  function isReturn() {
    const checked = document.querySelector('input[name="hasReturn"]:checked');
    return checked && checked.value === "yes" && !currentPackage();
  }
  function selectedWeekdays() {
    return qsa('input[name="weekday"]:checked').map(function (el) {
      return Number(el.value);
    });
  }
  function selectedPay() {
    const checked = document.querySelector('input[name="pay"]:checked');
    return checked ? checked.value : "";
  }
  function policyAgreed() {
    const el = $("policy-agree");
    return !!(el && el.checked);
  }

  function locIsAus(key) {
    const l = loc[key] || {};
    const text = val(key) || l.text || "";
    return P.isAusAirportLocation(text, l.lat, l.lng);
  }

  function ausPickupBlocked() {
    if (cfg.ausAirport && cfg.ausAirport.pickupsEnabled) return false;
    if (locIsAus("pickup")) return "pickup";
    if (isReturn() && locIsAus("returnPickup")) return "returnPickup";
    return "";
  }

  function updateAusNotice() {
    const notice = $("aus-notice");
    if (!notice) return;
    const blocked = ausPickupBlocked();
    const msg = (cfg.ausAirport && cfg.ausAirport.pickupNotice) ||
      "Airport pickups at AUS are coming soon. Drop-offs are available now.";
    notice.textContent = msg;
    notice.hidden = !blocked;
  }


  function manualMinutes(hoursId, minsId) {
    return (Number($(hoursId).value) || 0) * 60 + (Number($(minsId).value) || 0);
  }
  function manualOutboundOn() {
    return $("manual-out-fields") && !$("manual-out-fields").hidden;
  }
  function manualReturnOn() {
    return $("manual-ret-fields") && !$("manual-ret-fields").hidden;
  }

  function farthestAndDuration(route, manualOn, hoursId, minsId, milesId) {
    if (manualOn) {
      return {
        durationMinutes: manualMinutes(hoursId, minsId),
        farthestMilesFromDomain: Number($(milesId).value) || 0,
        source: "manual",
      };
    }
    if (route) {
      return {
        durationMinutes: route.durationMinutes,
        farthestMilesFromDomain: route.farthestMiles,
        source: route.source,
      };
    }
    return { durationMinutes: 0, farthestMilesFromDomain: 0, source: "" };
  }

  function buildQuote() {
    const pkg = currentPackage();
    const out = farthestAndDuration(
      outboundRoute,
      manualOutboundOn(),
      "out-hours",
      "out-mins",
      "out-miles"
    );
    const input = {
      durationMinutes: out.durationMinutes,
      farthestMilesFromDomain: out.farthestMilesFromDomain,
    };
    if (pkg) {
      input.package = pkg.id;
    } else {
      if (isReturn()) {
        const ret = farthestAndDuration(
          returnRoute,
          manualReturnOn(),
          "ret-hours",
          "ret-mins",
          "ret-miles"
        );
        if (ret.durationMinutes > 0 || ret.farthestMilesFromDomain > 0) {
          input.returnTrip = ret;
        }
      }
      if (isRecurring()) {
        input.recurring = true;
        const start = val("start") || val("date");
        const end = val("end");
        const count = P.countRecurringTrips(selectedWeekdays(), start, end);
        input.occurrences = count || 1;
      }
    }
    quote = P.calculateQuote(input);
    quote.source = out.source || "estimate";
    return quote;
  }

  function formatWhen(dateISO, timeHHMM) {
    if (!dateISO && !timeHHMM) return "—";
    const d = dateISO ? P.parseISODateLocal(dateISO) : null;
    const datePart = d
      ? d.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "";
    let timePart = "";
    if (timeHHMM) {
      const parts = timeHHMM.split(":");
      const dt = new Date(2000, 0, 1, Number(parts[0]) || 0, Number(parts[1]) || 0);
      timePart = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    return (datePart + (timePart ? " at " + timePart : "")).trim();
  }

  function lineForLeg(leg) {
    if (!leg) return "";
    const time = P.formatHoursMinutes(leg.durationMinutes) +
      " billed as " +
      P.formatHoursMinutes(leg.billedMinutes) +
      " × " +
      P.formatMoney(cfg.hourlyRate) +
      " = " +
      P.formatMoney(leg.timeCharge);
    const miles =
      "Mileage: " +
      P.formatMiles(leg.billableMiles) +
      " mi beyond 20 from The Domain × $1 = " +
      P.formatMoney(leg.mileageCharge);
    return time + "\n  " + miles + "\n  " + leg.label + " subtotal: " + P.formatMoney(leg.total);
  }

  function quoteLines(q) {
    const lines = [];
    if (!q || !q.ready) {
      return ["Add a pickup and enough trip details to see a live quote."];
    }
    if (q.isPackage && q.package) {
      lines.push(q.package.shortLabel + "  " + P.formatMoney(q.packageCharge));
      lines.push(
        "Mileage: " +
          P.formatMiles(q.billableMiles) +
          " mi beyond 20 from The Domain × $1 = " +
          P.formatMoney(q.mileageCharge)
      );
    } else {
      if (q.outbound) {
        lines.push(q.outbound.label);
        lineForLeg(q.outbound).split("\n").forEach(function (part) {
          lines.push(part.trim());
        });
      }
      if (q.returnLeg) {
        lines.push(q.returnLeg.label);
        lineForLeg(q.returnLeg).split("\n").forEach(function (part) {
          lines.push(part.trim());
        });
      }
      if (q.recurring && q.occurrences > 1) {
        lines.push(q.occurrences + " trips × " + P.formatMoney(q.perTrip) + " = " + P.formatMoney(q.subtotal));
        lines.push("15% repeating-trip discount: −" + P.formatMoney(q.discount));
      }
    }
    lines.push("Total " + P.formatMoney(q.total));
    return lines;
  }

  function renderQuote() {
    updateAusNotice();
    const q = buildQuote();
    const totalText = q && q.ready ? P.formatMoney(q.total) : "—";
    $("quote-total").textContent = totalText;
    $("sticky-total").textContent = totalText;
    const lines = quoteLines(q);
    $("quote-lines").innerHTML = "<ul>" + lines.map(function (line) {
      const strong = /Total /.test(line) || /deposit/i.test(line);
      return "<li" + (strong ? ' class="ql-strong"' : "") + ">" + escapeHtml(line) + "</li>";
    }).join("") + "</ul>";
    if (step === 4) renderReview();
    updateHandoff();
    updateOccurrences();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateOccurrences() {
    const note = $("occurrence-note");
    if (!note) return;
    if (!isRecurring()) {
      note.textContent = "";
      return;
    }
    const start = val("start") || val("date");
    const end = val("end");
    const days = selectedWeekdays();
    const n = P.countRecurringTrips(days, start, end);
    if (!days.length || !start || !end) {
      note.textContent = "Select weekdays and a start and end date to count the trips.";
    } else if (n === 0) {
      note.textContent = "No selected weekdays fall in that date range.";
    } else {
      note.textContent = n + (n === 1 ? " trip" : " trips") + " in this series, 15% off.";
    }
  }

  function summaryText() {
    const q = quote || buildQuote();
    const pay = P.paymentMethodById(selectedPay());
    const pkg = currentPackage();
    const lines = [];
    lines.push("ZLS booking request");
    lines.push("Name: " + (val("name") || "—"));
    lines.push("Phone: " + (val("phone") || "—"));
    lines.push("Email: " + (val("email") || "—"));
    lines.push("From: " + (val("pickup") || "—"));
    lines.push("To: " + (val("dropoff") || "—"));
    lines.push("Stops: " + (val("stops") || "—"));
    lines.push("When: " + formatWhen(val("date"), val("time")));
    lines.push("Type: " + (pkg ? pkg.label : "Hourly"));
    if (!pkg && isReturn()) {
      lines.push(
        "Return: " +
          formatWhen(val("returnDate") || val("date"), val("returnTime")) +
          ", from " +
          (val("returnPickup") || val("dropoff") || "—") +
          " to " +
          (val("returnDropoff") || val("pickup") || "—")
      );
    } else {
      lines.push("Return: no");
    }
    if (!pkg && isRecurring()) {
      const days = selectedWeekdays().map(function (d) { return WEEKDAY_NAMES[d]; }).join(", ");
      const n = (q && q.occurrences) || 1;
      lines.push(
        "Repeat: " +
          (days || "—") +
          ", " +
          (val("start") || val("date") || "—") +
          " to " +
          (val("end") || "—") +
          ", " +
          n +
          (n === 1 ? " trip" : " trips")
      );
    } else {
      lines.push("Repeat: no");
    }
    lines.push("Riders: " + (val("pax") || "1") + "  Bags: " + (val("bags") || "0"));
    lines.push("Pet or service dog: " + ($("pet") && $("pet").checked ? "yes" : "no"));
    lines.push("Pay: " + (pay ? pay.label : "—"));
    lines.push("Estimate (confirmed by text):");
    if (q && q.ready) {
      if (q.isPackage && q.package) {
        lines.push("  Package: " + q.package.shortLabel + " " + P.formatMoney(q.packageCharge));
        lines.push(
          "  Mileage: " +
            P.formatMiles(q.billableMiles) +
            " mi × $1 = " +
            P.formatMoney(q.mileageCharge)
        );
      } else {
        if (q.outbound) {
          lines.push("  Outbound: " + P.formatHoursMinutes(q.outbound.billedMinutes) + " + " + P.formatMoney(q.outbound.mileageCharge) + " mileage = " + P.formatMoney(q.outbound.total));
        }
        if (q.returnLeg) {
          lines.push("  Return: " + P.formatHoursMinutes(q.returnLeg.billedMinutes) + " + " + P.formatMoney(q.returnLeg.mileageCharge) + " mileage = " + P.formatMoney(q.returnLeg.total));
        }
        if (q.recurring && q.occurrences > 1) {
          lines.push("  " + q.occurrences + " trips × " + P.formatMoney(q.perTrip) + " = " + P.formatMoney(q.subtotal));
          lines.push("  15% repeating-trip discount: -" + P.formatMoney(q.discount));
        }
      }
      lines.push("  Total: " + P.formatMoney(q.total));
    } else {
      lines.push("  Total: to be confirmed");
    }
    lines.push("  Deposit: $25.00, arranged by text");
    lines.push("Policy agreed: " + (policyAgreed() ? "yes" : "no"));
    if (val("notes")) lines.push("Notes: " + val("notes"));
    return lines.join("\n");
  }

  function renderReview() {
    const card = $("review-card");
    if (card) card.textContent = summaryText();
  }

  function smsHref(body) {
    const encoded = encodeURIComponent(body);
    const ua = navigator.userAgent || "";
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return ios
      ? "sms:" + cfg.phoneE164 + "&body=" + encoded
      : "sms:" + cfg.phoneE164 + "?body=" + encoded;
  }

  function updateHandoff() {
    const body = summaryText();
    const sms = $("sms-btn");
    const agreed = policyAgreed();
    if (sms) {
      sms.setAttribute("href", agreed ? smsHref(body) : "#");
      sms.classList.toggle("is-disabled", !agreed);
      sms.setAttribute("aria-disabled", agreed ? "false" : "true");
    }
    const payBtn = $("pay-btn");
    if (payBtn) {
      if (cfg.paymentLink) {
        payBtn.hidden = false;
        payBtn.setAttribute("href", cfg.paymentLink);
      } else {
        payBtn.hidden = true;
      }
    }
  }

  function showError(msg) {
    const el = $("form-error");
    if (!el) return;
    if (msg) {
      el.hidden = false;
      el.textContent = msg;
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  }

  /* ---------- steps ---------- */
  function goTo(n) {
    step = Math.max(1, Math.min(4, n));
    qsa(".book-step").forEach(function (sec) {
      sec.hidden = Number(sec.getAttribute("data-step")) !== step;
    });
    qsa(".stepper-item").forEach(function (item) {
      const s = Number(item.getAttribute("data-step-dot"));
      item.classList.toggle("is-current", s === step);
      item.classList.toggle("is-done", s < step);
    });
    const back = $("back-btn");
    const next = $("next-btn");
    if (back) back.hidden = step === 1;
    if (next) {
      next.hidden = step === 4;
      next.textContent = "Continue";
    }
    const sticky = $("sticky-btn");
    if (sticky) sticky.textContent = step === 4 ? "Text this request" : "Continue";
    if (step === 4) renderReview();
    showError("");
    const title = $("step-" + step + "-title");
    if (title) title.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validateStep(n) {
    if (n === 1) {
      if (!val("pickup")) return "Please enter a pickup address.";
      if (ausPickupBlocked()) {
        return (cfg.ausAirport && cfg.ausAirport.pickupNotice) ||
          "Airport pickups at AUS are coming soon. Drop-offs are available now.";
      }
      return "";
    }
    if (n === 2) {
      if (ausPickupBlocked()) {
        return (cfg.ausAirport && cfg.ausAirport.pickupNotice) ||
          "Airport pickups at AUS are coming soon. Drop-offs are available now.";
      }
      if (!val("date") || !val("time")) return "Please choose a pickup date and time.";
      if (isReturn() && !val("returnTime")) return "Please choose a return pickup time.";
      if (isRecurring()) {
        if (!selectedWeekdays().length) return "Please choose at least one weekday for the series.";
        if (!(val("start") || val("date")) || !val("end")) return "Please choose a start and end date for the series.";
      }
      const q = buildQuote();
      if (!currentPackage() && !q.ready && !manualOutboundOn()) {
        return "I need an estimated drive time to quote this. Open “Enter time and mileage yourself,” or add a dropoff I can map.";
      }
      if (isReturn() && q.hasReturn && !q.returnLeg.ready && !manualReturnOn()) {
        return "I need an estimated return drive time to quote the return leg.";
      }
      return "";
    }
    if (n === 3) {
      if (!val("name")) return "Please enter your name.";
      if (!val("phone")) return "Please enter a phone number so I can confirm by text.";
      const email = val("email");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please check the email address.";
      const pax = Number(val("pax") || 1);
      if (currentPackage() && pax > cfg.packageMaxPassengers) {
        return "Night-out packages are for a party of up to " + cfg.packageMaxPassengers + " riders.";
      }
      if (!selectedPay()) return "Please choose a preferred payment method.";
      return "";
    }
    if (n === 4) {
      if (!policyAgreed()) return "Please agree to the rider policy before sending this request.";
      return "";
    }
    return "";
  }

  function tryContinue() {
    const err = validateStep(step);
    if (err) {
      showError(err);
      return;
    }
    showError("");
    if (step < 4) goTo(step + 1);
    else requestBooking();
  }

  function requestBooking() {
    const aus = ausPickupBlocked();
    if (aus) {
      showError((cfg.ausAirport && cfg.ausAirport.pickupNotice) ||
        "Airport pickups at AUS are coming soon. Drop-offs are available now.");
      updateAusNotice();
      goTo(1);
      return;
    }
    const err = validateStep(4) || validateStep(3) || validateStep(2) || validateStep(1);
    if (err) {
      showError(err);
      if (!policyAgreed()) {
        const box = $("policy-agree");
        if (box) box.focus();
      }
      return;
    }
    const href = smsHref(summaryText());
    window.location.href = href;
    const status = $("copy-status");
    if (status) {
      status.textContent = "Your messaging app should open with the request. A booking is confirmed when I text you back.";
    }
  }

  /* ---------- package / return / recurring UI ---------- */
  function syncConditionalUI() {
    const pkg = currentPackage();
    const extras = $("hourly-extras");
    if (extras) extras.hidden = !!pkg;
    const ret = $("return-fields");
    if (ret) ret.hidden = !isReturn();
    const rec = $("recurring-fields");
    if (rec) rec.hidden = !isRecurring();
    if (isReturn()) applyReturnDefaults();
    if (isRecurring()) {
      if (!val("start") && val("date")) setVal("start", val("date"));
    }
    renderQuote();
  }

  function applyReturnDefaults() {
    if (returnDefaultsApplied) return;
    if (!val("returnDate") && val("date")) setVal("returnDate", val("date"));
    if (!val("returnPickup") && val("dropoff")) {
      setVal("returnPickup", val("dropoff"));
      copyLoc("dropoff", "returnPickup");
    }
    if (!val("returnDropoff") && val("pickup")) {
      setVal("returnDropoff", val("pickup"));
      copyLoc("pickup", "returnDropoff");
    }
    returnDefaultsApplied = true;
  }

  function copyLoc(fromKey, toKey) {
    loc[toKey] = { text: loc[fromKey].text, lat: loc[fromKey].lat, lng: loc[fromKey].lng };
  }

  /* ---------- geocoding & routing ---------- */
  function waitForNominatim() {
    const gap = 1100;
    const wait = Math.max(0, lastNominatim + gap - Date.now());
    return new Promise(function (resolve) {
      setTimeout(function () {
        lastNominatim = Date.now();
        resolve();
      }, wait);
    });
  }

  function aliasMatch(query) {
    const key = String(query || "").trim().toLowerCase();
    return ALIASES[key] || null;
  }

  async function searchNominatim(query) {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&countrycodes=us&q=" +
      encodeURIComponent(query);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("nominatim");
    const data = await res.json();
    return (data || []).map(function (item) {
      return { label: item.display_name, lat: Number(item.lat), lng: Number(item.lon) };
    });
  }

  async function searchPhoton(query) {
    const url =
      "https://photon.komoot.io/api/?limit=5&lat=30.4022&lon=-97.7253&q=" +
      encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) throw new Error("photon");
    const data = await res.json();
    return ((data && data.features) || []).map(function (f) {
      const props = f.properties || {};
      const coords = (f.geometry && f.geometry.coordinates) || [];
      const parts = [props.name, props.street, props.city, props.state, props.postcode].filter(Boolean);
      return { label: parts.join(", ") || props.name, lat: coords[1], lng: coords[0] };
    });
  }

  async function searchAddress(query) {
    const alias = aliasMatch(query);
    if (alias) return [alias];
    try {
      await waitForNominatim();
      const results = await searchNominatim(query);
      if (results.length) return results;
    } catch (err) {
      /* fall through */
    }
    try {
      return await searchPhoton(query);
    } catch (err2) {
      return alias ? [alias] : [];
    }
  }

  async function geocodeOne(query) {
    const results = await searchAddress(query);
    return results[0] || null;
  }

  function bindAutocomplete(inputId, listId, locKey) {
    const input = $(inputId);
    const list = $(listId);
    if (!input || !list) return;
    let items = [];
    let active = -1;
    let timer = 0;

    function close() {
      list.hidden = true;
      list.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      active = -1;
    }
    function render() {
      list.innerHTML = items
        .map(function (item, i) {
          return (
            '<li class="suggest-item" role="option" id="' +
            listId +
            "-" +
            i +
            '" aria-selected="' +
            (i === active ? "true" : "false") +
            '">' +
            escapeHtml(item.label) +
            "</li>"
          );
        })
        .join("");
      list.hidden = items.length === 0;
      input.setAttribute("aria-expanded", items.length ? "true" : "false");
    }
    function choose(item) {
      input.value = item.label;
      loc[locKey] = { text: item.label, lat: item.lat, lng: item.lng };
      close();
      scheduleRoute();
    }

    input.addEventListener("input", function () {
      loc[locKey] = { text: input.value, lat: null, lng: null };
      const q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 3) {
        close();
        return;
      }
      timer = setTimeout(function () {
        searchAddress(q).then(function (results) {
          items = results;
          active = results.length ? 0 : -1;
          render();
        });
      }, 400);
    });
    input.addEventListener("keydown", function (e) {
      if (list.hidden) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(items.length - 1, active + 1);
        render();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(0, active - 1);
        render();
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        choose(items[active]);
      } else if (e.key === "Escape") {
        close();
      }
    });
    list.addEventListener("mousedown", function (e) {
      const li = e.target.closest(".suggest-item");
      if (!li) return;
      const i = Number(li.id.replace(listId + "-", ""));
      if (items[i]) choose(items[i]);
    });
    input.addEventListener("blur", function () {
      setTimeout(close, 150);
      if (!loc[locKey].lat && val(inputId).length >= 3) {
        geocodeOne(val(inputId)).then(function (hit) {
          if (hit) {
            loc[locKey] = { text: val(inputId) || hit.label, lat: hit.lat, lng: hit.lng };
            scheduleRoute();
          }
        });
      }
    });
  }

  async function osrmRoute(points) {
    const path = points
      .map(function (p) {
        return p.lng + "," + p.lat;
      })
      .join(";");
    const url = "https://router.project-osrm.org/route/v1/driving/" + path + "?overview=false&alternatives=false";
    const res = await fetch(url);
    if (!res.ok) throw new Error("osrm");
    const data = await res.json();
    if (!data.routes || !data.routes[0]) throw new Error("osrm-empty");
    const route = data.routes[0];
    return {
      meters: route.distance,
      seconds: route.duration,
      miles: route.distance / METERS_PER_MILE,
      durationMinutes: Math.round(route.duration / 60),
    };
  }

  async function farthestFromDomain(points) {
    const valid = points.filter(function (p) {
      return p && typeof p.lat === "number" && typeof p.lng === "number";
    });
    if (!valid.length) return 0;
    let maxMiles = 0;
    for (let i = 0; i < valid.length; i += 1) {
      const leg = await osrmRoute([
        { lat: cfg.domain.lat, lng: cfg.domain.lng },
        valid[i],
      ]);
      if (leg.miles > maxMiles) maxMiles = leg.miles;
    }
    return Math.round(maxMiles * 10) / 10;
  }

  function hasCoords(key) {
    return loc[key] && typeof loc[key].lat === "number" && typeof loc[key].lng === "number";
  }

  async function refreshRoutes() {
    try {
      if (hasCoords("pickup") && hasCoords("dropoff") && !manualOutboundOn()) {
        const trip = await osrmRoute([loc.pickup, loc.dropoff]);
        const far = await farthestFromDomain([loc.pickup, loc.dropoff]);
        outboundRoute = { durationMinutes: trip.durationMinutes, farthestMiles: far, source: "osrm" };
        if (!manualOutboundOn()) {
          $("out-hours").value = Math.floor(trip.durationMinutes / 60);
          $("out-mins").value = trip.durationMinutes % 60;
          $("out-miles").value = far;
        }
      } else if (hasCoords("pickup") && !hasCoords("dropoff") && !manualOutboundOn()) {
        const far = await farthestFromDomain([loc.pickup]);
        outboundRoute = null;
        $("out-miles").value = far;
      }
      if (isReturn() && !manualReturnOn()) {
        const rPick = hasCoords("returnPickup") ? loc.returnPickup : loc.dropoff;
        const rDrop = hasCoords("returnDropoff") ? loc.returnDropoff : loc.pickup;
        if (rPick && rDrop && typeof rPick.lat === "number" && typeof rDrop.lat === "number") {
          const trip = await osrmRoute([rPick, rDrop]);
          const far = await farthestFromDomain([rPick, rDrop]);
          returnRoute = { durationMinutes: trip.durationMinutes, farthestMiles: far, source: "osrm" };
          $("ret-hours").value = Math.floor(trip.durationMinutes / 60);
          $("ret-mins").value = trip.durationMinutes % 60;
          $("ret-miles").value = far;
        }
      }
    } catch (err) {
      if (!manualOutboundOn()) {
        $("manual-out-fields").hidden = false;
        $("toggle-manual-out").setAttribute("aria-expanded", "true");
      }
    }
    renderQuote();
  }

  function scheduleRoute() {
    clearTimeout(routeTimer);
    routeTimer = setTimeout(refreshRoutes, 500);
  }

  /* ---------- voice ---------- */
  function parseWeekdaysFromText(text) {
    const lower = text.toLowerCase();
    if (/every weekday|weekdays|monday through friday|mon(?:day)? through fri(?:day)?/.test(lower)) {
      return [1, 2, 3, 4, 5];
    }
    const days = [];
    Object.keys(WEEKDAY_WORD).forEach(function (word) {
      const re = new RegExp("\\b" + word + "s?\\b");
      if (re.test(lower) && days.indexOf(WEEKDAY_WORD[word]) === -1) days.push(WEEKDAY_WORD[word]);
    });
    return days;
  }

  function parseTime(text) {
    const lower = text.toLowerCase();
    if (/\bnoon\b/.test(lower)) return "12:00";
    if (/\bmidnight\b/.test(lower)) return "00:00";
    const m = lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))\s*(a\.?m\.?|p\.?m\.?)?\b|\b(?:at\s+)?(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b/);
    if (!m) return "";
    let hour = Number(m[1] != null ? m[1] : m[4]);
    let min = m[2] != null ? Number(m[2]) : 0;
    const ap = (m[3] || m[5] || "").replace(/\./g, "");
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    if (!ap && m[1] && hour <= 7) hour += 12;
    return String(hour).padStart(2, "0") + ":" + String(min).padStart(2, "0");
  }

  function parseDate(text, now) {
    const lower = text.toLowerCase();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (/\btoday\b/.test(lower)) return isoDate(today);
    if (/\btomorrow\b/.test(lower)) {
      const t = new Date(today);
      t.setDate(t.getDate() + 1);
      return isoDate(t);
    }
    const named = lower.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (named) {
      const want = WEEKDAY_WORD[named[2]];
      const d = new Date(today);
      let add = (want - d.getDay() + 7) % 7;
      if (named[1] || add === 0) add = add === 0 ? 7 : add;
      d.setDate(d.getDate() + add);
      return isoDate(d);
    }
    const md = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (md) {
      const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11 };
      const d = new Date(today.getFullYear(), months[md[1]], Number(md[2]));
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      return isoDate(d);
    }
    return "";
  }

  function isoDate(d) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function parseVoice(text, now) {
    const raw = String(text || "").trim();
    const lower = raw.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ");
    const result = {};
    const from = lower.match(/(?:pick me up at|pickup at|pick up at|from)\s+(.+?)(?=\s+(?:going to|to|drop(?:ping)? off|tomorrow|today|on |at \d|at noon|at midnight|next |every |for a |need a |package)|$)/);
    const to = lower.match(/(?:going to|drop(?:ping)? off at|drop off at|dropoff at)\s+(.+?)(?=\s+(?:tomorrow|today|on |at \d|at noon|at midnight|next |every |from |pick)|$)/) ||
      lower.match(/\bto\s+(.+?)(?=\s+(?:tomorrow|today|on |at \d|at noon|next |every )|$)/);
    if (from) result.pickup = from[1].trim();
    if (to) result.dropoff = to[1].trim();
    result.time = parseTime(lower);
    result.date = parseDate(lower, now || new Date());
    const pax = lower.match(/\b(\d+)\s+(?:passengers?|riders?|people|pax)\b/);
    if (pax) result.pax = pax[1];
    const bags = lower.match(/\b(\d+)\s+bags?\b/);
    if (bags) result.bags = bags[1];
    if (/\bpet\b|service dog|\bdog\b/.test(lower)) result.pet = true;
    if (/\b10[\s-]?hour|\bten hour/.test(lower)) result.package = "10h";
    else if (/\b6[\s-]?hour|\bsix hour|night out|designated driver|\bdd\b/.test(lower)) result.package = "6h";
    if (/every weekday|weekdays|repeating|recurring|school/.test(lower)) result.recurring = true;
    const days = parseWeekdaysFromText(lower);
    if (days.length) result.weekdays = days;
    const stop = lower.match(/stop (?:at|for|by)\s+(.+?)(?=\s+(?:tomorrow|today|at \d)|$)/);
    if (stop) result.stops = stop[1].trim();
    return result;
  }

  function applyVoice(parsed, transcript) {
    const bits = [];
    if (parsed.package) {
      const radio = document.querySelector('input[name="package"][value="' + parsed.package + '"]');
      if (radio) radio.checked = true;
      bits.push(parsed.package === "10h" ? "10-hour night out" : "6-hour night out");
    }
    if (parsed.pickup) {
      setVal("pickup", prettyPlace(parsed.pickup));
      bits.push("pickup at " + val("pickup"));
    }
    if (parsed.dropoff) {
      setVal("dropoff", prettyPlace(parsed.dropoff));
      bits.push("to " + val("dropoff"));
    }
    if (parsed.date) {
      setVal("date", parsed.date);
      bits.push(formatWhen(parsed.date, ""));
    }
    if (parsed.time) {
      setVal("time", parsed.time);
      bits.push(formatWhen("", parsed.time));
    }
    if (parsed.pax) setVal("pax", parsed.pax);
    if (parsed.bags) setVal("bags", parsed.bags);
    if (parsed.pet && $("pet")) $("pet").checked = true;
    if (parsed.stops) setVal("stops", parsed.stops);
    if (parsed.recurring) {
      const rec = document.querySelector('input[name="recurring"][value="yes"]');
      if (rec) rec.checked = true;
    }
    if (parsed.weekdays) {
      qsa('input[name="weekday"]').forEach(function (el) {
        el.checked = parsed.weekdays.indexOf(Number(el.value)) !== -1;
      });
    }
    syncConditionalUI();
    ["pickup", "dropoff"].forEach(function (key) {
      if (val(key)) {
        geocodeOne(val(key)).then(function (hit) {
          if (hit) {
            loc[key] = { text: val(key), lat: hit.lat, lng: hit.lng };
            scheduleRoute();
          }
        });
      }
    });
    const status = $("voice-status");
    if (status) {
      status.textContent = bits.length
        ? "Got it — " + bits.join(", ") + ". Please review before sending."
        : "I heard “" + transcript + ".” Please check the fields and edit anything I missed.";
    }
  }

  function prettyPlace(s) {
    const alias = aliasMatch(s);
    return alias ? alias.label : s.replace(/\bau\s*s\b/i, "AUS");
  }

  function setupVoice() {
    const btn = $("voice-btn");
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!btn) return;
    if (!Speech) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    const rec = new Speech();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onstart = function () {
      btn.classList.add("is-listening");
      btn.querySelector(".voice-btn-label").textContent = "Listening…";
      $("voice-status").textContent = "Listening… tell me the pickup, dropoff, and time.";
    };
    rec.onend = function () {
      btn.classList.remove("is-listening");
      btn.querySelector(".voice-btn-label").textContent = "Tell me the trip";
    };
    rec.onerror = function () {
      $("voice-status").textContent = "I couldn’t hear that. You can type the trip instead.";
    };
    rec.onresult = function (event) {
      const transcript = event.results[0][0].transcript;
      applyVoice(parseVoice(transcript, new Date()), transcript);
    };
    btn.addEventListener("click", function () {
      try {
        rec.start();
      } catch (err) {
        /* already started */
      }
    });
  }

  /* ---------- payments & prefill ---------- */
  function renderPayments() {
    const grid = $("pay-grid");
    if (!grid) return;
    grid.innerHTML = cfg.paymentMethods
      .map(function (m, i) {
        return (
          '<label class="pay-opt"><input type="radio" name="pay" value="' +
          m.id +
          '"' +
          (i === 0 ? "" : "") +
          "> " +
          escapeHtml(m.label) +
          "</label>"
        );
      })
      .join("");
    const handles = $("pay-handles");
    if (handles) {
      const bits = [];
      Object.keys(cfg.paymentHandles || {}).forEach(function (key) {
        const value = cfg.paymentHandles[key];
        if (value) bits.push(key + ": " + value);
      });
      if (bits.length) {
        handles.hidden = false;
        handles.textContent = bits.join(" · ");
      } else {
        handles.hidden = true;
      }
    }
  }

  function parseWeekdayParam(s) {
    if (!s) return [];
    const raw = String(s).trim();
    if (/^[UMTWRFSunmtwrfs]+$/.test(raw) && raw.indexOf(",") === -1) {
      return raw.toUpperCase().split("").map(function (ch) { return WEEKDAY_CODE[ch]; }).filter(function (n) { return n >= 0; });
    }
    return raw.split(/[,\s]+/).map(function (part) {
      const t = part.trim().toLowerCase();
      if (WEEKDAY_WORD[t] != null) return WEEKDAY_WORD[t];
      if (WEEKDAY_CODE[part.trim().toUpperCase()] != null) return WEEKDAY_CODE[part.trim().toUpperCase()];
      return -1;
    }).filter(function (n) { return n >= 0; });
  }

  function prefillFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const map = {
      pickup: "pickup",
      dropoff: "dropoff",
      stops: "stops",
      date: "date",
      time: "time",
      pax: "pax",
      bags: "bags",
      name: "name",
      phone: "phone",
      email: "email",
      notes: "notes",
      returnDate: "returnDate",
      returnTime: "returnTime",
      returnPickup: "returnPickup",
      returnDropoff: "returnDropoff",
      start: "start",
      end: "end",
    };
    Object.keys(map).forEach(function (key) {
      if (params.has(key)) setVal(map[key], params.get(key));
    });
    if (truthy(params.get("return"))) {
      const r = document.querySelector('input[name="hasReturn"][value="yes"]');
      if (r) r.checked = true;
    }
    if (truthy(params.get("recurring"))) {
      const r = document.querySelector('input[name="recurring"][value="yes"]');
      if (r) r.checked = true;
    }
    if (truthy(params.get("pet")) && $("pet")) $("pet").checked = true;
    const pkg = params.get("package");
    if (pkg && P.getPackage(pkg)) {
      const radio = document.querySelector('input[name="package"][value="' + pkg + '"]');
      if (radio) radio.checked = true;
    }
    const pay = params.get("pay");
    if (pay) {
      const radio = document.querySelector('input[name="pay"][value="' + pay.toLowerCase() + '"]');
      if (radio) radio.checked = true;
    }
    const days = parseWeekdayParam(params.get("weekdays"));
    if (days.length) {
      qsa('input[name="weekday"]').forEach(function (el) {
        el.checked = days.indexOf(Number(el.value)) !== -1;
      });
    }
    ["pickup", "dropoff", "returnPickup", "returnDropoff"].forEach(function (key) {
      if (val(key)) {
        loc[key].text = val(key);
        geocodeOne(val(key)).then(function (hit) {
          if (hit) {
            loc[key] = { text: val(key), lat: hit.lat, lng: hit.lng };
            scheduleRoute();
          }
        });
      }
    });
  }

  function setDateMins() {
    const today = isoDate(new Date());
    ["date", "returnDate", "start", "end"].forEach(function (id) {
      const el = $(id);
      if (el) el.setAttribute("min", today);
    });
  }

  /* ---------- init ---------- */
  function init() {
    renderPayments();
    setDateMins();
    bindAutocomplete("pickup", "pickup-list", "pickup");
    bindAutocomplete("dropoff", "dropoff-list", "dropoff");
    bindAutocomplete("returnPickup", "returnPickup-list", "returnPickup");
    bindAutocomplete("returnDropoff", "returnDropoff-list", "returnDropoff");
    prefillFromQuery();
    setupVoice();
    syncConditionalUI();

    $("book-form").addEventListener("input", function () {
      renderQuote();
    });
    $("book-form").addEventListener("change", function (e) {
      const name = e.target && e.target.name;
      if (name === "package" || name === "hasReturn" || name === "recurring" || name === "weekday") {
        if (name === "hasReturn" && e.target.value === "yes") returnDefaultsApplied = false;
        syncConditionalUI();
        scheduleRoute();
      } else {
        renderQuote();
      }
    });

    $("toggle-manual-out").addEventListener("click", function () {
      const box = $("manual-out-fields");
      box.hidden = !box.hidden;
      this.setAttribute("aria-expanded", String(!box.hidden));
      renderQuote();
    });
    $("toggle-manual-ret").addEventListener("click", function () {
      const box = $("manual-ret-fields");
      box.hidden = !box.hidden;
      this.setAttribute("aria-expanded", String(!box.hidden));
      renderQuote();
    });

    $("next-btn").addEventListener("click", tryContinue);
    $("sticky-btn").addEventListener("click", function () {
      if (step === 4) requestBooking();
      else tryContinue();
    });
    $("back-btn").addEventListener("click", function () {
      goTo(step - 1);
    });
    qsa(".stepper-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const target = Number(this.getAttribute("data-goto"));
        if (target < step) goTo(target);
        else if (target > step) {
          for (let s = step; s < target; s += 1) {
            const err = validateStep(s);
            if (err) {
              showError(err);
              return;
            }
          }
          goTo(target);
        }
      });
    });

    $("sms-btn").addEventListener("click", function (e) {
      if (ausPickupBlocked()) {
        e.preventDefault();
        showError((cfg.ausAirport && cfg.ausAirport.pickupNotice) ||
          "Airport pickups at AUS are coming soon. Drop-offs are available now.");
        updateAusNotice();
        goTo(1);
        return;
      }
      if (!policyAgreed()) {
        e.preventDefault();
        showError("Please agree to the rider policy before sending this request.");
        $("policy-agree").focus();
      }
    });
    $("policy-agree").addEventListener("change", function () {
      showError("");
      updateHandoff();
    });
    const policyLink = $("policy-link");
    if (policyLink) {
      policyLink.setAttribute("target", "_blank");
      policyLink.setAttribute("rel", "noopener noreferrer");
      policyLink.addEventListener("click", function (e) {
        e.stopPropagation();
      });
    }

    $("copy-btn").addEventListener("click", function () {
      const text = summaryText();
      const done = function () {
        $("copy-status").textContent = "Details copied. You can paste them into a text to 512.534.1855.";
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          fallbackCopy(text, done);
        });
      } else {
        fallbackCopy(text, done);
      }
    });

    $("book-form").addEventListener("submit", function (e) {
      e.preventDefault();
      tryContinue();
    });

    goTo(1);
    renderQuote();
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (err) {
      $("copy-status").textContent = "Copy wasn’t available. Please select the details and copy them.";
    }
    document.body.removeChild(ta);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.ZLSBook = { parseVoice: parseVoice, summaryText: summaryText, buildQuote: buildQuote };
})();
