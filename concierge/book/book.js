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
    return checked && checked.value === "yes" && !currentPackage() && !rideHome();
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
      "AUS drop-offs are available now. Airport pickups are coming soon.";
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

  /* ---------- friendly formatting ---------- */
  const STREET_ABBR = {
    drive: "Dr", street: "St", avenue: "Ave", boulevard: "Blvd", road: "Rd", lane: "Ln",
    parkway: "Pkwy", highway: "Hwy", court: "Ct", place: "Pl", circle: "Cir", trail: "Trl",
    terrace: "Ter", square: "Sq", expressway: "Expy", freeway: "Fwy", way: "Way", loop: "Loop",
    cove: "Cv", bend: "Bnd", crossing: "Xing", pass: "Pass", path: "Path", run: "Run",
  };
  const STREET_RE = /\b(drive|dr|street|st|avenue|ave|boulevard|blvd|road|rd|lane|ln|parkway|pkwy|highway|hwy|court|ct|place|pl|circle|cir|trail|trl|terrace|ter|way|loop|cove|cv|bend|crossing|expressway|freeway|run|path|pass)\.?$/i;
  const STATE_RE = /^(texas|tx)(\s+\d{5}(-\d{4})?)?$/i;
  const ZIP_RE = /^\d{5}(-\d{4})?$/;
  const COUNTRY_RE = /^(united states( of america)?|usa|us)$/i;
  const COUNTY_RE = /\bcounty$/i;

  function abbrStreet(s) {
    return s.replace(/\b([A-Za-z]+)\b\.?$/, function (m, w) {
      const a = STREET_ABBR[w.toLowerCase()];
      return a || m;
    });
  }

  /** "Moody Center, 2001, Robert Dedman Drive, Austin, Travis County, Texas, 78712, United States"
   *  -> { place: "Moody Center", detail: "2001 Robert Dedman Dr, Austin" } */
  function shortAddressParts(text) {
    const raw = String(text || "").trim();
    if (!raw) return { place: "", detail: "" };
    let parts = raw.split(",").map(function (p) { return p.trim(); }).filter(Boolean);
    const seen = {};
    parts = parts.filter(function (p) {
      const k = p.toLowerCase();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    // index of first "region" part (county / state / zip / country): the city sits just before it
    let regionAt = parts.length;
    for (let i = 0; i < parts.length; i += 1) {
      if (COUNTY_RE.test(parts[i]) || STATE_RE.test(parts[i]) || ZIP_RE.test(parts[i]) || COUNTRY_RE.test(parts[i])) {
        regionAt = i;
        break;
      }
    }
    const zipPart = parts.filter(function (p) { return ZIP_RE.test(p); })[0] ||
      ((parts.filter(function (p) { return STATE_RE.test(p); })[0] || "").match(/\d{5}/) || [""])[0];
    const head = parts.slice(0, regionAt);
    if (!head.length) return { place: raw, detail: "" };
    // merge a bare house number with the following street
    const merged = [];
    for (let i = 0; i < head.length; i += 1) {
      if (/^\d+[A-Za-z]?$/.test(head[i]) && head[i + 1] && !/^\d/.test(head[i + 1])) {
        merged.push(head[i] + " " + head[i + 1]);
        i += 1;
      } else if (merged.length && /^\d+[A-Za-z]?$/.test(head[i])) {
        continue; // stray duplicate number
      } else {
        merged.push(head[i]);
      }
    }
    let streetIdx = -1;
    for (let i = 0; i < merged.length; i += 1) {
      if (/^\d+\s+\S/.test(merged[i]) || STREET_RE.test(merged[i])) {
        streetIdx = i;
        break;
      }
    }
    let place = "";
    let street = "";
    if (streetIdx === -1) {
      place = merged[0];
    } else {
      street = abbrStreet(merged[streetIdx]);
      if (streetIdx > 0) place = merged[0];
    }
    let city = "";
    if (merged.length > 1) {
      const last = merged[merged.length - 1];
      if (last !== merged[0] && merged.length - 1 !== streetIdx) city = last;
    }
    if (!place && !street) place = merged[0];
    if (!place && !city && zipPart) city = zipPart;
    const detail = [street, city].filter(Boolean).join(", ");
    if (!place) return { place: detail, detail: "" };
    return { place: place, detail: detail };
  }
  function shortAddress(text) {
    const p = shortAddressParts(text);
    return p.detail ? p.place + " · " + p.detail : p.place;
  }

  function formatPhone(s) {
    const raw = String(s || "").trim();
    let d = raw.replace(/\D/g, "");
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    if (d.length === 10) return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
    return raw;
  }

  function niceName(s) {
    return String(s || "").trim().replace(/\s+/g, " ").split(" ").map(function (w) {
      if (!w) return w;
      const plain = w === w.toLowerCase() || w === w.toUpperCase();
      return w.split(/([-'’])/).map(function (seg) {
        if (/^[-'’]$/.test(seg) || !seg) return seg;
        return seg.charAt(0).toUpperCase() + (plain ? seg.slice(1).toLowerCase() : seg.slice(1));
      }).join("");
    }).join(" ");
  }

  function formatWhenShort(dateISO, timeHHMM, withYear) {
    const d = dateISO ? P.parseISODateLocal(dateISO) : null;
    const opts = { weekday: "short", month: "short", day: "numeric" };
    if (withYear) opts.year = "numeric";
    const datePart = d ? d.toLocaleDateString("en-US", opts) : "";
    let timePart = "";
    if (timeHHMM) {
      const parts = timeHHMM.split(":");
      const dt = new Date(2000, 0, 1, Number(parts[0]) || 0, Number(parts[1]) || 0);
      timePart = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    return [datePart, timePart].filter(Boolean).join(" · ");
  }

  function packageDisplayName(pkg) {
    if (!pkg) return "";
    if (pkg.id === "6h" || pkg.hours === 6) return "The Evening · 6 hours";
    if (pkg.id === "10h" || pkg.hours === 10) return "The Full Night · 10 hours";
    return pkg.shortLabel || pkg.label;
  }

  function addMoney(a, b) {
    return Math.round((Number(a) || 0) * 100 + (Number(b) || 0) * 100) / 100;
  }

  /* ---------- estimate receipt ---------- */
  function receiptRows(q) {
    const rows = [];
    if (q.isPackage && q.package) {
      rows.push([packageDisplayName(q.package), q.packageCharge]);
      if (q.mileageCharge > 0) {
        rows.push(["Mileage (" + P.formatMiles(q.billableMiles) + " mi beyond 20)", q.mileageCharge]);
      }
      return rows;
    }
    if (q.outbound) rows.push(["Outbound", q.outbound.timeCharge]);
    if (q.returnLeg) rows.push(["Return", q.returnLeg.timeCharge]);
    const miles = addMoney(q.outbound ? q.outbound.billableMiles : 0, q.returnLeg ? q.returnLeg.billableMiles : 0);
    const mileage = addMoney(q.outbound ? q.outbound.mileageCharge : 0, q.returnLeg ? q.returnLeg.mileageCharge : 0);
    if (mileage > 0) rows.push(["Mileage (" + P.formatMiles(miles) + " mi beyond 20)", mileage]);
    if (q.returnCharge > 0) rows.push(["Return fee", q.returnCharge]);
    if (q.recurring && q.occurrences > 1) {
      rows.push({ sub: true, label: "× " + q.occurrences + " trips", amount: q.subtotal });
      rows.push({ discount: true, label: "Repeating-trip discount (15%)", amount: q.discount });
    }
    return rows;
  }

  function legMath(leg, name) {
    return name + ": " + P.formatHoursMinutes(leg.durationMinutes) + " → billed " +
      P.formatHoursMinutes(leg.billedMinutes) + " at " + P.formatMoney(cfg.hourlyRate).replace(/\.00$/, "") + "/hr = " +
      P.formatMoney(leg.timeCharge);
  }

  function mathLines(q) {
    const lines = [];
    if (q.isPackage && q.package) {
      lines.push("Flat " + P.formatMoney(q.packageCharge) + " for " + q.package.hours + " hours, a party of up to " + cfg.packageMaxPassengers + ".");
      lines.push(q.mileageCharge > 0
        ? "Farthest point is " + P.formatMiles(q.farthestMilesFromDomain) + " mi from The Domain; the first 20 are included, then $1 a mile."
        : "The first 20 miles from The Domain are included, then $1 a mile.");
      lines.push("The repeating-trip discount doesn’t apply to packages.");
      return lines;
    }
    if (q.outbound) lines.push(legMath(q.outbound, "Outbound"));
    if (q.returnLeg) lines.push(legMath(q.returnLeg, "Return"));
    lines.push("30-minute minimum, then 15-minute blocks with a 5-minute grace.");
    const mileage = addMoney(q.outbound ? q.outbound.mileageCharge : 0, q.returnLeg ? q.returnLeg.mileageCharge : 0);
    lines.push("The first 20 miles from The Domain are included, then $1 a mile.");
    if (q.recurring && q.occurrences > 1) {
      lines.push(q.occurrences + " trips × " + P.formatMoney(q.perTrip) + " = " + P.formatMoney(q.subtotal) + ", then 15% off (−" + P.formatMoney(q.discount) + ").");
    }
    return lines;
  }

  function receiptHtml(q) {
    if (!q || !q.ready) {
      return '<p class="rc-empty">Add a pickup and a time, and your quote will appear here.</p>';
    }
    const rows = receiptRows(q).map(function (r) {
      if (Array.isArray(r)) {
        return '<div class="rc-row"><dt>' + escapeHtml(r[0]) + "</dt><dd>" + P.formatMoney(r[1]) + "</dd></div>";
      }
      if (r.discount) {
        return '<div class="rc-row rc-discount"><dt>' + escapeHtml(r.label) + "</dt><dd>−" + P.formatMoney(r.amount) + "</dd></div>";
      }
      return '<div class="rc-row rc-sub"><dt>' + escapeHtml(r.label) + "</dt><dd>" + P.formatMoney(r.amount) + "</dd></div>";
    }).join("");
    const math = mathLines(q).map(function (l) { return "<li>" + escapeHtml(l) + "</li>"; }).join("");
    return '<dl class="rc-rows">' + rows + "</dl>" +
      '<div class="rc-total"><span>Total</span><strong>' + P.formatMoney(q.total) + "</strong></div>" +
      '<p class="rc-deposit">' + P.formatMoney(cfg.deposit).replace(/\.00$/, "") + " deposit holds your time</p>" +
      '<details class="rc-math"><summary>How this is calculated</summary><ul>' + math + "</ul></details>";
  }

  function renderQuote() {
    updateAusNotice();
    const q = buildQuote();
    const totalText = q && q.ready ? P.formatMoney(q.total) : "—";
    $("quote-total").textContent = totalText;
    $("sticky-total").textContent = totalText;
    const html = receiptHtml(q);
    const keepOpen = function (root) {
      const d = root && root.querySelector("details.rc-math");
      return !!(d && d.open);
    };
    [$("quote-lines"), $("sticky-receipt")].forEach(function (el) {
      if (!el) return;
      const open = keepOpen(el);
      el.innerHTML = html;
      if (open) {
        const d = el.querySelector("details.rc-math");
        if (d) d.open = true;
      }
    });
    if (step === 4) renderReview();
    updateHandoff();
    updateOccurrences();
    renderSmart();
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

  /* ---------- trip details (shared by the card and the text) ---------- */
  function tripDetails() {
    const pkg = currentPackage();
    const pay = P.paymentMethodById(selectedPay());
    const d = {
      pkg: pkg,
      name: niceName(val("name")),
      phone: formatPhone(val("phone")),
      email: val("email"),
      pickup: val("pickup"),
      dropoff: val("dropoff"),
      stops: val("stops"),
      date: val("date"),
      time: val("time"),
      pax: Number(val("pax") || 1) || 1,
      bags: Number(val("bags") || 0) || 0,
      pet: !!($("pet") && $("pet").checked),
      pay: pay ? pay.label : "",
      payTiming: pay ? pay.timing : "",
      prefs: val("prefs"),
      notes: val("notes"),
      ret: null,
      repeat: null,
      rideHome: rideHome(),
      student: isStudent(),
      plans: smart.plans.slice(),
    };
    if (!pkg && isReturn()) {
      d.ret = {
        date: val("returnDate") || val("date"),
        time: val("returnTime"),
        from: val("returnPickup") || val("dropoff"),
        to: val("returnDropoff") || val("pickup"),
      };
    }
    if (!pkg && isRecurring()) {
      const q = quote || buildQuote();
      d.repeat = {
        days: selectedWeekdays().map(function (x) { return WEEKDAY_NAMES[x]; }).join(", "),
        start: val("start") || val("date"),
        end: val("end"),
        n: (q && q.occurrences) || 1,
      };
    }
    return d;
  }

  function shortDate(iso) {
    const d = iso ? P.parseISODateLocal(iso) : null;
    return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  }

  function summaryText() {
    const q = quote || buildQuote();
    const t = tripDetails();
    const lines = ["ZLS booking request"];
    if (t.name) lines.push("Name: " + t.name);
    if (t.phone) lines.push("Phone: " + t.phone);
    if (t.email) lines.push("Email: " + t.email);
    if (t.pickup) lines.push("From: " + shortAddress(t.pickup));
    if (t.dropoff) lines.push("To: " + shortAddress(t.dropoff));
    if (t.stops) lines.push("Stops: " + t.stops);
    const when = formatWhenShort(t.date, t.time, true);
    if (when) lines.push("When: " + when);
    lines.push("Type: " + (t.pkg ? packageDisplayName(t.pkg) : "Hourly") + (t.rideHome ? " · Ride home only" : ""));
    if (t.ret) {
      lines.push(
        "Return: " + formatWhenShort(t.ret.date, t.ret.time, false) +
          ", " + shortAddress(t.ret.from) + " → " + shortAddress(t.ret.to)
      );
    }
    if (t.repeat) {
      lines.push(
        "Repeat: " + (t.repeat.days || "—") + ", " + shortDate(t.repeat.start) + " – " + shortDate(t.repeat.end) +
          ", " + t.repeat.n + (t.repeat.n === 1 ? " trip" : " trips")
      );
    }
    lines.push("Riders: " + t.pax + (t.bags ? "  Bags: " + t.bags : ""));
    if (t.student) lines.push("Riding for a student: yes");
    if (t.pet) lines.push("Pet or service dog: yes");
    if (t.pay) lines.push("Pay: " + t.pay);
    if (t.prefs) lines.push("Perfect ride: " + t.prefs);
    if (t.notes) lines.push("Notes: " + t.notes);
    if (t.plans.length) lines.push("Planning ahead: " + t.plans.join("; "));
    if (q && q.ready) {
      lines.push("Estimate (confirmed by text):");
      receiptRows(q).forEach(function (r) {
        if (Array.isArray(r)) lines.push("  " + r[0] + ": " + P.formatMoney(r[1]));
        else if (r.discount) lines.push("  " + r.label + ": −" + P.formatMoney(r.amount));
        else lines.push("  " + r.label + ": " + P.formatMoney(r.amount));
      });
      lines.push("  Total: " + P.formatMoney(q.total));
    } else {
      lines.push("Estimate: to be confirmed");
    }
    lines.push("Deposit: " + P.formatMoney(cfg.deposit) + " by Square link after approval (24 hours to pay)");
    lines.push("Policy agreed: " + (policyAgreed() ? "yes" : "no"));
    return lines.join("\n");
  }

  /* ---------- review card ---------- */
  const ICONS = {
    riders: '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6"/>',
    bags: '<rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V4h6v3M9 20v1M15 20v1"/>',
    pet: '<circle cx="6" cy="10" r="1.8"/><circle cx="10" cy="6" r="1.8"/><circle cx="14" cy="6" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5c0 2-2 2.5-4 2.5S8 19 8 17Z"/>',
    pay: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
    prefs: '<path d="M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.6 6.7 19.5l1.1-6L3.4 9.3l6-.8Z"/>',
    notes: '<path d="M5 4h10l4 4v12H5Z"/><path d="M15 4v4h4M8 12h8M8 16h6"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    phone: '<path d="M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  };
  function icon(name) {
    return '<svg class="iti-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICONS[name] + "</svg>";
  }
  function stopHtml(kind, label, text) {
    const p = shortAddressParts(text);
    return '<li class="iti-stop iti-' + kind + '"><span class="iti-dot" aria-hidden="true"></span>' +
      '<span class="iti-k">' + escapeHtml(label) + "</span>" +
      '<span class="iti-place">' + escapeHtml(p.place || text) + "</span>" +
      (p.detail ? '<span class="iti-detail">' + escapeHtml(p.detail) + "</span>" : "") + "</li>";
  }
  function freeStopHtml(text) {
    return '<li class="iti-stop iti-via"><span class="iti-dot" aria-hidden="true"></span>' +
      '<span class="iti-k">Along the way</span><span class="iti-place iti-free">' + escapeHtml(text) + "</span></li>";
  }
  function secHead(title, goto) {
    return '<div class="iti-head"><h3 class="iti-title">' + escapeHtml(title) + "</h3>" +
      '<button type="button" class="iti-edit" data-goto="' + goto + '">Edit<span class="visually-hidden"> ' + escapeHtml(title.toLowerCase()) + "</span></button></div>";
  }
  function rowHtml(ic, main, sub) {
    return '<li class="iti-row">' + icon(ic) + '<span class="iti-row-main">' + escapeHtml(main) + "</span>" +
      (sub ? '<span class="iti-row-sub">' + escapeHtml(sub) + "</span>" : "") + "</li>";
  }

  function reviewHtml() {
    const t = tripDetails();
    let h = "";
    // the trip
    let trip = '<div class="iti-sec">' + secHead("Your trip", 1);
    const when = formatWhenShort(t.date, t.time, false);
    trip += '<p class="iti-when">' + escapeHtml(when || "Date and time to choose") + "</p>";
    trip += '<p class="iti-type">' + escapeHtml(t.pkg ? packageDisplayName(t.pkg) + " · up to " + cfg.packageMaxPassengers + " riders" : "Hourly · $119/hour") + "</p>";
    if (t.rideHome) trip += '<p class="iti-badge">Ride home only</p>';
    trip += '<ol class="iti-line">';
    if (t.pickup) trip += stopHtml("from", t.rideHome ? "I’ll pick you up at" : "Pickup", t.pickup);
    if (t.stops) trip += freeStopHtml(t.stops);
    if (t.dropoff) trip += stopHtml("to", t.rideHome ? "Home" : "Drop-off", t.dropoff);
    trip += "</ol>";
    if (t.repeat) {
      trip += '<ul class="iti-rows">' + rowHtml("repeat",
        "Repeats " + (t.repeat.days || ""),
        shortDate(t.repeat.start) + " – " + shortDate(t.repeat.end) + " · " + t.repeat.n + (t.repeat.n === 1 ? " trip" : " trips") + " · 15% off") + "</ul>";
    }
    trip += "</div>";
    h += trip;
    if (t.ret) {
      h += '<div class="iti-sec iti-return">' + secHead("Ride back", 2) +
        '<p class="iti-when">' + escapeHtml(formatWhenShort(t.ret.date, t.ret.time, false)) + "</p>" +
        '<ol class="iti-line iti-line-sm">' + stopHtml("from", "Pickup", t.ret.from) + stopHtml("to", "Drop-off", t.ret.to) + "</ol></div>";
    }
    // riders
    let who = '<div class="iti-sec">' + secHead("Who’s riding", 3) + '<ul class="iti-rows">';
    if (t.name) who += rowHtml("person", t.name, [t.phone, t.email].filter(Boolean).join(" · "));
    who += rowHtml("riders", t.pax + (t.pax === 1 ? " rider" : " riders"), "");
    if (t.bags) who += rowHtml("bags", t.bags + (t.bags === 1 ? " bag" : " bags"), "I’ll handle them");
    if (t.student) who += rowHtml("person", "Riding for a student", "");
    if (t.pet) who += rowHtml("pet", "A pet or service dog is coming", "They’re welcome");
    if (t.pay) who += rowHtml("pay", t.pay, t.payTiming ? "Paid " + t.payTiming : "");
    if (t.prefs) who += rowHtml("prefs", "Your perfect ride", t.prefs);
    if (t.notes) who += rowHtml("notes", "Notes", t.notes);
    if (t.plans.length) who += rowHtml("repeat", "Planning ahead", t.plans.join(" · "));
    who += "</ul></div>";
    h += who;
    return h;
  }

  function renderReview() {
    const card = $("review-card");
    if (card) card.innerHTML = reviewHtml();
    const pre = $("sms-preview");
    if (pre) pre.textContent = summaryText();
    const rr = $("review-receipt");
    if (rr) rr.innerHTML = receiptHtml(quote || buildQuote());
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
    const hint = $("policy-hint");
    if (hint) hint.hidden = agreed;
    const sticky = $("sticky-btn");
    if (sticky) sticky.classList.toggle("is-waiting", step === 4 && !agreed);
    const pre = $("sms-preview");
    if (pre && step === 4) pre.textContent = body;
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
    if (sticky) sticky.textContent = step === 4 ? "Send my request by text" : "Continue";
    if (step === 4) renderReview();
    updateHandoff();
    showError("");
    const title = $("step-" + step + "-title");
    if (title) title.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validateStep(n) {
    if (n === 1) {
      if (!val("pickup")) return "Where should I pick you up? Add a pickup address to continue.";
      if (ausPickupBlocked()) {
        return (cfg.ausAirport && cfg.ausAirport.pickupNotice) ||
          "AUS drop-offs are available now. Airport pickups are coming soon.";
      }
      return "";
    }
    if (n === 2) {
      if (ausPickupBlocked()) {
        return (cfg.ausAirport && cfg.ausAirport.pickupNotice) ||
          "AUS drop-offs are available now. Airport pickups are coming soon.";
      }
      if (!val("date") || !val("time")) return "Choose a date and time so I know when to be there.";
      if (isReturn() && !val("returnTime")) return "Please choose a return pickup time.";
      if (isRecurring()) {
        if (!selectedWeekdays().length) return "Please choose at least one weekday for the series.";
        if (!(val("start") || val("date")) || !val("end")) return "Please choose a start and end date for the series.";
      }
      const q = buildQuote();
      if (!currentPackage() && !q.ready && !manualOutboundOn()) {
        return "I need an estimated drive time to quote this. Open “Prefer to estimate time and miles yourself?” or add a dropoff I can map.";
      }
      if (isReturn() && q.hasReturn && !q.returnLeg.ready && !manualReturnOn()) {
        return "I need an estimated return drive time to quote the return leg.";
      }
      return "";
    }
    if (n === 3) {
      if (!val("name")) return "Please enter your name.";
      if (!val("phone")) return "I’ll need a mobile number to send your confirmation.";
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
      if (!policyAgreed()) return "One last thing: please agree to the rider policy before sending.";
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
        "AUS drop-offs are available now. Airport pickups are coming soon.");
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
      status.textContent = "Your messages app should open with everything filled in. Your ride is reserved when I text you back.";
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

  /* ---------- address search: Texas only, biased toward Austin ---------- */
  // Texas bounding box (west, south, east, north) and The Domain as the bias point.
  const TX_BOUNDS = { west: -106.65, south: 25.83, east: -93.5, north: 36.5 };
  const BIAS = { lat: 30.4021, lng: -97.7253 };
  const CENTRAL_TX_COUNTIES = /\b(travis|williamson|hays|bastrop|caldwell|burnet|blanco|comal|bell|lee)\b/i;

  function inTexasBox(lat, lng) {
    return isFinite(lat) && isFinite(lng) &&
      lat >= TX_BOUNDS.south && lat <= TX_BOUNDS.north &&
      lng >= TX_BOUNDS.west && lng <= TX_BOUNDS.east;
  }
  function isTexasState(s) {
    return /^(texas|tx|us-tx)$/i.test(String(s || "").trim());
  }
  function milesFromDomain(lat, lng) {
    const toRad = Math.PI / 180;
    const dLat = (lat - BIAS.lat) * toRad;
    const dLng = (lng - BIAS.lng) * toRad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(BIAS.lat * toRad) * Math.cos(lat * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  /** Keep the provider's relevance, but lift Austin / Central Texas hits when scores are close. */
  function rankTexas(results) {
    return results
      .map(function (r, i) {
        const miles = milesFromDomain(r.lat, r.lng);
        let score = (r.relevance != null ? r.relevance : 1 - i * 0.08);
        if (miles <= 35) score += 0.3;
        else if (miles <= 90) score += 0.15;
        if (r.county && CENTRAL_TX_COUNTIES.test(r.county)) score += 0.1;
        return { r: r, score: score, i: i };
      })
      .sort(function (a, b) { return b.score - a.score || a.i - b.i; })
      .map(function (x) { return x.r; })
      .filter(function (r, i, arr) {
        // drop near-duplicates (same label)
        return arr.findIndex(function (o) { return o.label.toLowerCase() === r.label.toLowerCase(); }) === i;
      })
      .slice(0, 6);
  }

  async function searchNominatim(query) {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&addressdetails=1&countrycodes=us" +
      "&viewbox=" + [TX_BOUNDS.west, TX_BOUNDS.north, TX_BOUNDS.east, TX_BOUNDS.south].join(",") +
      "&bounded=1&q=" + encodeURIComponent(query);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("nominatim");
    const data = await res.json();
    return (data || [])
      .filter(function (item) {
        const a = item.address || {};
        const lat = Number(item.lat);
        const lng = Number(item.lon);
        const texas = isTexasState(a.state) || isTexasState(a["ISO3166-2-lvl4"]) ||
          (!a.state && /,\s*Texas,/.test(item.display_name || ""));
        return texas && (!a.country_code || a.country_code === "us") && inTexasBox(lat, lng);
      })
      .map(function (item, i) {
        const a = item.address || {};
        return {
          label: String(item.display_name || "").replace(/,\s*United States$/, ""),
          lat: Number(item.lat),
          lng: Number(item.lon),
          county: a.county || "",
          relevance: Math.min(1, Number(item.importance) || 0) * 0.6 + (1 - i * 0.05) * 0.4,
        };
      });
  }

  async function searchPhoton(query) {
    const url =
      "https://photon.komoot.io/api/?limit=10&lang=en" +
      "&lat=" + BIAS.lat + "&lon=" + BIAS.lng +
      "&bbox=" + [TX_BOUNDS.west, TX_BOUNDS.south, TX_BOUNDS.east, TX_BOUNDS.north].join(",") +
      "&q=" + encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) throw new Error("photon");
    const data = await res.json();
    return ((data && data.features) || [])
      .filter(function (f) {
        const props = f.properties || {};
        const coords = (f.geometry && f.geometry.coordinates) || [];
        return isTexasState(props.state) &&
          (!props.countrycode || String(props.countrycode).toUpperCase() === "US") &&
          inTexasBox(coords[1], coords[0]);
      })
      .map(function (f, i) {
        const props = f.properties || {};
        const coords = (f.geometry && f.geometry.coordinates) || [];
        const street = [props.housenumber, props.street].filter(Boolean).join(" ");
        const name = props.name && props.name !== props.street ? props.name : "";
        const parts = [name, street, props.city || props.district || props.county, "TX", props.postcode].filter(Boolean);
        return {
          label: parts.join(", "),
          lat: coords[1],
          lng: coords[0],
          county: props.county || "",
          relevance: 1 - i * 0.08,
        };
      })
      .filter(function (r) { return r.label && r.label !== "TX"; });
  }

  // Photon is built for type-ahead and has no 1-request-per-second limit, so it runs first.
  // Nominatim (rate-limited) is only the fallback when Photon has nothing in Texas or is down.
  async function searchAddress(query) {
    const alias = aliasMatch(query);
    if (alias) return [alias];
    try {
      const results = await searchPhoton(query);
      if (results.length) return rankTexas(results);
    } catch (err) {
      /* fall through */
    }
    try {
      await waitForNominatim();
      return rankTexas(await searchNominatim(query));
    } catch (err2) {
      return [];
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
      emptyNote = "";
      list.hidden = true;
      list.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      active = -1;
    }
    let seq = 0;
    let emptyNote = "";
    function render() {
      if (!items.length && emptyNote) {
        list.innerHTML = '<li class="suggest-empty" role="option" aria-disabled="true">' + escapeHtml(emptyNote) + "</li>";
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        return;
      }
      list.innerHTML = items
        .map(function (item, i) {
          const p = shortAddressParts(item.label);
          return (
            '<li class="suggest-item" role="option" id="' +
            listId +
            "-" +
            i +
            '" aria-selected="' +
            (i === active ? "true" : "false") +
            '"><span class="suggest-place">' +
            escapeHtml(p.place || item.label) +
            "</span>" +
            (p.detail ? '<span class="suggest-detail">' + escapeHtml(p.detail) + "</span>" : "") +
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
      seq += 1;
      if (q.length < 3) {
        close();
        return;
      }
      const mine = seq;
      timer = setTimeout(function () {
        searchAddress(q).then(function (results) {
          if (mine !== seq) return; // a newer keystroke is already searching
          items = results;
          active = results.length ? 0 : -1;
          emptyNote = results.length ? "" : "No Texas addresses found. Try a street, city, or place name.";
          render();
        });
      }, 300);
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
      $("voice-status").textContent = "I’m listening. Where from, where to, and when?";
    };
    rec.onend = function () {
      btn.classList.remove("is-listening");
      btn.querySelector(".voice-btn-label").textContent = "Tell me about your trip";
    };
    rec.onerror = function () {
      $("voice-status").textContent = "I didn’t quite catch that. You’re welcome to type it instead.";
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
      prefs: "prefs",
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
    if (truthy(params.get("ridehome")) && $("ride-home")) $("ride-home").checked = true;
    if (truthy(params.get("student")) && $("student")) $("student").value = "1";
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
  /* ---------- smart concierge: ride home, contextual prompts, seasonal ---------- */
  const smart = {
    dismissed: {},
    plans: [],
  };
  const LABELS = {
    pickup: "Where should I pick you up?",
    dropoff: "Where to?",
    pickupHome: "Where I’ll pick you up",
    dropoffHome: "Where you’re headed home",
    pickupPh: "Street address or place name",
    pickupHomePh: "The bar, venue, or restaurant",
    dropoffPh: "An address, a venue, or AUS",
    dropoffHomePh: "Home, or wherever the night ends",
  };
  // detected silently; the matched words are never shown to the rider
  const SCHOOL_RE = /\b(elementary|middle school|high school|academy|prep|montessori|isd|school|preschool|daycare|day care|kindergarten|charter)\b/i;
  const EVENT_RE = /\b(moody|q2 stadium|acl live|bass concert|paramount|cota|circuit of the americas|rainey|6th st|sixth st|6th street|sixth street|west 6th|east 6th|congress|dkr|darrell k royal|long center|germania|stubb'?s?|emo'?s|bar|club|lounge|brewery|winery|rooftop|steakhouse|hotel)\b/i;
  const DOMAIN_RE = /\bdomain\b/i;
  const AIRPORT_RE = /\b(aus|airport|bergstrom)\b/i;
  const NEARBY = [
    { re: /\b(q2 stadium|domain)\b/i, text: "Nearby: The Domain’s Rock Rose district for dinner or a nightcap." },
    { re: /\b(cota|circuit of the americas)\b/i, text: "Nearby: Downtown and Rainey St are about 25 minutes back toward town." },
    { re: /\b(dkr|darrell k royal|bass concert)\b/i, text: "Nearby: Moody Center, Rainey St, or a quiet table on Congress Ave." },
    { re: /\b(moody|acl live|paramount|rainey|6th st|sixth st|6th street|sixth street|west 6th|east 6th|congress|long center|stubb'?s?|emo'?s|germania)\b/i, text: "Nearby: East 6th, Rainey St, or Congress Ave." },
  ];

  function rideHome() {
    const el = $("ride-home");
    return !!(el && el.checked);
  }
  function isStudent() {
    const el = $("student");
    return !!(el && el.value === "1");
  }
  function addrText(key) {
    return val(key) || (loc[key] && loc[key].text) || "";
  }
  function detectSchool() {
    return SCHOOL_RE.test(addrText("pickup")) || SCHOOL_RE.test(addrText("dropoff"));
  }
  function detectEvent() {
    const p = addrText("pickup");
    const d = addrText("dropoff");
    if (AIRPORT_RE.test(p) || AIRPORT_RE.test(d)) return null;
    if (SCHOOL_RE.test(p) || SCHOOL_RE.test(d)) return null;
    // The Domain is home base, so it only counts as a night out when it's the destination
    if (EVENT_RE.test(d) || DOMAIN_RE.test(d)) return { where: "dropoff", text: d };
    if (EVENT_RE.test(p)) return { where: "pickup", text: p };
    return null;
  }
  function nearbyLine(text) {
    for (let i = 0; i < NEARBY.length; i += 1) {
      if (NEARBY[i].re.test(text)) return NEARBY[i].text;
    }
    return "";
  }

  function syncRideHomeUI() {
    const on = rideHome();
    const pl = document.querySelector('label[for="pickup"]');
    const dl = document.querySelector('label[for="dropoff"]');
    if (pl) pl.textContent = on ? LABELS.pickupHome : LABELS.pickup;
    if (dl) dl.textContent = on ? LABELS.dropoffHome : LABELS.dropoff;
    if ($("pickup")) $("pickup").setAttribute("placeholder", on ? LABELS.pickupHomePh : LABELS.pickupPh);
    if ($("dropoff")) $("dropoff").setAttribute("placeholder", on ? LABELS.dropoffHomePh : LABELS.dropoffPh);
    const pill = $("ride-home-pill");
    if (pill) pill.classList.toggle("is-on", on);
    const chips = $("late-chips");
    if (chips) chips.hidden = !on;
    qsa("#late-chips [data-time]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(val("time") === b.getAttribute("data-time")));
    });
    const ret = $("return-toggle");
    if (ret) ret.hidden = on;
  }

  function setRadio(name, value) {
    const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (r) r.checked = true;
  }
  function setTimeValue(id, v) {
    const el = $(id);
    if (el) el.value = v;
  }
  function setRideHome(on) {
    const el = $("ride-home");
    if (!el) return;
    el.checked = on;
    if (on) {
      setRadio("package", "");
      setRadio("hasReturn", "no");
    }
  }

  function chipState(key) {
    switch (key) {
      case "school-repeat": {
        const days = selectedWeekdays().slice().sort().join(",");
        return isRecurring() && days === "1,2,3,4,5";
      }
      case "school-return":
        return isReturn() && val("returnTime") === "15:30";
      case "school-student":
        return isStudent();
      case "event-return":
        return isReturn() && val("returnTime") === "23:30";
      case "event-home":
        return rideHome() && val("time") === "01:30";
      case "event-home-2330":
        return rideHome() && val("time") === "23:30";
      case "event-evening": {
        const pkg = currentPackage();
        return !!(pkg && pkg.hours === 6);
      }
      default:
        return false;
    }
  }

  function swapEnds() {
    const p = val("pickup");
    const d = val("dropoff");
    const lp = loc.pickup;
    $("pickup").value = d;
    $("dropoff").value = p;
    loc.pickup = loc.dropoff;
    loc.dropoff = lp;
  }

  function applyChip(key) {
    const on = chipState(key);
    switch (key) {
      case "school-repeat":
        if (on) {
          setRadio("recurring", "no");
        } else {
          setRideHome(false);
          setRadio("package", "");
          setRadio("recurring", "yes");
          qsa('input[name="weekday"]').forEach(function (cb) {
            cb.checked = ["1", "2", "3", "4", "5"].indexOf(cb.value) !== -1;
          });
          if (!val("start") && val("date")) setVal("start", val("date"));
        }
        break;
      case "school-return":
        if (on) {
          setRadio("hasReturn", "no");
        } else {
          setRideHome(false);
          setRadio("package", "");
          setRadio("hasReturn", "yes");
          returnDefaultsApplied = false;
          setTimeValue("returnTime", "15:30");
          if (val("date")) setTimeValue("returnDate", val("date"));
        }
        break;
      case "school-student":
        $("student").value = on ? "" : "1";
        break;
      case "event-return":
        if (on) {
          setRadio("hasReturn", "no");
        } else {
          setRideHome(false);
          setRadio("package", "");
          setRadio("hasReturn", "yes");
          returnDefaultsApplied = false;
          setTimeValue("returnTime", "23:30");
          if (val("date")) setTimeValue("returnDate", val("date"));
        }
        break;
      case "event-home":
      case "event-home-2330": {
        if (on) {
          setRideHome(false);
        } else {
          const ev = detectEvent();
          if (ev && ev.where === "dropoff" && !rideHome()) swapEnds();
          setRideHome(true);
          setTimeValue("time", key === "event-home" ? "01:30" : "23:30");
        }
        break;
      }
      case "event-evening":
        if (on) {
          setRadio("package", "");
        } else {
          setRideHome(false);
          setRadio("package", "6h");
        }
        break;
      default:
        break;
    }
    syncRideHomeUI();
    syncConditionalUI();
    scheduleRoute();
  }

  function chipHtml(key, label) {
    const on = chipState(key);
    return '<button type="button" class="smart-chip" data-chip="' + key + '" aria-pressed="' + on + '">' +
      '<span class="smart-chip-mark" aria-hidden="true"></span>' + escapeHtml(label) + "</button>";
  }
  function cardHtml(id, title, sub, chips, extra) {
    return '<div class="smart-card" data-card="' + id + '">' +
      '<button type="button" class="smart-dismiss" data-dismiss="' + id + '" aria-label="Dismiss suggestion">×</button>' +
      '<p class="smart-eyebrow">A thought</p>' +
      '<p class="smart-title">' + escapeHtml(title) + "</p>" +
      (sub ? '<p class="smart-sub">' + escapeHtml(sub) + "</p>" : "") +
      '<div class="smart-chips">' + chips.join("") + "</div>" +
      (extra ? '<p class="smart-extra">' + escapeHtml(extra) + "</p>" : "") +
      "</div>";
  }

  /* seasonal nudges, by the month of the trip date (or today) */
  const SEASONS = {
    holidays: {
      months: [10, 11],
      title: "Planning ahead for the holidays?",
      sub: "Tick anything you’d like me to ask you about. No commitment.",
      options: ["Ask me about holiday parties", "Christmas / family travel", "New Year’s Eve", "Send me a reminder to book later"],
    },
    fall: {
      months: [9],
      title: "ACL Fest or race weekend on the calendar?",
      sub: "Tick anything you’d like me to ask you about. No commitment.",
      options: ["ACL Fest", "F1 weekend at COTA", "Halloween night", "Send me a reminder to book later"],
    },
    valentines: {
      months: [1],
      title: "Valentine’s plans coming up?",
      sub: "Tick anything you’d like me to ask you about. No commitment.",
      options: ["Valentine’s dinner", "A surprise for someone", "Send me a reminder to book later"],
    },
    sxsw: {
      months: [2],
      title: "SXSW in town?",
      sub: "Tick anything you’d like me to ask you about. No commitment.",
      options: ["SXSW days", "SXSW nights", "Spring break travel", "Send me a reminder to book later"],
    },
  };
  function currentSeason() {
    const d = val("date") ? P.parseISODateLocal(val("date")) : new Date();
    const m = d ? d.getMonth() : new Date().getMonth();
    const keys = Object.keys(SEASONS);
    for (let i = 0; i < keys.length; i += 1) {
      if (SEASONS[keys[i]].months.indexOf(m) !== -1) return SEASONS[keys[i]];
    }
    return null;
  }
  function seasonalHtml() {
    const s = currentSeason();
    const extra = smart.plans.filter(function (p) { return !s || s.options.indexOf(p) === -1; });
    if (!s && !extra.length) return "";
    if (smart.dismissed.season && !smart.plans.length) return "";
    const opts = (s ? s.options : []).concat(extra);
    return '<div class="smart-card smart-season" data-card="season">' +
      (smart.plans.length ? "" : '<button type="button" class="smart-dismiss" data-dismiss="season" aria-label="Dismiss suggestion">×</button>') +
      '<p class="smart-eyebrow">Planning ahead</p>' +
      '<p class="smart-title">' + escapeHtml(s ? s.title : "Planning ahead") + "</p>" +
      '<p class="smart-sub">' + escapeHtml(s ? s.sub : "") + "</p>" +
      '<div class="smart-chips">' + opts.map(function (o) {
        const on = smart.plans.indexOf(o) !== -1;
        return '<button type="button" class="smart-chip" data-plan="' + escapeHtml(o) + '" aria-pressed="' + on + '">' +
          '<span class="smart-chip-mark" aria-hidden="true"></span>' + escapeHtml(o) + "</button>";
      }).join("") + "</div></div>";
  }

  function renderInto(el, html) {
    if (!el) return;
    if (el.getAttribute("data-html") === html) return;
    const active = document.activeElement;
    const key = active && el.contains(active)
      ? (active.getAttribute("data-chip") || active.getAttribute("data-plan") || "")
      : "";
    el.innerHTML = html;
    el.setAttribute("data-html", html);
    el.hidden = !html;
    if (key) {
      const again = el.querySelector('[data-chip="' + key + '"],[data-plan="' + key.replace(/"/g, '\\"') + '"]');
      if (again) again.focus();
    }
  }

  function renderSmart() {
    syncRideHomeUI();
    let html = "";
    if (detectSchool() && !smart.dismissed.school) {
      html += cardHtml("school", "Looks like a school run.", "Want me to set any of these up?", [
        chipHtml("school-repeat", "Repeat Mon–Fri (15% off)"),
        chipHtml("school-return", "Add afternoon pickup"),
        chipHtml("school-student", "Riding for a student"),
      ], "");
    }
    const ev = detectEvent();
    if (ev && !smart.dismissed.event) {
      const chips = rideHome()
        ? [chipHtml("event-home-2330", "Pick us up at 11:30 PM"), chipHtml("event-home", "Pick us up at 1:30 AM")]
        : [
            chipHtml("event-return", "Add an 11:30 PM ride back"),
            chipHtml("event-home", "Just pick us up at 1:30 AM"),
            chipHtml("event-evening", "Make it The Evening (6 hrs · $600)"),
          ];
      html += cardHtml("event", "Heading out for the evening?", "A few easy ways to plan the ride home.", chips, nearbyLine(ev.text));
    }
    renderInto($("smart-prompts"), html);
    const season = seasonalHtml();
    renderInto($("seasonal-2"), season);
    renderInto($("seasonal-4"), season);
  }

  function bindSmart() {
    const rh = $("ride-home");
    if (rh) {
      rh.addEventListener("change", function () {
        if (rh.checked) {
          setRadio("package", "");
          setRadio("hasReturn", "no");
        }
        syncRideHomeUI();
        syncConditionalUI();
        scheduleRoute();
      });
    }
    document.addEventListener("click", function (e) {
      const t = e.target.closest ? e.target.closest("[data-chip],[data-plan],[data-dismiss],[data-time]") : null;
      if (!t || !$("book-form").contains(t)) return;
      if (t.hasAttribute("data-chip")) {
        applyChip(t.getAttribute("data-chip"));
      } else if (t.hasAttribute("data-plan")) {
        const p = t.getAttribute("data-plan");
        const i = smart.plans.indexOf(p);
        if (i === -1) smart.plans.push(p);
        else smart.plans.splice(i, 1);
        renderQuote();
      } else if (t.hasAttribute("data-dismiss")) {
        smart.dismissed[t.getAttribute("data-dismiss")] = true;
        renderQuote();
      } else if (t.hasAttribute("data-time")) {
        setTimeValue("time", t.getAttribute("data-time"));
        renderQuote();
      }
    });
    // the package radios and ride-home are mutually exclusive
    qsa('input[name="package"]').forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.checked && r.value && rh && rh.checked) {
          rh.checked = false;
          syncRideHomeUI();
        }
      });
    });
  }

  function init() {
    renderPayments();
    setDateMins();
    bindAutocomplete("pickup", "pickup-list", "pickup");
    bindAutocomplete("dropoff", "dropoff-list", "dropoff");
    bindAutocomplete("returnPickup", "returnPickup-list", "returnPickup");
    bindAutocomplete("returnDropoff", "returnDropoff-list", "returnDropoff");
    prefillFromQuery();
    bindSmart();
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
          "AUS drop-offs are available now. Airport pickups are coming soon.");
        updateAusNotice();
        goTo(1);
        return;
      }
      if (!policyAgreed()) {
        e.preventDefault();
        showError("One last thing: please agree to the rider policy before sending.");
        $("policy-agree").focus();
      }
    });
    $("review-card").addEventListener("click", function (e) {
      const btn = e.target.closest ? e.target.closest(".iti-edit") : null;
      if (!btn) return;
      goTo(Number(btn.getAttribute("data-goto")) || 1);
    });
    const stickyToggle = $("sticky-toggle");
    if (stickyToggle) {
      stickyToggle.addEventListener("click", function () {
        const box = $("sticky-receipt");
        const open = box.hidden;
        box.hidden = !open;
        this.setAttribute("aria-expanded", String(open));
        $("sticky-bar").classList.toggle("is-open", open);
      });
    }
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
        $("copy-status").textContent = "Copied. Paste it into a text to 512.534.1855 and I’ll take it from there.";
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

  window.ZLSBook = { parseVoice: parseVoice, summaryText: summaryText, buildQuote: buildQuote, searchAddress: searchAddress };
})();
