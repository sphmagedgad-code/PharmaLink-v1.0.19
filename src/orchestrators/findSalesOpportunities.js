/**
 * Detect actionable buy/sell opportunities from imported WhatsApp data.
 * Never creates or confirms a deal automatically.
 */
import { getRecentEntities, getAllEntities } from '../db/repositories/parsedEntitiesRepo.js';
import { getAllMedicines, getMedicineById } from '../db/repositories/medicinesRepo.js';
import { getContactById, findContactByWhatsapp } from '../db/repositories/contactsRepo.js';
import { normalizeMedicineName } from '../shared/normalize.js';
import { getDealsByBuyer } from '../db/repositories/dealsRepo.js';
import { matchSellersForMedicine } from './matchSupplier.js';
import { DEAL_STATUS, PARSED_ENTITY_TYPE } from '../shared/constants.js';

function timestamp(value) {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : 0;
}

export async function findSalesOpportunities(scanLimit = 5000) {
  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let recentEntities = await getRecentEntities(Math.max(100, Math.min(50000, scanLimit)));
  // Some older imports have inconsistent date-index ordering. Recover from the source store,
  // then enforce the 30-day cutoff in memory without modifying or deleting records.
  if (!recentEntities.length) recentEntities = await getAllEntities();
  recentEntities = recentEntities.filter((entity) => {
    const time = timestamp(entity.receivedAt);
    return time > 0 && time >= cutoffMs;
  });
  const buyEntities = recentEntities.filter((entity) => entity.type === PARSED_ENTITY_TYPE.BUY);
  const sellEntities = recentEntities.filter((entity) => entity.type === PARSED_ENTITY_TYPE.SELL);
  const [allMedicines] = await Promise.all([getAllMedicines()]);
  const medicineByNormalizedName = new Map(allMedicines.map((medicine) => [normalizeMedicineName(medicine.name || medicine.normalizedName), medicine]));
  const dealsByBuyer = new Map();
  const matchesByMedicine = new Map();
  const dedup = new Map();

  for (const originalBuy of buyEntities) {
    const buyEntity = { ...originalBuy };
    // Repair missing links in-memory using exact normalized medicine name and phone.
    if (!buyEntity.medicineId) {
      const normalized = normalizeMedicineName(buyEntity.normalizedMedicineName || buyEntity.rawMedicineText || '');
      const medicine = medicineByNormalizedName.get(normalized);
      if (medicine) buyEntity.medicineId = medicine.id;
    }
    if (!buyEntity.contactId && buyEntity.phone) {
      const contact = await findContactByWhatsapp(buyEntity.phone).catch(() => null);
      if (contact) buyEntity.contactId = contact.id;
    }
    if (!buyEntity.medicineId || !buyEntity.contactId) continue;
    const key = `${buyEntity.contactId}|${buyEntity.medicineId}`;
    const prior = dedup.get(key);
    // Prefer the newest request for each buyer/medicine pair; keeps one
    // current opportunity card rather than repeating old messages.
    if (!prior || timestamp(buyEntity.receivedAt) > timestamp(prior.receivedAt)) dedup.set(key, buyEntity);
  }

  const opportunities = [];
  for (const buyEntity of dedup.values()) {
    if (!matchesByMedicine.has(buyEntity.medicineId)) {
      matchesByMedicine.set(buyEntity.medicineId, await matchSellersForMedicine(buyEntity.medicineId));
    }
    let sellerMatches = matchesByMedicine.get(buyEntity.medicineId) || [];
    // Fallback for legacy imports whose parsed SELL rows lack medicineId links.
    if (!sellerMatches.length) {
      const buyName = normalizeMedicineName(buyEntity.normalizedMedicineName || buyEntity.rawMedicineText || '');
      const fallback = [];
      for (const offer of sellEntities) {
        const offerName = normalizeMedicineName(offer.normalizedMedicineName || offer.rawMedicineText || '');
        if (!buyName || offerName !== buyName) continue;
        let contact = offer.contactId ? await getContactById(offer.contactId).catch(() => null) : null;
        if (!contact && offer.phone) contact = await findContactByWhatsapp(offer.phone).catch(() => null);
        if (!contact || contact.isSeller !== true) continue;
        fallback.push({
          contact, price: Number.isFinite(offer.price) && offer.price > 0 ? offer.price : null,
          date: offer.receivedAt || '', quantity: offer.quantity || null,
          phone: offer.phone || contact.whatsapp, isUrgent: Boolean(offer.isUrgent),
          source: 'whatsapp_offer_name_match', rawText: offer.rawMedicineText || '',
          potentialBrokerageAt7Percent: Number.isFinite(offer.price) && offer.price > 0 ? Math.round(offer.price * 0.07 * 100) / 100 : null,
        });
      }
      const latestBySeller = new Map();
      for (const match of fallback) {
        const prior = latestBySeller.get(match.contact.id);
        if (!prior || timestamp(match.date) > timestamp(prior.date)) latestBySeller.set(match.contact.id, match);
      }
      sellerMatches = Array.from(latestBySeller.values()).sort((a, b) => {
        if (a.price != null && b.price == null) return -1;
        if (a.price == null && b.price != null) return 1;
        if (a.price != null && b.price != null && a.price !== b.price) return a.price - b.price;
        return timestamp(b.date) - timestamp(a.date);
      });
    }
    if (!sellerMatches.length) continue;

    if (!dealsByBuyer.has(buyEntity.contactId)) {
      dealsByBuyer.set(buyEntity.contactId, await getDealsByBuyer(buyEntity.contactId));
    }
    const buyerDeals = dealsByBuyer.get(buyEntity.contactId) || [];
    const alreadyHandled = buyerDeals.some((deal) =>
      deal.medicineId === buyEntity.medicineId && deal.status !== DEAL_STATUS.CANCELLED
    );
    if (alreadyHandled) continue;

    const pricedMatches = sellerMatches.filter((match) => Number.isFinite(match.price) && match.price > 0);
    const bestPricedMatch = pricedMatches[0] || null;
    const latestSellerTime = sellerMatches.reduce((latest, match) => Math.max(latest, timestamp(match.date)), 0);
    const priceScore = bestPricedMatch ? 40 : 0;
    const urgencyScore = buyEntity.isUrgent ? 20 : 0;
    const recencyHours = latestSellerTime ? Math.max(0, (Date.now() - latestSellerTime) / 3600000) : 999999;
    const recencyScore = Math.max(0, 25 - Math.min(25, recencyHours / 4));
    const score = Math.round(priceScore + urgencyScore + recencyScore + (sellerMatches.length > 1 ? 5 : 0));

    opportunities.push({
      buyEntity,
      sellerMatches,
      bestPricedMatch,
      score,
      stars: Math.max(1, Math.min(5, Math.round(score / 20))),
      potentialBrokerage: bestPricedMatch ? bestPricedMatch.potentialBrokerageAt7Percent : null,
      hasConfirmedPrice: Boolean(bestPricedMatch),
    });
  }

  // Highest priority: urgent, confirmed lowest price, newest evidence,
  // then total opportunity score. Never pretend an inferred price is real.
  opportunities.sort((a, b) => {
    // Urgent buyer requests always lead, regardless of price.
    if (Boolean(a.buyEntity.isUrgent) !== Boolean(b.buyEntity.isUrgent)) {
      return Number(Boolean(b.buyEntity.isUrgent)) - Number(Boolean(a.buyEntity.isUrgent));
    }
    const ap = a.bestPricedMatch?.price;
    const bp = b.bestPricedMatch?.price;
    if (ap != null && bp == null) return -1;
    if (ap == null && bp != null) return 1;
    if (ap != null && bp != null && ap !== bp) return ap - bp;
    const timeDiff = timestamp(b.buyEntity.receivedAt) - timestamp(a.buyEntity.receivedAt);
    if (timeDiff) return timeDiff;
    return b.score - a.score;
  });
  return opportunities;
}
