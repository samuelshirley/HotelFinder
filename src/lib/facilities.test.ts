import { describe, expect, it } from 'vitest';

import { curateFacilities, goodToKnow, ratingWord } from './facilities';

// The list Hotel Mio Vallarta sent (Sam's screenshot, 2026-11-11).
const MIO = ['Fitness facilities', 'WiFi available', 'Free WiFi', 'Parking', 'Free Parking', 'Non-smoking rooms', 'Air conditioning', 'Swimming pool', '24-hour front desk', 'Restaurant', 'Room service', 'Business center', 'Terrace', 'Pets allowed', 'Lift / Elevator', 'Laundry', 'Luggage storage', 'Bar', 'Ironing service', 'Meeting/banquet facilities', 'Dry cleaning', 'Currency exchange', 'Private parking', 'Outdoor pool', 'Sun terrace', 'Daily housekeeping', 'Designated smoking area', 'Parking garage', 'Snack bar', 'Adult only', 'Public Bath', 'Rooftop pool', 'Outdoor furniture', 'Wine/champagne', 'Pet bowls', 'Beach', 'Staff adhere to local safety protocols', 'Laundry washed per local authority guidelines', 'Hand sanitizer in guest room and key areas', 'Cashless payment available'];

describe('facilities, tamed', () => {
  const c = curateFacilities(MIO, { parking: 'FREE', petsAllowed: true });

  it('one entry per thing, free wins, the structured parking field wins over the strings', () => {
    expect(c.top.map((f) => f.label)).toEqual(['Free WiFi', 'Free parking', 'Pool', 'Air conditioning', 'Fitness centre', 'Pets allowed', 'Restaurant', 'Bar']);
  });

  it('compliance notices are hidden; the rest is grouped, nothing invented', () => {
    const all = c.groups.flatMap((g) => g.items);
    expect(all.join('|')).not.toMatch(/protocol|sanitizer|Cashless|authority guidelines/);
    for (const item of all) expect(MIO.includes(item) || ['Laundry', 'Airport shuttle'].includes(item)).toBe(true);
    expect(c.groups.map((g) => g.name)).toContain('Services & front desk');
    expect(c.count).toBe(c.top.length + all.length);
  });

  it('parking the hotel says is not available is not listed, whatever the strings say', () => {
    expect(curateFacilities(['Parking', 'Free WiFi'], { parking: 'NOT_AVAILABLE', petsAllowed: null }).top.map((f) => f.label)).toEqual(['Free WiFi']);
  });

  it('pets: the structured field decides', () => {
    expect(curateFacilities(['Pets allowed'], { parking: null, petsAllowed: false }).top).toEqual([]);
  });
});

describe('good to know', () => {
  const MIO_INFO =
    'When traveling with pets, please note that an additional charge of MXN 900 applies per pet, per night. Please note that a maximum of 2 pets is allowed per room. Guests are required to show a photo ID and credit card upon check-in. Please note that all Special Requests are subject to availability and additional charges may apply. A deposit may be required at the property.';
  it('up to three sentences, verbatim, about what a guest must know', () => {
    const picked = goodToKnow(MIO_INFO);
    expect(picked).toEqual([
      'When traveling with pets, please note that an additional charge of MXN 900 applies per pet, per night.',
      'Please note that a maximum of 2 pets is allowed per room.',
      'Guests are required to show a photo ID and credit card upon check-in.',
    ]);
    for (const s of picked) expect(MIO_INFO).toContain(s);
  });
  it('nothing for no text', () => expect(goodToKnow(null)).toEqual([]));
});

describe('rating words', () => {
  it('bands', () => {
    expect([9.2, 8.4, 7.1, 6.5, null].map(ratingWord)).toEqual(['Superb', 'Very good', 'Good', null, null]);
  });
});
