"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const pricing = require("./pricing.js");

const { calculateQuote, billedMinutes, billableMiles, countRecurringTrips, CONFIG } = pricing;

function almostEqual(actual, expected, label) {
  assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
}

// Houston: ~175 driving miles from The Domain, 2h40m → 165 min × $119 + 155 mi × $1 = $482.25
const houston = calculateQuote({
  durationMinutes: 160,
  farthestMilesFromDomain: 175,
  recurring: false,
});
almostEqual(houston.billedMinutes, 165, "Houston billed minutes");
almostEqual(houston.billedHours, 2.75, "Houston billed hours");
almostEqual(houston.timeCharge, 327.25, "Houston time charge");
almostEqual(houston.billableMiles, 155, "Houston billable miles");
almostEqual(houston.mileageCharge, 155, "Houston mileage charge");
almostEqual(houston.total, 482.25, "Houston total");
almostEqual(houston.deposit, 50, "Houston deposit");
almostEqual(houston.hasReturn, false, "Houston has no return");

// Five 30-min school runs, 15% off: $297.50 → $252.88
const school = calculateQuote({
  durationMinutes: 30,
  farthestMilesFromDomain: 20,
  recurring: true,
  occurrences: 5,
});
almostEqual(school.perTrip, 59.5, "School per-trip");
almostEqual(school.subtotal, 297.5, "School subtotal");
almostEqual(school.total, 252.88, "School series total");
almostEqual(school.discount, 44.62, "School discount");

// 20-minute local trip bills the 30-minute minimum: $59.50
const local = calculateQuote({
  durationMinutes: 20,
  farthestMilesFromDomain: 10,
  recurring: false,
});
almostEqual(local.billedMinutes, 30, "Local billed minutes");
almostEqual(local.billableMiles, 0, "Local billable miles");
almostEqual(local.timeCharge, 59.5, "Local time charge");
almostEqual(local.total, 59.5, "Local total");

// Return trip is its own leg with the same rules, then added to the total
const houstonRound = calculateQuote({
  durationMinutes: 160,
  farthestMilesFromDomain: 175,
  returnTrip: { durationMinutes: 160, farthestMilesFromDomain: 175 },
});
almostEqual(houstonRound.outbound.total, 482.25, "Round-trip outbound");
almostEqual(houstonRound.returnLeg.total, 482.25, "Round-trip return leg");
almostEqual(houstonRound.perTrip, 964.5, "Round-trip per occurrence");
almostEqual(houstonRound.total, 964.5, "Round-trip total");

// Recurring with a return: five days of 30-min out + 30-min back, 15% off
const schoolBothWays = calculateQuote({
  durationMinutes: 30,
  farthestMilesFromDomain: 10,
  recurring: true,
  occurrences: 5,
  returnTrip: { durationMinutes: 30, farthestMilesFromDomain: 10 },
});
almostEqual(schoolBothWays.perTrip, 119, "School both-ways per day");
almostEqual(schoolBothWays.subtotal, 595, "School both-ways subtotal");
almostEqual(schoolBothWays.total, 505.75, "School both-ways series total");

// Helpers
almostEqual(billedMinutes(0), 0, "No duration yet");
almostEqual(billedMinutes(20), 30, "20 minutes bills the 30-minute minimum");
almostEqual(billedMinutes(29), 30, "29 minutes bills the 30-minute minimum");
almostEqual(billedMinutes(31), 30, "31 minutes stays at the 30-minute minimum");
almostEqual(billedMinutes(35), 30, "35 minutes uses the 5-minute grace");
almostEqual(billedMinutes(36), 45, "36 minutes rounds up to 45");
almostEqual(billedMinutes(60), 60, "60 minutes bills as 1 hour");
almostEqual(billedMinutes(160), 165, "2h40m bills as 165 minutes");
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
almostEqual(pkgLocal.packageCharge, 600, "6h package price");
almostEqual(pkgLocal.mileageCharge, 0, "6h local mileage");
almostEqual(pkgLocal.discount, 0, "packages do not get recurring discount");
almostEqual(pkgLocal.total, 600, "6h local total");

const pkgHouston = calculateQuote({
  package: "6h",
  farthestMilesFromDomain: 175,
});
almostEqual(pkgHouston.billableMiles, 155, "6h Houston billable miles");
almostEqual(pkgHouston.mileageCharge, 155, "6h Houston mileage");
almostEqual(pkgHouston.total, 755, "6h Houston total");

const pkg10 = calculateQuote({
  package: "10h",
  farthestMilesFromDomain: 10,
});
almostEqual(pkg10.packageCharge, 950, "10h package price");
almostEqual(pkg10.total, 950, "10h local total");

almostEqual(CONFIG.packagesIncludeMileage, false, "packagesIncludeMileage is false (mileage charged)");
almostEqual(CONFIG.packages["6h"].price, 600, "config 6h price");
almostEqual(CONFIG.packages["10h"].price, 950, "config 10h price");

// Published pricing.json stays in sync with the calculator config
const published = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "pricing.json"), "utf8")
);
almostEqual(published.hourlyRate, CONFIG.hourlyRate, "pricing.json hourlyRate");
almostEqual(published.minimumMinutes, CONFIG.minimumMinutes, "pricing.json minimumMinutes");
almostEqual(published.incrementMinutes, CONFIG.incrementMinutes, "pricing.json incrementMinutes");
almostEqual(published.graceMinutes, CONFIG.graceMinutes, "pricing.json graceMinutes");
almostEqual(published.hourlyRate, 119, "published hourly rate is 119");
almostEqual(CONFIG.hourlyRate, 119, "config hourly rate is 119");
almostEqual(published.minimumCharge, 59.5, "published minimum charge");
almostEqual(published.includedMiles, CONFIG.includedMiles, "pricing.json includedMiles");
almostEqual(published.perMileRate, CONFIG.perMileRate, "pricing.json perMileRate");
almostEqual(published.recurringDiscountRate, CONFIG.recurringDiscountRate, "pricing.json discount");
almostEqual(published.deposit, CONFIG.deposit, "pricing.json deposit");
almostEqual(published.returnFeeEnabled, CONFIG.returnFeeEnabled, "pricing.json returnFeeEnabled");
almostEqual(published.mileageOrigin.lat, CONFIG.domain.lat, "pricing.json domain lat");
almostEqual(published.mileageOrigin.lng, CONFIG.domain.lng, "pricing.json domain lng");
almostEqual(published.examples[0].total, 482.25, "pricing.json Houston example");
almostEqual(published.examples[1].total, 252.88, "pricing.json school example");
almostEqual(published.examples[2].total, 59.5, "pricing.json local example");
almostEqual(published.examples[3].total, 964.5, "pricing.json Houston return example");
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
almostEqual(published.packages[0].price, 600, "pricing.json 6h");
almostEqual(published.packages[1].price, 950, "pricing.json 10h");
assert.ok(published.howToBook.deepLinkParams.pet, "pet param documented");
assert.ok(published.howToBook.deepLinkParams.package, "package param documented");

console.log("All pricing tests passed.");
console.log("  Houston 2h40m / 175 mi           →  $482.25");
console.log("  Five 30-min school runs          →  $252.88");
console.log("  20-minute local trip             →  $59.50");
console.log("  Houston with return leg          →  $964.50");
console.log("  Five school runs with return     →  $505.75");
console.log("  6h night out, local              →  $600.00");
console.log("  6h night out, 175 mi             →  $755.00");
console.log("  10h night out, local             →  $950.00");
