"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const pricing = require("./pricing.js");

const { calculateQuote, billedMinutes, billableMiles, countRecurringTrips, CONFIG } = pricing;

function almostEqual(actual, expected, label) {
  assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
}

// Houston: ~175 driving miles from The Domain, 2h40m → 3h × $95 + 155 mi × $1 = $440
const houston = calculateQuote({
  durationMinutes: 160,
  farthestMilesFromDomain: 175,
  recurring: false,
});
almostEqual(houston.billedMinutes, 180, "Houston billed minutes");
almostEqual(houston.billedHours, 3, "Houston billed hours");
almostEqual(houston.timeCharge, 285, "Houston time charge");
almostEqual(houston.billableMiles, 155, "Houston billable miles");
almostEqual(houston.mileageCharge, 155, "Houston mileage charge");
almostEqual(houston.total, 440, "Houston total");
almostEqual(houston.deposit, 25, "Houston deposit");
almostEqual(houston.hasReturn, false, "Houston has no return");

// Five 30-min school runs, 15% off: $237.50 → $201.88
const school = calculateQuote({
  durationMinutes: 30,
  farthestMilesFromDomain: 20,
  recurring: true,
  occurrences: 5,
});
almostEqual(school.perTrip, 47.5, "School per-trip");
almostEqual(school.subtotal, 237.5, "School subtotal");
almostEqual(school.total, 201.88, "School series total");
almostEqual(school.discount, 35.62, "School discount");

// 20-minute local trip bills the 30-minute minimum: $47.50
const local = calculateQuote({
  durationMinutes: 20,
  farthestMilesFromDomain: 10,
  recurring: false,
});
almostEqual(local.billedMinutes, 30, "Local billed minutes");
almostEqual(local.billableMiles, 0, "Local billable miles");
almostEqual(local.timeCharge, 47.5, "Local time charge");
almostEqual(local.total, 47.5, "Local total");

// Return trip is its own leg with the same rules, then added to the total
const houstonRound = calculateQuote({
  durationMinutes: 160,
  farthestMilesFromDomain: 175,
  returnTrip: { durationMinutes: 160, farthestMilesFromDomain: 175 },
});
almostEqual(houstonRound.outbound.total, 440, "Round-trip outbound");
almostEqual(houstonRound.returnLeg.total, 440, "Round-trip return leg");
almostEqual(houstonRound.perTrip, 880, "Round-trip per occurrence");
almostEqual(houstonRound.total, 880, "Round-trip total");

// Recurring with a return: five days of 30-min out + 30-min back, 15% off
const schoolBothWays = calculateQuote({
  durationMinutes: 30,
  farthestMilesFromDomain: 10,
  recurring: true,
  occurrences: 5,
  returnTrip: { durationMinutes: 30, farthestMilesFromDomain: 10 },
});
almostEqual(schoolBothWays.perTrip, 95, "School both-ways per day");
almostEqual(schoolBothWays.subtotal, 475, "School both-ways subtotal");
almostEqual(schoolBothWays.total, 403.75, "School both-ways series total");

// Helpers
almostEqual(billedMinutes(0), 0, "No duration yet");
almostEqual(billedMinutes(31), 60, "31 minutes rounds up to 1 hour");
almostEqual(billableMiles(20), 0, "Exactly 20 miles is included");
almostEqual(billableMiles(20.4), 0.4, "Fractional miles beyond 20");

const weekdayCount = countRecurringTrips(
  [1, 2, 3, 4, 5],
  "2026-11-23",
  "2026-11-27"
);
almostEqual(weekdayCount, 5, "M-F of one week");

// Night-out / DD packages: flat rate; mileage still applies; no recurring discount
const pkgLocal = calculateQuote({
  package: "6h",
  farthestMilesFromDomain: 10,
  recurring: true,
  occurrences: 5,
});
almostEqual(pkgLocal.isPackage, true, "6h is a package");
almostEqual(pkgLocal.packageCharge, 500, "6h package price");
almostEqual(pkgLocal.mileageCharge, 0, "6h local mileage");
almostEqual(pkgLocal.discount, 0, "packages do not get recurring discount");
almostEqual(pkgLocal.total, 500, "6h local total");

const pkgHouston = calculateQuote({
  package: "6h",
  farthestMilesFromDomain: 175,
});
almostEqual(pkgHouston.billableMiles, 155, "6h Houston billable miles");
almostEqual(pkgHouston.mileageCharge, 155, "6h Houston mileage");
almostEqual(pkgHouston.total, 655, "6h Houston total");

const pkg10 = calculateQuote({
  package: "10h",
  farthestMilesFromDomain: 10,
});
almostEqual(pkg10.packageCharge, 850, "10h package price");
almostEqual(pkg10.total, 850, "10h local total");

