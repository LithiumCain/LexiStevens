/**
 * ZLS Executive Concierge — pricing rules and quote math.
 * Keep this object in sync with /concierge/pricing.json
 */
(function (root) {
  "use strict";

  const CONFIG = {
    serviceName: "ZLS Executive Concierge",
    hourlyRate: 95,
    minimumMinutes: 30,
    incrementMinutes: 30,
    includedMiles: 20,
    perMileRate: 1,
    recurringDiscountRate: 0.15,
    deposit: 25,
    currency: "USD",
    domain: {
      name: "The Domain, Austin, TX",
      lat: 30.4022,
      lng: -97.7253,
    },
    // Return / deadhead fee is not charged. Left here so it can be
    // enabled later without rewriting the calculator. Do not charge it.
    // This is separate from a customer-requested return trip, which is
    // quoted as its own leg with the same time and mileage rules.
    returnFeeEnabled: false,
    returnFeeLabel: "Return fee",
    returnFeeAmount: 0,
    phoneE164: "+15125341855",
    phoneDisplay: "512.534.1855",
    // Square or Stripe deposit payment link. Leave empty to hide the pay button.
    paymentLink: "",
    // Payment handles are never shown while empty. Do not invent account names.
    paymentHandles: {
      zelle: "",
      cashapp: "",
      venmo: "",
    },
    paymentMethods: [
      { id: "zelle", label: "Zelle", timing: "during the trip" },
      { id: "cashapp", label: "Cash App", timing: "during the trip" },
      { id: "venmo", label: "Venmo", timing: "during the trip" },
      { id: "applepay", label: "Apple Pay", timing: "during the trip" },
      { id: "taptopay", label: "Tap to Pay", timing: "during the trip" },
      { id: "cash", label: "Cash", timing: "at pickup" },
    ],
    paymentNote:
      "Cash is paid at pickup. Tap to Pay, Apple Pay, Zelle, Cash App, and Venmo can be paid during the trip. A $25 deposit is arranged by text after you send the request.",
    vehicleSeatsComfortably: 4,
    packageMaxPassengers: 4,
    packages: {
      "6h": {
        id: "6h",
        hours: 6,
        price: 500,
        label: "6-hour night out / designated driver",
        shortLabel: "6-hour night out",
      },
      "10h": {
        id: "10h",
        hours: 10,
        price: 850,
        label: "10-hour night out / designated driver",
        shortLabel: "10-hour night out",
      },
    },
    // When false, the flat package price does not include mileage.
    // $1/mile beyond 20 miles from The Domain is still charged.
    packagesIncludeMileage: false,
    bookingUrl: "https://lexistevens.com/concierge/book/",
    pricingUrl: "https://lexistevens.com/concierge/pricing.json",
    // AUS airport pickups are not offered yet; drop-offs are available.
    ausAirport: {
      name: "Austin-Bergstrom International Airport (AUS)",
      lat: 30.1975,
      lng: -97.6664,
      pickupRadiusMiles: 1.5,
      pickupsEnabled: false,
      pickupNotice: "Airport pickups at AUS are coming soon. Drop-offs are available now.",
    },
  };

  function dollarsToCents(n) {
    return Math.round((Number(n) || 0) * 100);
  }

  function centsToDollars(c) {
    return (Number(c) || 0) / 100;
  }

  function formatMoney(n) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: CONFIG.currency,
    }).format(Number(n) || 0);
  }

  /**
   * Bill time in incrementMinutes slices, rounding UP, with a minimum.
   * 20 min → 30 min; 2h40m (160) → 180 min (3h).
   * Returns 0 when duration is missing or zero so the UI can wait for a time.
   */
  function billedMinutes(durationMinutes) {
    const minutes = Number(durationMinutes) || 0;
    if (minutes <= 0) return 0;
    const inc = CONFIG.incrementMinutes;
    const min = CONFIG.minimumMinutes;
    return Math.max(min, Math.ceil(minutes / inc) * inc);
  }

  function billableMiles(farthestMilesFromDomain) {
    const miles = Math.max(0, Number(farthestMilesFromDomain) || 0);
    const extra = Math.max(0, miles - CONFIG.includedMiles);
    // Tenth of a mile is enough for a $1/mi surcharge and avoids float drift.
    return Math.round(extra * 10) / 10;
  }

  /**
   * Count inclusive occurrences of selected weekdays between two YYYY-MM-DD dates.
   * weekdays: array of integers 0 (Sun) through 6 (Sat).
   */
  function parseISODateLocal(iso) {
    if (!iso || typeof iso !== "string") return null;
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function countRecurringTrips(weekdays, startISO, endISO) {
    const start = parseISODateLocal(startISO);
    const end = parseISODateLocal(endISO);
    const days = Array.isArray(weekdays) ? weekdays.map(Number).filter((d) => d >= 0 && d <= 6) : [];
    if (!start || !end || end < start || days.length === 0) return 0;
    const set = {};
    days.forEach((d) => {
      set[d] = true;
    });
    let count = 0;
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const max = 366 * 3;
    for (let i = 0; i <= max && cur <= last; i += 1) {
      if (set[cur.getDay()]) count += 1;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  /**
   * Price one leg (outbound or return) with the time and mileage rules.
   * Does not apply recurring discounts or multiply by occurrences.
   */
  function quoteLeg(input, label) {
    const src = input || {};
    const durationMinutes = Number(src.durationMinutes) || 0;
    const farthest = Math.max(0, Number(src.farthestMilesFromDomain) || 0);
    const billedMins = billedMinutes(durationMinutes);
    const billedHours = billedMins / 60;
    const timeCents = dollarsToCents(billedHours * CONFIG.hourlyRate);
    const extraMiles = billableMiles(farthest);
    const mileageCents = dollarsToCents(extraMiles * CONFIG.perMileRate);
    const totalCents = timeCents + mileageCents;
    return {
      label: label || "Trip",
      ready: billedMins > 0,
      durationMinutes,
      billedMinutes: billedMins,
      billedHours,
      farthestMilesFromDomain: farthest,
      billableMiles: extraMiles,
      timeCharge: centsToDollars(timeCents),
      mileageCharge: centsToDollars(mileageCents),
      total: centsToDollars(totalCents),
    };
  }

  /**
   * @param {object} input
   * @param {number} input.durationMinutes  estimated or routed drive time (outbound)
   * @param {number} input.farthestMilesFromDomain  driving miles from The Domain
   *   to the farthest point of the outbound leg (pickup, stop, or dropoff)
   * @param {boolean} [input.recurring]
   * @param {number} [input.occurrences]  number of trip dates in a series (min 1)
   * @param {object} [input.returnTrip]  optional return leg: { durationMinutes, farthestMilesFromDomain }
   *   A return trip is quoted as its own leg with the same rules and added to the total.
   *   If the series is recurring, the return is included on each occurrence before the 15% discount.
   * @param {string} [input.package]  "6h" or "10h" night-out / DD package. Recurring discounts
   *   and return-leg hourly billing do not apply. Mileage still applies when
   *   packagesIncludeMileage is false.
   */
  function getPackage(id) {
    if (!id) return null;
    const key = String(id).trim().toLowerCase();
    return CONFIG.packages[key] || null;
  }

  function calculateQuote(input) {
    const src = input || {};
    const pkg = getPackage(src.package);
    if (pkg) {
      const farthest = Math.max(0, Number(src.farthestMilesFromDomain) || 0);
      const extraMiles = billableMiles(farthest);
      const mileageCents = CONFIG.packagesIncludeMileage
        ? 0
        : dollarsToCents(extraMiles * CONFIG.perMileRate);
      const packageCents = dollarsToCents(pkg.price);
      const totalCents = packageCents + mileageCents;
      return {
        ready: true,
        isPackage: true,
        package: pkg,
        packageCharge: pkg.price,
        durationMinutes: src.durationMinutes ? Number(src.durationMinutes) || 0 : pkg.hours * 60,
        billedMinutes: pkg.hours * 60,
        billedHours: pkg.hours,
        farthestMilesFromDomain: farthest,
        billableMiles: extraMiles,
        occurrences: 1,
        recurring: false,
        hasReturn: false,
        outbound: null,
        returnLeg: null,
        timeCharge: 0,
        mileageCharge: centsToDollars(mileageCents),
        returnCharge: 0,
        perTrip: centsToDollars(totalCents),
        subtotal: centsToDollars(totalCents),
        discount: 0,
        total: centsToDollars(totalCents),
        deposit: CONFIG.deposit,
        currency: CONFIG.currency,
      };
    }

    const outbound = quoteLeg(
      {
        durationMinutes: src.durationMinutes,
        farthestMilesFromDomain: src.farthestMilesFromDomain,
      },
      "Outbound"
    );
    const hasReturn = Boolean(src.returnTrip);
    const returnLeg = hasReturn
      ? quoteLeg(
          {
            durationMinutes: src.returnTrip.durationMinutes,
            farthestMilesFromDomain: src.returnTrip.farthestMilesFromDomain,
          },
          "Return"
        )
      : null;

    const recurring = Boolean(src.recurring);
    const occurrences = recurring
      ? Math.max(1, Math.floor(Number(src.occurrences) || 1))
      : 1;

    let feeCents = 0;
    if (CONFIG.returnFeeEnabled && CONFIG.returnFeeAmount) {
      feeCents = dollarsToCents(CONFIG.returnFeeAmount);
    }

    const outboundCents = dollarsToCents(outbound.total);
    const returnCents = returnLeg ? dollarsToCents(returnLeg.total) : 0;
    const perTripCents = outboundCents + returnCents + feeCents;
    const subtotalCents = perTripCents * occurrences;
    const discountCents = recurring
      ? subtotalCents - Math.round(subtotalCents * (1 - CONFIG.recurringDiscountRate))
      : 0;
    const totalCents = subtotalCents - discountCents;

    const ready = outbound.ready && (!hasReturn || (returnLeg && returnLeg.ready));

    return {
      ready,
      isPackage: false,
      package: null,
      packageCharge: 0,
      durationMinutes: outbound.durationMinutes,
      billedMinutes: outbound.billedMinutes,
      billedHours: outbound.billedHours,
      farthestMilesFromDomain: outbound.farthestMilesFromDomain,
      billableMiles: outbound.billableMiles,
      occurrences,
      recurring,
      hasReturn,
      outbound,
      returnLeg,
      timeCharge: outbound.timeCharge,
      mileageCharge: outbound.mileageCharge,
      returnCharge: centsToDollars(feeCents),
      perTrip: centsToDollars(perTripCents),
      subtotal: centsToDollars(subtotalCents),
      discount: centsToDollars(discountCents),
      total: centsToDollars(totalCents),
      deposit: CONFIG.deposit,
      currency: CONFIG.currency,
    };
  }

  function formatHoursMinutes(totalMinutes) {
    const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return m + " min";
    if (m === 0) return h + (h === 1 ? " hr" : " hrs");
    return h + "h " + String(m).padStart(2, "0") + "m";
  }

  function formatMiles(miles) {
    const n = Number(miles) || 0;
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function milesBetween(a, b) {
    if (!a || !b || typeof a.lat !== "number" || typeof b.lat !== "number") return Infinity;
    const r = 3958.7613; // mean Earth radius in miles
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad((b.lng - a.lng));
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function looksLikeAusName(text) {
    const raw = String(text || "").trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();
    if (/\bbergstrom\b/.test(lower)) return true;
    if (/austin[-\s]?bergstrom/.test(lower)) return true;
    if (/austin\s+(international\s+)?airport/.test(lower)) return true;
    if (/^aus$/i.test(raw)) return true;
    if (/\baus\b/i.test(raw)) return true;
    return false;
  }

  function isAusAirportLocation(text, lat, lng) {
    if (looksLikeAusName(text)) return true;
    if (typeof lat === "number" && typeof lng === "number") {
      const miles = milesBetween(
        { lat: lat, lng: lng },
        { lat: CONFIG.ausAirport.lat, lng: CONFIG.ausAirport.lng }
      );
      return miles <= CONFIG.ausAirport.pickupRadiusMiles;
    }
    return false;
  }

  function paymentMethodById(id) {
    return CONFIG.paymentMethods.find((m) => m.id === id) || null;
  }

  const api = {
    CONFIG,
    calculateQuote,
    quoteLeg,
    billedMinutes,
    billableMiles,
    countRecurringTrips,
    parseISODateLocal,
    formatMoney,
    formatHoursMinutes,
    formatMiles,
    dollarsToCents,
    centsToDollars,
    paymentMethodById,
    getPackage,
    milesBetween,
    looksLikeAusName,
    isAusAirportLocation,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ZLSPricing = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
