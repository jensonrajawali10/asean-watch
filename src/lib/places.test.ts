import { describe, expect, it } from 'vitest';
import {
  AIR_QUALITY_OFFICIAL,
  calendarDayLabel,
  FLOOD_OFFICIAL,
  ID_PROVINCE_UTC_OFFSET,
  localTimeLabel,
  placeRef,
  tideGaugeRef,
  TSUNAMI_OFFICIAL,
  utcOffsetHours,
} from './places';
import { AQ_PLACES } from './airQuality';

describe('utcOffsetHours', () => {
  it('uses the Indonesian zone of the province: WIB +7, WITA +8, WIT +9', () => {
    expect(utcOffsetHours({ country: 'ID', province: 'Central Kalimantan' })).toBe(7);
    expect(utcOffsetHours({ country: 'ID', province: 'South Kalimantan' })).toBe(8);
    expect(utcOffsetHours({ country: 'ID', province: 'Bali' })).toBe(8);
    expect(utcOffsetHours({ country: 'ID', province: 'Maluku' })).toBe(9);
    expect(utcOffsetHours({ country: 'ID', province: 'Papua' })).toBe(9);
    expect(Object.keys(ID_PROVINCE_UTC_OFFSET)).toHaveLength(38);
  });

  it('never guesses: an Indonesian place without a known province has no offset', () => {
    expect(utcOffsetHours({ country: 'ID' })).toBeNull();
    expect(utcOffsetHours({ country: 'ID', province: 'Atlantis' })).toBeNull();
    expect(utcOffsetHours({ country: 'AU' })).toBeNull();
    expect(utcOffsetHours(null)).toBeNull();
  });

  it('covers the single-zone countries in the brief', () => {
    expect(['MY', 'SG', 'TH', 'VN', 'KH', 'PH'].map((c) => utcOffsetHours({ country: c }))).toEqual([8, 8, 7, 7, 7, 8]);
  });

  it('knows the zone of every air-quality place on the map', () => {
    for (const p of AQ_PLACES) expect(utcOffsetHours(placeRef(p)), p.id).not.toBeNull();
    expect(utcOffsetHours(placeRef({ id: 'palangka-raya', country: 'ID' }))).toBe(7);
    expect(utcOffsetHours(placeRef({ id: 'kuching', country: 'MY' }))).toBe(8);
  });

  it('maps IOC tide gauge codes to their zone', () => {
    expect(utcOffsetHours(tideGaugeRef({ code: 'ambon', country: 'IDN' }))).toBe(9);
    expect(utcOffsetHours(tideGaugeRef({ code: 'beno', country: 'IDN' }))).toBe(8);
    expect(utcOffsetHours(tideGaugeRef({ code: 'pada', country: 'IDN' }))).toBe(7);
    expect(utcOffsetHours(tideGaugeRef({ code: 'newone', country: 'IDN' }))).toBeNull();
    expect(tideGaugeRef({ code: 'mani', country: 'FIL' })).toEqual({ country: 'PH', province: null });
    expect(utcOffsetHours(tideGaugeRef({ code: 'lank', country: 'MLS' }))).toBe(8);
  });
});

describe('localTimeLabel', () => {
  const PR = { country: 'ID', province: 'Central Kalimantan' };

  it('gives the computed weekday, local 12-hour time and UTC', () => {
    // 16 Oct 2026 is a Friday.
    expect(localTimeLabel('2026-10-16T10:00:00Z', PR)).toBe('Fri 16 Oct, 5:00 pm local (10:00 UTC)');
    expect(localTimeLabel('2026-10-16T10:00:00Z', PR, { utc: false })).toBe('Fri 16 Oct, 5:00 pm local');
    expect(localTimeLabel('2026-10-16T10:00:00Z', PR, { day: false, utc: false })).toBe('5:00 pm local');
  });

  it('rolls the local date over midnight and handles noon and midnight', () => {
    expect(localTimeLabel('2026-10-14T20:30:00Z', { country: 'SG' })).toBe('Thu 15 Oct, 4:30 am local (20:30 UTC)');
    expect(localTimeLabel('2026-10-14T05:00:00Z', { country: 'TH' })).toBe('Wed 14 Oct, 12:00 pm local (05:00 UTC)');
    expect(localTimeLabel('2026-10-14T17:00:00Z', { country: 'TH' })).toBe('Thu 15 Oct, 12:00 am local (17:00 UTC)');
    expect(localTimeLabel('2026-10-14T00:00:00Z', { country: 'MM' })).toBe('Wed 14 Oct, 6:30 am local (00:00 UTC)');
  });

  it('falls back to UTC only when the offset is unknown, and returns bad input unchanged', () => {
    expect(localTimeLabel('2026-10-16T10:00:00Z', { country: 'AU' })).toBe('Fri 16 Oct, 10:00 UTC');
    expect(localTimeLabel('2026-10-16T10:00:00Z', null, { day: false })).toBe('10:00 UTC');
    expect(localTimeLabel('not a time', PR)).toBe('not a time');
  });

  it('labels calendar days without a time-zone shift', () => {
    expect(calendarDayLabel('2026-10-16')).toBe('Fri 16 Oct');
    expect(calendarDayLabel('bad')).toBe('bad');
  });
});

describe('official links', () => {
  it('are https and cover the countries in the brief', () => {
    expect(Object.keys(AIR_QUALITY_OFFICIAL).sort()).toEqual(['ID', 'MY', 'PH', 'SG', 'TH']);
    expect(Object.keys(TSUNAMI_OFFICIAL).sort()).toEqual(['ID', 'JP', 'MY', 'PH', 'TH']);
    for (const l of [...Object.values(AIR_QUALITY_OFFICIAL), ...Object.values(TSUNAMI_OFFICIAL), ...Object.values(FLOOD_OFFICIAL)]) {
      expect(l.url).toMatch(/^https:\/\//);
      expect(l.label.length).toBeGreaterThan(3);
    }
  });
});