almostEqual(CONFIG.packagesIncludeMileage, false, "packagesIncludeMileage is false (mileage charged)");
almostEqual(CONFIG.packages["6h"].price, 500, "config 6h price");
almostEqual(CONFIG.packages["10h"].price, 850, "config 10h price");

// Published pricing.json stays in sync with the calculator config
const published = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "pricing.json"), "utf8")
);
almostEqual(published.hourlyRate, CONFIG.hourlyRate, "pricing.json hourlyRate");
almostEqual(published.minimumMinutes, CONFIG.minimumMinutes, "pricing.json minimumMinutes");
almostEqual(published.incrementMinutes, CONFIG.incrementMinutes, "pricing.json incrementMinutes");
almostEqual(published.includedMiles, CONFIG.includedMiles, "pricing.json includedMiles");
almostEqual(published.perMileRate, CONFIG.perMileRate, "pricing.json perMileRate");
almostEqual(published.recurringDiscountRate, CONFIG.recurringDiscountRate, "pricing.json discount");
almostEqual(published.deposit, CONFIG.deposit, "pricing.json deposit");
almostEqual(published.returnFeeEnabled, CONFIG.returnFeeEnabled, "pricing.json returnFeeEnabled");
almostEqual(published.mileageOrigin.lat, CONFIG.domain.lat, "pricing.json domain lat");
almostEqual(published.mileageOrigin.lng, CONFIG.domain.lng, "pricing.json domain lng");
almostEqual(published.examples[0].total, 440, "pricing.json Houston example");
almostEqual(published.examples[1].total, 201.88, "pricing.json school example");
almostEqual(published.examples[2].total, 47.5, "pricing.json local example");
almostEqual(published.examples[3].total, 880, "pricing.json Houston return example");
almostEqual(published.paymentHandles.zelle, "", "handles stay empty");
almostEqual(published.paymentHandles.cashapp, "", "handles stay empty");
almostEqual(published.paymentHandles.venmo, "", "handles stay empty");
almostEqual(CONFIG.paymentHandles.zelle, "", "config handles stay empty");
assert.ok(published.howToBook.deepLinkParams.bags, "bags param documented");
assert.ok(published.howToBook.deepLinkParams.return, "return param documented");
assert.ok(published.howToBook.deepLinkParams.pay, "pay param documented");
almostEqual(published.paymentMethods.length, 6, "six payment methods");


const { isAusAirportLocation, looksLikeAusName, milesBetween } = pricing;
assert.strictEqual(looksLikeAusName("AUS"), true, "AUS code");
assert.strictEqual(looksLikeAusName("Austin-Bergstrom International Airport"), true, "Bergstrom name");
assert.strictEqual(looksLikeAusName("The Domain, Austin, TX"), false, "Austin city is not AUS");
assert.strictEqual(isAusAirportLocation("AUS"), true, "isAus name");
assert.strictEqual(isAusAirportLocation("Terminal, AUS", 30.1975, -97.6664), true, "isAus at airport coords");
assert.strictEqual(isAusAirportLocation("Nearby airport road", 30.1975, -97.6664), true, "within 1.5 mi of AUS");
assert.strictEqual(isAusAirportLocation("The Domain, Austin, TX", 30.4022, -97.7253), false, "Domain is not AUS");
const fromAirport = milesBetween({ lat: 30.1975, lng: -97.6664 }, { lat: 30.1975, lng: -97.6664 });
assert.ok(fromAirport < 0.01, "zero distance at airport point");
assert.ok(milesBetween({ lat: 30.1975, lng: -97.6664 }, { lat: 30.4022, lng: -97.7253 }) > 1.5, "Domain is farther than 1.5 mi");

almostEqual(published.packagesIncludeMileage, false, "pricing.json packagesIncludeMileage");
almostEqual(published.packages[0].price, 500, "pricing.json 6h");
almostEqual(published.packages[1].price, 850, "pricing.json 10h");
assert.ok(published.howToBook.deepLinkParams.pet, "pet param documented");
assert.ok(published.howToBook.deepLinkParams.package, "package param documented");

console.log("All pricing tests passed.");
console.log("  Houston 2h40m / 175 mi           →  $440.00");
console.log("  Five 30-min school runs          →  $201.88");
console.log("  20-minute local trip             →  $47.50");
console.log("  Houston with return leg          →  $880.00");
console.log("  Five school runs with return     →  $403.75");
console.log("  6h night out, local              →  $500.00");
console.log("  6h night out, 175 mi             →  $655.00");
console.log("  10h night out, local             →  $850.00");
