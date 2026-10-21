import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Incident, OfficialWarning, WarningFeedStatus } from '../types';
import { buildBriefing } from './briefing';
import { dataGovSgBackoffUntil, markDataGovSgRateLimited, resetNeaCache } from './nea';
import { deriveReview } from './reviewRules';
import { MAGMA_WATCHED, parseMagmaLevelList, selectMagmaVolcanoes } from './magmaLevels';
import * as warningsModule from './warnings';
import warningsSource from './warnings.ts?raw';
import mapViewSource from '../components/map/MapView.tsx?raw';
import {
  BUNDLED_WARNINGS_SNAPSHOT,
  FEEDS,
  GDACS_PREFIX,
  MAGMA_RETRIEVED_AT,
  THAIWATER_RELAY_MIN_LEVEL,
  compareWarnings,
  ictToUtc,
  jmaVolcanoGloss,
  loadOfficialWarnings,
  loadWarningsSnapshot,
  magmaRecords,
  parseBmkgGempa,
  parseBmkgTsunami,
  bmkgObservations,
  bmkgLevelInstruction,
  parseDsda,
  parseGdacs,
  parseGeonetVal,
  jmaNewestForecastPerEvent,
  JMA_MAX_EVENTS,
  parseJmaTsunami,
  parseJmaVolcano,
  parseMagmaSnapshot,
  parseNwsAlerts,
  parsePubFlood,
  parseThaiWater,
  resetWarningsCache,
  warningsNear,
  wibToUtc,
  xmlBlocks,
  xmlText,
  type ParseMeta,
} from './warnings';

// ---------------------------------------------------------------------------
// Trimmed REAL payloads captured 2026-10-13 (data/warnings-snapshot.json); map/image fields removed.

const INSTR = `     <instruction>Ikuti arahan peringatan dini TSUNAMI dari BPBD, BNPB dan BMKG</instruction>
     <instruction1>Pemerintah Propinsi/Kab/Kota yang berada pada status "Awas" diharap memperhatikan dan segera mengarahkan masyarakat untuk melakukan evakuasi menyeluruh</instruction1>
     <instruction2>Pemerintah Propinsi/Kab/Kota yang berada pada status "Siaga" diharap memperhatikan dan segera mengarahkan masyarakat untuk melakukan evakuasi</instruction2>
     <instruction3>Pemerintah Propinsi/Kab/Kota yang berada pada status "Waspada" diharap memperhatikan dan segera mengarahkan masyarakat untuk menjauhi pantai dan tepian sungai</instruction3>`;

const PD34_HEADLINE =
  'Pemutakhiran Peringatan Dini, Tsunami akibat gempa Mag:7.7 (30 km TimurLaut MBAY-NAGEKEO-NTT), telah terdeteksi di  BAKALANG-ALOR(05:41WIB)0.14m, BAUBAU(05:47WIB)0.30m::BMKG';

const BMKG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>Indonesia-InaTEWS-history-20260815073130</identifier>
  <sent>2026-08-15T07:31:30WIB</sent>
  <info>
     <event>Gempabumi</event>
     <date>15-08-26</date>
     <time>04:58:24 WIB</time>
     <point><coordinates>121.39,-8.41</coordinates></point>
     <magnitude>7.7</magnitude>
     <area>30 km TimurLaut MBAY-NAGEKEO-NTT</area>
     <eventid>20260815073130</eventid>
     <potential>Potensi TSUNAMI untuk diteruskan pada masyarakat</potential>
     <subject>Warning Tsunami PD-4</subject>
     <headline>Peringatan Dini TSUNAMI yang disebabkan oleh gempa Mag:7.7, 15-Agu-26 04:58:24 WIB, dinyatakan telah berakhir::BMKG</headline>
${INSTR}
     <timesent>15/08/2026 07:31:30WIB</timesent>
  </info>
  <info>
     <event>Gempabumi</event>
     <date>15-08-26</date>
     <time>04:58:24 WIB</time>
     <point><coordinates>121.39,-8.41</coordinates></point>
     <magnitude>7.7</magnitude>
     <area>30 km TimurLaut MBAY-NAGEKEO-NTT</area>
     <eventid>20260815070532</eventid>
     <subject>Warning Tsunami PD-3.4</subject>
     <headline>${PD34_HEADLINE}</headline>
${INSTR}
     <wzarea>
        <province>NTT</province>
        <district>MANGGARAI BAGIAN UTARA</district>
        <level>SIAGA</level>
        <date>15-08-2026</date>
        <time>05:02:23 WIB</time>
     </wzarea>
     <wzarea>
        <province>NTT</province>
        <district>PULAU ENDE</district>
        <level>WASPADA</level>
        <date>15-08-2026</date>
        <time>05:02:23 WIB</time>
     </wzarea>
     <obsarea>
        <location>BAKALANG-ALOR</location>
        <loclatitude>-8.26</loclatitude>
        <loclongitude>124.23</loclongitude>
        <height>0.14</height>
        <time>05:41 WIB</time>
     </obsarea>
     <timesent>15/08/2026 07:05:32WIB</timesent>
  </info>
  <info>
     <event>Gempabumi</event>
     <date>15-08-26</date>
     <time>04:58:23 WIB</time>
     <point><coordinates>121.32,-8.33</coordinates></point>
     <magnitude>7.0</magnitude>
     <area>38 km TimurLaut MBAY-NAGEKEO-NTT</area>
     <eventid>20260815050037</eventid>
     <subject>Warning Tsunami PD-1</subject>
     <headline>Peringatan Dini Tsunami untuk wilayah: NTT, Gempa Mag:7.0, 15-Agu-26 04:58:23 WIB, Lok:8.33 LS, 121.32 BT (38 km TimurLaut MBAY-NAGEKEO-NTT), Kedlmn:10 Km ::BMKG</headline>
${INSTR}
     <wzarea>
        <province>NTT</province>
        <district>NGADA BAGIAN UTARA</district>
        <level>WASPADA</level>
     </wzarea>
     <timesent>15/08/2026 05:00:37WIB</timesent>
  </info>
  <info>
     <event>Gempabumi</event>
     <date>08-06-26</date>
     <time>06:37:42 WIB</time>
     <point><coordinates>125.05,5.69</coordinates></point>
     <magnitude>7.7</magnitude>
     <area>236 km BaratLaut TAHUNA-KEP.SANGIHE-SULUT</area>
     <eventid>20260608064742</eventid>
     <subject>Warning Tsunami PD-1</subject>
     <headline>Peringatan Dini Tsunami untuk wilayah: GORONTALO, KALTIM, MALUT, SULTENG, SULUT, Gempa Mag:7.7, 08-Jun-26 06:37:42 WIB, Lok:5.69 LU, 125.05 BT (236 km BaratLaut TAHUNA-KEP.SANGIHE-SULUT), Kedlmn:105 Km ::BMKG</headline>
${INSTR}
     <wzarea>
        <province>SULUT</province>
        <district>KEPULAUAN SANGIHE</district>
        <level>SIAGA</level>
     </wzarea>
     <timesent>08/06/2026 06:47:42WIB</timesent>
  </info>
  <info>
     <event>Gempabumi</event>
     <subject>Warning Tsunami PD-9 (truncated block, must be ignored)
`;

const GEMPA = {
  identifier: 'Indonesia-InaTEWS-felt-Eq-20261013134228',
  sent: '2026-10-13T13:42:28WIB',
  info: {
    event: 'Gempabumi',
    date: '13-10-26',
    time: '13:42:28 WIB',
    point: { coordinates: '119.00,-9.75' },
    magnitude: '4.6',
    area: 'Pusat gempa berada di laut 15 km selatan Kodi-Sumba Barat Daya',
    eventid: '20261013134228',
    potential: 'Gempa ini dirasakan untuk diteruskan pada masyarakat',
    subject: 'Warning Gempa dirasakan',
    headline:
      'Info Gempa dirasakan Mag:4.6, 13-Okt-26 13:42:28 WIB, Lok:9.75 LS, 119.00 BT (Pusat gempa berada di laut 15 km selatan Kodi-Sumba Barat Daya), Kedlmn:16 Km ::BMKG',
    instruction: 'Hati-hati terhadap gempabumi susulan yang mungkin terjadi',
    felt: 'III Kab. Sumba Barat Daya',
    timesent: '13/10/2026 13:47:28WIB',
  },
};

const JMA_LIST = [
  { rdt: '2026-10-10T03:37:00+09:00', eid: '20261010025608', ttl: '津波予報', ift: '発表', json: '20261010033742_20261010025608_VTSE41_0.json' },
  { rdt: '2026-09-30T14:08:00+09:00', eid: '20260930140037', ttl: '津波予報', ift: '発表', json: '20260930140817_20260930140037_VTSE41_0.json' },
];
const JMA_DETAIL = {
  Head: {
    Title: '津波予報',
    ReportDateTime: '2026-10-10T03:37:00+09:00',
    ValidDateTime: '2026-10-11T20:00:00+09:00',
    EventID: '20261010025608',
    InfoType: '発表',
    Headline: { Text: '津波予報（若干の海面変動）を発表しました。' },
    enTitle: 'Tsunami Forecast',
  },
  Body: {
    Tsunami: {
      Forecast: {
        Item: [
          {
            Area: { Name: '北海道太平洋沿岸東部', Code: '100', enName: 'EASTERN PART OF PACIFIC COAST OF HOKKAIDO' },
            Category: { Kind: { Name: '津波予報（若干の海面変動）', Code: '71', enName: 'Tsunami Forecast' } },
            MaxHeight: { TsunamiHeight: '<0.2' },
          },
          {
            Area: { Name: '北海道太平洋沿岸中部', Code: '101', enName: 'CENTRAL PART OF PACIFIC COAST OF HOKKAIDO' },
            Category: { Kind: { Name: '津波予報（若干の海面変動）', Code: '71', enName: 'Tsunami Forecast' } },
            MaxHeight: { TsunamiHeight: '<0.2' },
          },
        ],
      },
    },
    Comments: {
      WarningComment: {
        Text: '＜津波予報（若干の海面変動）＞\n若干の海面変動が予想されますが、被害の心配はありません。',
        enText: '[Tsunami Forecast] Slight sea-level changes may be observed in coastal regions, but no tsunami damage is expected.\n',
      },
    },
  },
};
const JMA_DETAIL_URL = `https://www.jma.go.jp/bosai/tsunami/data/${JMA_LIST[0].json}`;
/** The older event's newest forecast (same document shape; its own EventID, time and areas). */
const JMA_DETAIL_OLD = {
  ...JMA_DETAIL,
  Head: { ...JMA_DETAIL.Head, ReportDateTime: JMA_LIST[1].rdt, ValidDateTime: '2026-10-01T14:00:00+09:00', EventID: JMA_LIST[1].eid },
  Body: { ...JMA_DETAIL.Body, Tsunami: { Forecast: { Item: [JMA_DETAIL.Body.Tsunami.Forecast.Item[0]] } } },
};
const JMA_DETAIL_OLD_URL = `https://www.jma.go.jp/bosai/tsunami/data/${JMA_LIST[1].json}`;

const JMA_WARNING = [
  {
    reportDatetime: '2022-07-27T20:00:00+09:00',
    eventId: '506',
    volcanoInfos: [
      { type: '噴火警報・予報（対象火山）', items: [{ name: 'レベル３（入山規制）', code: '13', condition: '引下げ', areas: [{ name: '桜島', code: '506' }] }] },
      { type: '噴火警報・予報（対象市町村等）', items: [{ name: '火口周辺警報', code: '02', condition: '発表', areas: [{ name: '鹿児島県鹿児島市', code: '4620100' }] }] },
      { type: '噴火警報・予報（対象市町村の防災対応等）', items: [{ name: '火口周辺警報：入山規制等', code: '43', condition: '引下げ', areas: [{ name: '鹿児島県鹿児島市', code: '4620100' }] }] },
    ],
  },
  {
    reportDatetime: '2026-10-08T11:00:00+09:00',
    eventId: '323',
    volcanoInfos: [
      { type: '噴火警報・予報（対象火山）', items: [{ name: '活火山であることに留意（海底火山）', code: '35', condition: '引下げ', areas: [{ name: 'ベヨネース列岩', code: '323' }] }] },
    ],
  },
];
const JMA_VOLCANO_LIST = [
  { code: '323', latlon: ['31.888', '139.918'], name_jp: 'ベヨネース列岩', name_en: 'Beyonesu Rocks' },
  { code: '506', latlon: ['31.593', '130.657'], name_jp: '桜島', name_en: 'Sakurajima' },
];

const GEONET = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [177.183, -37.521] },
      properties: {
        acc: 'Yellow',
        activity: 'Moderate to heightened volcanic unrest.',
        hazards: 'Volcanic unrest hazards, potential for eruption hazards.',
        level: 2,
        volcanoID: 'whiteisland',
        volcanoTitle: 'White Island',
      },
    },
  ],
};

const NWS_EMPTY = { type: 'FeatureCollection', features: [], title: 'Current watches, warnings, and advisories', updated: '2026-10-13T07:15:48+00:00' };

const GDACS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [155.7021, -7.0062] },
      properties: {
        eventtype: 'EQ', eventid: 1570810, episodeid: 1739237, name: 'Earthquake in Papua New Guinea',
        htmldescription: 'Green M 6.2 Earthquake in Papua New Guinea at: 11 Oct 2026 14:07:23.', alertlevel: 'Green',
        iscurrent: 'true', country: 'Papua New Guinea', fromdate: '2026-10-11T14:07:23', datemodified: '2026-10-13T02:03:51',
        url: { report: 'https://www.gdacs.org/report.aspx?eventid=1570810&episodeid=1739237&eventtype=EQ' },
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [168.1889, -15.5411] },
      properties: {
        eventtype: 'EQ', eventid: 1570077, episodeid: 1738390, name: 'Earthquake in Vanuatu',
        htmldescription: 'Orange M 6.3 Earthquake in Vanuatu at: 08 Oct 2026 09:00:07.', alertlevel: 'Orange',
        iscurrent: 'false', country: 'Vanuatu', fromdate: '2026-10-08T09:00:07', datemodified: '2026-10-09T15:01:35',
        url: { report: 'https://www.gdacs.org/report.aspx?eventid=1570077&episodeid=1738390&eventtype=EQ' },
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-19.8598, 0.1685] },
      properties: { eventtype: 'EQ', eventid: 1571248, episodeid: 1739722, name: 'Earthquake in Central Mid-Atlantic Ridge', alertlevel: 'Green', iscurrent: 'true', country: 'Central Mid-Atlantic Ridge', datemodified: '2026-10-13T06:10:15' },
    },
  ],
};

const SCALE = {
  result: 'OK',
  data: {
    scale: [
      { situation: 'น้ำล้นตลิ่ง', trans: 'waterlevel_level_5', text: '>100' },
      { situation: 'น้ำมาก', trans: 'waterlevel_level_4', text: '>70' },
      { situation: 'น้ำปกติ', trans: 'waterlevel_level_3', text: '>30' },
      { situation: 'น้ำน้อย', trans: 'waterlevel_level_2', text: '>10' },
      { situation: 'น้ำน้อยวิกฤติ', trans: 'waterlevel_level_1', text: '<=10' },
    ],
  },
};

function twRow(o: {
  dt: string; msl: string | null; discharge: string | null; level: number; code: string; name: Record<string, string>;
  lat: number; lon: number; minBank: number; diff: string; diffText: string; agency: string; amphoe: string; province: string; basin: string;
}) {
  return {
    waterlevel_datetime: o.dt, waterlevel_m: null, waterlevel_msl: o.msl, discharge: o.discharge, situation_level: o.level,
    agency: { agency_shortname: { en: o.agency } }, basin: { basin_name: { en: o.basin } },
    station: { tele_station_name: o.name, tele_station_lat: o.lat, tele_station_long: o.lon, tele_station_oldcode: o.code, left_bank: 5.06, right_bank: 6.209, min_bank: o.minBank, critical_level_msl: null },
    geocode: { amphoe_name: { en: o.amphoe }, province_name: { en: o.province } },
    diff_wl_bank: o.diff, diff_wl_bank_text: o.diffText,
  };
}

const THAIWATER = {
  waterlevel_data: {
    result: 'OK',
    data: [
      twRow({ dt: '2026-10-13 13:00', msl: '4.97', discharge: '1336.00', level: 5, code: 'C.35', name: { th: 'บ้านป้อม' }, lat: 14.3691, lon: 100.528732, minBank: 4.35, diff: '0.62', diffText: 'ล้นตลิ่ง (ม.)', agency: 'RID', amphoe: 'Phra Nakhon Si Ayutthaya District', province: 'Phra Nakhon Si Ayutthaya', basin: 'Chao Phraya Basin' }),
      twRow({ dt: '2026-10-13 14:10', msl: '5.38', discharge: null, level: 4, code: 'BPK004', name: { en: 'Phanom Sarakham', th: 'พนมสารคาม' }, lat: 13.72662, lon: 101.35298, minBank: 5.4, diff: '0.01', diffText: 'ต่ำกว่าตลิ่ง (ม.)', agency: 'HII', amphoe: 'Phanom Sarakham District', province: 'Chachoengsao', basin: 'Bang Pakong Basin' }),
      twRow({ dt: '2026-10-13 14:10', msl: '2.07', discharge: null, level: 3, code: 'TCP012', name: { en: 'Sena', th: 'เสนา (ทุ่งบางบาล-บ้านแพน)' }, lat: 14.327773, lon: 100.405464, minBank: 3, diff: '0.93', diffText: 'ต่ำกว่าตลิ่ง (ม.)', agency: 'HII', amphoe: 'Sena District', province: 'Phra Nakhon Si Ayutthaya', basin: 'Chao Phraya Basin' }),
      { waterlevel_datetime: '2026-10-13 13:00', waterlevel_msl: '1.00', situation_level: 5, station: { tele_station_oldcode: 'NOCOORD' } },
    ],
  },
  scale: SCALE,
};

const DSDA_XML = `<?xml version="1.0" standalone="yes"?>
<DocumentElement>
  <SP_GET_LAST_STATUS_PINTU_AIR>
    <ID_PINTU_AIR>116</ID_PINTU_AIR>
    <NAMA_PINTU_AIR>Bendung. Katulampa 2</NAMA_PINTU_AIR>
    <LOKASI>Ciliwung</LOKASI>
    <SIAGA1>2000</SIAGA1>
    <SIAGA2>1500</SIAGA2>
    <SIAGA3>800</SIAGA3>
    <SIAGA4>0</SIAGA4>
    <LATITUDE>-6.633167</LATITUDE>
    <LONGITUDE>106.836806</LONGITUDE>
    <FILE_EXPORT>KOTA BOGOR</FILE_EXPORT>
    <TANGGAL>2026-10-13T14:10:00+07:00</TANGGAL>
    <TINGGI_AIR>0</TINGGI_AIR>
    <STATUS_SIAGA>Status : Normal</STATUS_SIAGA>
  </SP_GET_LAST_STATUS_PINTU_AIR>
  <SP_GET_LAST_STATUS_PINTU_AIR>
    <ID_PINTU_AIR>203</ID_PINTU_AIR>
    <NAMA_PINTU_AIR>P.A. Marina Ancol 1 (Laut)</NAMA_PINTU_AIR>
    <LOKASI>Laut</LOKASI>
    <SIAGA1>2500</SIAGA1>
    <SIAGA2>2000</SIAGA2>
    <SIAGA3>1700</SIAGA3>
    <SIAGA4>1</SIAGA4>
    <LATITUDE>-6.125585</LATITUDE>
    <LONGITUDE>106.830154</LONGITUDE>
    <FILE_EXPORT>KOTA JAKARTA UTARA</FILE_EXPORT>
    <TANGGAL>2026-10-13T14:10:00+07:00</TANGGAL>
    <TINGGI_AIR>2000</TINGGI_AIR>
    <STATUS_SIAGA>Status : Siaga 2</STATUS_SIAGA>
  </SP_GET_LAST_STATUS_PINTU_AIR>
</DocumentElement>`;

const PUB_EMPTY = {
  code: 0,
  data: {
    records: [
      { datetime: '2026-10-13T15:16:54+08:00', item: { type: 'observation', readings: [], isStationData: false } },
      { datetime: '2026-10-13T15:18:54+08:00', item: { type: 'observation', readings: [], isStationData: false } },
    ],
  },
  errorMsg: '',
};

// ---------------------------------------------------------------------------

const LIVE: ParseMeta = { dataMode: 'live', retrievedAt: '2026-10-13T07:30:00Z' };
const flat = (t: string) => t.replace(/\s+/g, ' ');

beforeEach(() => {
  resetWarningsCache();
  resetNeaCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('time conversion', () => {
  it('parses BMKG WIB (UTC+7) forms to UTC, including across midnight', () => {
    expect(wibToUtc('15/08/2026 07:31:30WIB')).toBe('2026-08-15T00:31:30Z');
    expect(wibToUtc('15-08-2026 05:02:23 WIB')).toBe('2026-08-14T22:02:23Z');
    expect(wibToUtc('2026-08-15T07:31:30WIB')).toBe('2026-08-15T00:31:30Z');
    expect(wibToUtc('01/01/2026 03:00WIB')).toBe('2025-12-31T20:00:00Z');
    for (const bad of ['32/01/2026 03:00:00WIB', '2026-08-15T07:31:30', 'kemarin', null]) expect(wibToUtc(bad)).toBeNull();
  });

  it('parses ThaiWater ICT (UTC+7, no offset) and JMA JST (+09:00) to UTC', () => {
    expect(ictToUtc('2026-10-13 13:00')).toBe('2026-10-13T06:00:00Z');
    expect(ictToUtc('2026-10-13T13:00+07:00')).toBeNull();
    const w = parseJmaVolcano({ warning: JMA_WARNING, volcanoList: JMA_VOLCANO_LIST }, LIVE).warnings[0];
    expect(w.issuedAt).toBe('2022-07-27T11:00:00Z');
  });
});

describe('xml extractor', () => {
  it('decodes entities and CDATA, keeps inner spacing, and ignores a truncated trailing block', () => {
    expect(xmlText('<a> x &amp; y  z &#8211; &lt;b&gt; </a>', 'a')).toBe('x & y  z – <b>');
    expect(xmlText('<a><![CDATA[1 < 2]]></a>', 'a')).toBe('1 < 2');
    expect(xmlText('<a></a>', 'a')).toBeNull();
    expect(xmlBlocks('<i>1</i><i>2</i><i>3', 'i')).toEqual(['1', '2']);
    expect(xmlText('<wzarea><time>x</time></wzarea>', 'area')).toBeNull();
  });
});

describe('BMKG InaTEWS tsunami parser', () => {
  const { warnings, note } = parseBmkgTsunami(BMKG_XML, LIVE);
  const byId = (id: string) => warnings.find((w) => w.id === `bmkg-inatews:${id}`) as OfficialWarning;

  it('gives one warning per complete <info> with verbatim text', () => {
    expect(warnings).toHaveLength(4);
    const w = byId('20260815070532');
    expect(w).toMatchObject({
      issuer: 'BMKG InaTEWS',
      authority: 'official',
      hazard: 'tsunami',
      product: 'Warning Tsunami PD-3.4',
      level: 'SIAGA',
      levelGloss: null,
      headline: PD34_HEADLINE,
      areaDescription: '30 km TimurLaut MBAY-NAGEKEO-NTT',
      location: { lat: -8.41, lon: 121.39 },
      issuedAt: '2026-08-15T00:05:32Z',
      expiresAt: null,
      language: 'id',
      dataMode: 'live',
      sourceUrl: FEEDS.bmkgInatews.url,
    });
    expect(w.areas).toEqual([
      { name: 'MANGGARAI BAGIAN UTARA', level: 'SIAGA', lat: null, lon: null, province: 'NTT' },
      { name: 'PULAU ENDE', level: 'WASPADA', lat: null, lon: null, province: 'NTT' },
    ]);
    expect(w.instruction?.split('\n')).toEqual([
      'Ikuti arahan peringatan dini TSUNAMI dari BPBD, BNPB dan BMKG',
      'Pemerintah Propinsi/Kab/Kota yang berada pada status "Awas" diharap memperhatikan dan segera mengarahkan masyarakat untuk melakukan evakuasi menyeluruh',
      'Pemerintah Propinsi/Kab/Kota yang berada pada status "Siaga" diharap memperhatikan dan segera mengarahkan masyarakat untuk melakukan evakuasi',
      'Pemerintah Propinsi/Kab/Kota yang berada pada status "Waspada" diharap memperhatikan dan segera mengarahkan masyarakat untuk menjauhi pantai dan tepian sungai',
    ]);
    expect(byId('20260815050037').level).toBe('WASPADA');
    expect(byId('20260815073130').level).toBe('Warning Tsunami PD-4');
  });

  it('exports <obsarea> tide-gauge observations verbatim with their own coordinates', () => {
    const w = byId('20260815070532');
    // The fixture gives a time without a date, so there is no UTC instant (never guessed).
    expect(w.observations).toEqual([
      { location: 'BAKALANG-ALOR', lat: -8.26, lon: 124.23, heightM: 0.14, heightText: '0.14', observedAt: null, timeText: '05:41 WIB' },
    ]);
    expect(byId('20260815050037').observations).toBeUndefined();
  });

  it('converts a dated <obsarea> time from WIB to UTC and skips entries without a position or height', () => {
    const block = `<info>
      <obsarea><location>MAUROLE-ENDE</location><loclatitude>-8.47</loclatitude><loclongitude>121.84</loclongitude><height>0.94</height><date>15-08-2026</date><time>05:27 WIB</time></obsarea>
      <obsarea><location>NO-POSITION</location><height>0.30</height><date>15-08-2026</date><time>05:47 WIB</time></obsarea>
      <obsarea><location>NO-HEIGHT</location><loclatitude>-5.45</loclatitude><loclongitude>122.59</loclongitude><date>15-08-2026</date><time>05:47 WIB</time></obsarea>
    </info>`;
    expect(bmkgObservations(block)).toEqual([
      { location: 'MAUROLE-ENDE', lat: -8.47, lon: 121.84, heightM: 0.94, heightText: '0.94', observedAt: '2026-08-14T22:27:00Z', timeText: '05:27 WIB' },
    ]);
  });

  it('reads the real snapshot: the Flores Sea PD-3.4 message carries ten observed heights', () => {
    const real = parseBmkgTsunami(BUNDLED_WARNINGS_SNAPSHOT.feeds['bmkg-inatews'].raw, { dataMode: 'historical', retrievedAt: '2026-10-13T07:51:20Z' });
    const pd34 = real.warnings.find((x) => x.product === 'Warning Tsunami PD-3.4' && x.issuedAt === '2026-08-15T00:05:32Z') as OfficialWarning;
    expect(pd34.ended).toBe(true);
    expect(pd34.areas).toHaveLength(22);
    expect(pd34.observations).toHaveLength(10);
    const maurole = pd34.observations?.find((o) => o.location === 'MAUROLE-ENDE');
    expect(maurole?.heightM).toBe(0.94);
    expect(maurole?.observedAt).toBe('2026-08-14T22:27:00Z');
    // Verbatim height text, trailing zero kept.
    expect(pd34.observations?.find((o) => o.location === 'BAUBAU')?.heightText).toBe('0.30');
  });

  it("gives BMKG's own instruction line for each level, verbatim from the message", () => {
    const w = byId('20260815070532');
    expect(bmkgLevelInstruction(w, 'SIAGA')).toBe(
      'Pemerintah Propinsi/Kab/Kota yang berada pada status "Siaga" diharap memperhatikan dan segera mengarahkan masyarakat untuk melakukan evakuasi',
    );
    expect(bmkgLevelInstruction(w, 'awas')).toBe(
      'Pemerintah Propinsi/Kab/Kota yang berada pada status "Awas" diharap memperhatikan dan segera mengarahkan masyarakat untuk melakukan evakuasi menyeluruh',
    );
    expect(bmkgLevelInstruction(w, 'WASPADA')).toContain('menjauhi pantai dan tepian sungai');
    expect(bmkgLevelInstruction(w, 'NORMAL')).toBeNull();
    expect(bmkgLevelInstruction(w, null)).toBeNull();
    expect(bmkgLevelInstruction({ ...w, instruction: null }, 'SIAGA')).toBeNull();
  });

  it('shows no unsourced numbers: every level instruction on the real snapshot occurs verbatim in the BMKG XML', () => {
    const raw = BUNDLED_WARNINGS_SNAPSHOT.feeds['bmkg-inatews'].raw as string;
    const real = parseBmkgTsunami(raw, { dataMode: 'historical', retrievedAt: '2026-10-13T07:51:20Z' }).warnings;
    let checked = 0;
    for (const w of real) {
      for (const a of w.areas) {
        const text = bmkgLevelInstruction(w, a.level);
        if (text === null) continue;
        expect(raw).toContain(text);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
    // The memory-based wave-height gloss table is gone, and no wave-height thresholds are written into the
    // warnings adapter or the map (e.g. "0.5 to 3 m", "over 3 m", "under 0.5 m").
    expect((warningsModule as Record<string, unknown>).BMKG_TSUNAMI_GLOSS).toBeUndefined();
    for (const src of [warningsSource, mapViewSource]) {
      expect(src).not.toMatch(/\b(?:over|under|above|below)\s+\d+(?:[.,]\d+)?\s*m\b/i);
      expect(src).not.toMatch(/\d+(?:[.,]\d+)?\s*(?:to|-|–)\s*\d+(?:[.,]\d+)?\s*m\b/);
    }
  });

  it('never alters text: every headline, area name and instruction line occurs verbatim in the source XML', () => {
    for (const w of warnings) {
      expect(BMKG_XML).toContain(`<headline>${w.headline}</headline>`);
      for (const a of w.areas) expect(BMKG_XML).toContain(`<district>${a.name}</district>`);
      for (const line of w.instruction?.split('\n') ?? []) expect(BMKG_XML).toContain(line);
    }
  });

  it('marks every message of an event closed by a PD-4 as ended, even with revised magnitude and position', () => {
    for (const id of ['20260815073130', '20260815070532', '20260815050037']) expect(byId(id).ended).toBe(true);
    expect(byId('20260608064742').ended).toBe(false);
    expect(note).toContain('1 not ended by a PD-4 message');
  });
});

describe('BMKG datagempa parser', () => {
  it('relays the tsunami-potential statement as the level and the headline (with magnitude and product) verbatim', () => {
    const [w] = parseBmkgGempa(GEMPA, LIVE).warnings;
    expect(w).toMatchObject({
      hazard: 'earthquake',
      product: 'Warning Gempa dirasakan',
      level: 'Gempa ini dirasakan untuk diteruskan pada masyarakat',
      headline: GEMPA.info.headline,
      areaDescription: GEMPA.info.area,
      instruction: 'Hati-hati terhadap gempabumi susulan yang mungkin terjadi',
      issuedAt: '2026-10-13T06:47:28Z',
      location: { lat: -9.75, lon: 119 },
      language: 'id',
    });
    expect(w.headline).toContain('Mag:4.6');
  });
});

describe('JMA tsunami parser', () => {
  const raw = { list: JMA_LIST, detail: JMA_DETAIL, detailUrl: JMA_DETAIL_URL };

  it('relays Kind.enName with the Japanese original, per area, with ValidDateTime as expiry', () => {
    const { warnings } = parseJmaTsunami(raw, { dataMode: 'live', retrievedAt: '2026-10-10T00:00:00Z' });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({
      level: 'Tsunami Forecast (津波予報（若干の海面変動）)',
      headline: 'Tsunami Forecast: EASTERN PART OF PACIFIC COAST OF HOKKAIDO (北海道太平洋沿岸東部), maximum tsunami height <0.2 m',
      areaDescription: 'EASTERN PART OF PACIFIC COAST OF HOKKAIDO (北海道太平洋沿岸東部)',
      issuedAt: '2026-10-09T18:37:00Z',
      expiresAt: '2026-10-11T11:00:00Z',
      ended: false,
      instruction: '[Tsunami Forecast] Slight sea-level changes may be observed in coastal regions, but no tsunami damage is expected.',
      location: null,
      sourceUrl: JMA_DETAIL_URL,
      language: 'en',
    });
  });

  it('is ended once expired at retrieval, or when JMA cancels it', () => {
    expect(parseJmaTsunami(raw, { dataMode: 'historical', retrievedAt: '2026-10-11T11:00:00Z' }).warnings.every((w) => w.ended)).toBe(true);
    const cancelled = { ...raw, detail: { ...JMA_DETAIL, Head: { ...JMA_DETAIL.Head, InfoType: '取消' } } };
    expect(parseJmaTsunami(cancelled, { dataMode: 'live', retrievedAt: '2026-10-10T00:00:00Z' }).warnings.every((w) => w.ended)).toBe(true);
  });

  it('reports an empty list without all-clear wording', () => {
    const { warnings, note } = parseJmaTsunami({ list: [], detail: null }, LIVE);
    expect(warnings).toEqual([]);
    expect(note).toContain('Not an all-clear');
  });
});

describe('JMA volcano parser', () => {
  const { warnings } = parseJmaVolcano({ warning: JMA_WARNING, volcanoList: JMA_VOLCANO_LIST }, LIVE);

  it('keeps the Japanese level verbatim, joins English names and coordinates, and glosses codes 11-15 only', () => {
    expect(warnings[0]).toMatchObject({
      hazard: 'volcano',
      level: 'レベル３（入山規制）',
      levelGloss: 'JMA Volcanic Alert Level 3 of 5: entry to the volcano restricted',
      headline: 'Sakurajima (桜島): レベル３（入山規制）（引下げ）',
      areaDescription: '鹿児島県鹿児島市',
      location: { lat: 31.593, lon: 130.657 },
      instruction: '火口周辺警報：入山規制等',
      language: 'ja',
      expiresAt: null,
    });
    expect(warnings[1].level).toBe('活火山であることに留意（海底火山）');
    // No alert levels for a submarine volcano: JMA's eruption forecast keyword (checked on jma.go.jp, 2026-10-20).
    expect(warnings[1].levelGloss).toBe('JMA eruption forecast, no warning in force: note that this is an active volcano');
  });

  it('uses the fixed gloss table only, falling back to rank when the keyword differs', () => {
    expect(jmaVolcanoGloss('15', 'レベル５（避難）')).toBe('JMA Volcanic Alert Level 5 of 5 (highest): evacuate');
    expect(jmaVolcanoGloss('14', 'レベル４（高齢者等避難）')).toBe('JMA Volcanic Alert Level 4 of 5: elderly and others evacuate');
    expect(jmaVolcanoGloss('14', 'レベル４（避難準備）')).toBe('JMA Volcanic Alert Level 4 of 5');
    expect(jmaVolcanoGloss('22', '火口周辺危険')).toBeNull();
    // Volcanoes without alert levels: matched on JMA's own words (forecast vs warning for the surrounding sea).
    expect(jmaVolcanoGloss('35', '活火山であることに留意（海底火山）')).toBe('JMA eruption forecast, no warning in force: note that this is an active volcano');
    expect(jmaVolcanoGloss('36', '周辺海域警戒')).toBe('JMA eruption warning for the sea around this submarine volcano');
    expect(jmaVolcanoGloss('99', '噴火警報（周辺海域）')).toBe('JMA eruption warning for the sea around this submarine volcano');
    expect(jmaVolcanoGloss(null, 'x')).toBeNull();
  });
});

describe('GeoNet, NWS, GDACS and MAGMA', () => {
  it('GeoNet VAL: no issue time, level + aviation colour code + activity verbatim', () => {
    const [w] = parseGeonetVal(GEONET, LIVE).warnings;
    expect(w).toMatchObject({
      issuedAt: null,
      level: 'Volcanic Alert Level 2',
      headline:
        'White Island: Moderate to heightened volcanic unrest. Aviation Colour Code: Yellow. Hazards: Volcanic unrest hazards, potential for eruption hazards.',
      location: { lat: -37.521, lon: 177.183 },
    });
  });

  it('NWS: an empty result is a status, never an all-clear; alerts relay CAP fields and Cancel ends them', () => {
    const empty = parseNwsAlerts(NWS_EMPTY, LIVE);
    expect(empty.warnings).toEqual([]);
    expect(empty.note).toBe(
      'No active NWS tsunami alerts for Guam, CNMI, American Samoa or Hawaii at 2026-10-13T07:15:48Z. Not an all-clear for other areas.',
    );
    // Constructed to the NWS CAP GeoJSON schema (no tsunami alert was active at capture time).
    const props = {
      id: 'urn:oid:example', event: 'Tsunami Advisory', headline: 'Tsunami Advisory issued for Guam',
      areaDesc: 'Guam', sent: '2026-10-13T17:00:00+10:00', expires: '2026-10-13T19:00:00+10:00',
      instruction: 'Move out of the water and away from the beach.', messageType: 'Alert',
    };
    const one = parseNwsAlerts({ features: [{ properties: props, geometry: null }] }, LIVE).warnings[0];
    expect(one).toMatchObject({ level: 'Tsunami Advisory', headline: props.headline, instruction: props.instruction, issuedAt: '2026-10-13T07:00:00Z', expiresAt: '2026-10-13T09:00:00Z', ended: false });
    const cancel = parseNwsAlerts({ features: [{ properties: { ...props, messageType: 'Cancel' } }] }, LIVE).warnings[0];
    expect(cancel.ended).toBe(true);
  });

  it('GDACS is an aggregator, never styled as a warning, and is limited to the Asia-Pacific box', () => {
    const { warnings } = parseGdacs(GDACS, LIVE);
    expect(warnings).toHaveLength(2);
    for (const w of warnings) {
      expect(w.authority).toBe('aggregator');
      expect(w.headline.startsWith(`${GDACS_PREFIX}: `)).toBe(true);
    }
    expect(GDACS_PREFIX).toBe('Impact estimate (GDACS), not an official warning');
    expect(warnings[1]).toMatchObject({ level: 'Orange', ended: true, issuedAt: '2026-10-09T15:01:35Z', areaDescription: 'Vanuatu' });
    expect(warnings[0].sourceUrl).toBe('https://www.gdacs.org/report.aspx?eventid=1570810&episodeid=1739237&eventtype=EQ');
  });

  it('MAGMA: four bundled Level III (Siaga) records, Merapi exactly as specified', () => {
    const { warnings } = magmaRecords();
    expect(warnings.map((w) => w.areaDescription)).toEqual([
      'Anak Krakatau - Lampung',
      'Merapi - Daerah Istimewa Yogyakarta dan Jawa Tengah',
      'Semeru - Jawa Timur',
      'Sinabung - Sumatera Utara',
    ]);
    const merapi = warnings[1];
    expect(merapi).toMatchObject({
      issuer: 'PVMBG (Badan Geologi) via MAGMA Indonesia',
      issuerUrl: 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas',
      authority: 'official',
      level: 'Level III (Siaga)',
      levelGloss: 'Level 3 of 4 (Alert)',
      issuedAt: null,
      dataMode: 'historical',
      retrievedAt: MAGMA_RETRIEVED_AT,
      location: { lat: -7.54, lon: 110.446 },
    });
    expect(MAGMA_RETRIEVED_AT).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(merapi.headline).toContain("recorded from MAGMA Indonesia's public volcano activity level list");
    expect(merapi.headline).toContain('Check MAGMA for the current level.');
  });
});

describe('flood feeds', () => {
  it('ThaiWater: relays overflowing bank (level 5) verbatim with gauge, bank, discharge and units; keeps every gauge', () => {
    expect(THAIWATER_RELAY_MIN_LEVEL).toBe(5);
    const { warnings, gauges } = parseThaiWater(THAIWATER, LIVE);
    expect(warnings.map((w) => w.id)).toEqual(['thaiwater:C.35:2026-10-13T06:00:00Z']);
    expect(warnings[0]).toMatchObject({
      issuer: 'ThaiWater (Hydro-Informatics Institute)',
      hazard: 'flood',
      level: 'น้ำล้นตลิ่ง',
      levelGloss: 'Overflowing bank (ThaiWater situation level 5 of 5: above 100% of bank capacity)',
      headline: 'C.35 บ้านป้อม: water level 4.97 m MSL, 0.62 m above the lowest bank (4.35 m MSL) [ล้นตลิ่ง (ม.)], discharge 1336 m³/s (ThaiWater 2026-10-13 13:00 ICT)',
      areaDescription: 'Phra Nakhon Si Ayutthaya District, Phra Nakhon Si Ayutthaya, Chao Phraya Basin',
      location: { lat: 14.3691, lon: 100.528732 },
      issuedAt: '2026-10-13T06:00:00Z',
      language: 'th',
    });
    // Level 4 (high water) is not relayed as a warning but stays available as a gauge reading.
    expect(gauges.map((g) => [g.id, g.value, g.situation])).toEqual([
      ['thaiwater:C.35', 4.97, 'น้ำล้นตลิ่ง'],
      ['thaiwater:BPK004', 5.38, 'น้ำมาก'],
      ['thaiwater:TCP012', 2.07, 'น้ำปกติ'],
    ]);
    expect(gauges[0]).toMatchObject({ unit: 'm', datum: 'MSL', observedAt: '2026-10-13T06:00:00Z', thresholds: { minBank: 4.35, leftBank: 5.06, rightBank: 6.209 } });
  });

  it('DSDA: relays non-Normal status verbatim with all four thresholds in cm; Siaga 1 is the most severe', () => {
    const { warnings, gauges } = parseDsda(DSDA_XML, LIVE);
    expect(gauges.map((g) => [g.name, g.value, g.unit, g.situation])).toEqual([
      ['Bendung. Katulampa 2', 0, 'cm', 'Status : Normal'],
      ['P.A. Marina Ancol 1 (Laut)', 200, 'cm', 'Status : Siaga 2'],
    ]);
    expect(gauges[0].thresholds).toEqual({ siaga1: 200, siaga2: 150, siaga3: 80, siaga4: 0 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      level: 'Status : Siaga 2',
      headline: 'P.A. Marina Ancol 1 (Laut) (Laut): water level 200 cm; DSDA Siaga thresholds: Siaga 1 250 cm, Siaga 2 200 cm, Siaga 3 170 cm, Siaga 4 0.1 cm',
      issuedAt: '2026-10-13T07:10:00Z',
      language: 'id',
    });
    expect(warnings[0].levelGloss).toContain('Siaga 1 is the most severe');
  });

  it('PUB: an empty result is a feed status with the reading time; alerts are relayed even with unknown fields', () => {
    const empty = parsePubFlood(PUB_EMPTY, LIVE);
    expect(empty.warnings).toEqual([]);
    expect(empty.note).toBe('No active PUB flood alerts at 2026-10-13T07:18:54Z');
    // Constructed: the populated alert schema has not been observed yet.
    const reading = { location: 'Jalan Example', status: 'Flash flood risk', message: 'Flash flood at Jalan Example.', latitude: 1.33, longitude: 103.9 };
    const odd = { foo: 'bar' };
    const alerts = parsePubFlood({ data: { records: [{ datetime: '2026-10-13T15:20:54+08:00', item: { readings: [reading, odd] } }] } }, LIVE).warnings;
    expect(alerts[0]).toMatchObject({ level: 'Flash flood risk', headline: 'Flash flood at Jalan Example.', areaDescription: 'Jalan Example', location: { lat: 1.33, lon: 103.9 }, issuedAt: '2026-10-13T07:20:54Z' });
    expect(alerts[1].headline).toBe('{"foo":"bar"}');
  });
});

describe('warningsNear and ordering', () => {
  const snap = loadWarningsSnapshot();

  it('finds the MAGMA notice near Merapi and Sinabung, and excludes warnings without coordinates', () => {
    expect(warningsNear(snap.warnings, -7.54, 110.446, 50).map((w) => w.id)).toContain(`magma-level-list:263250:${MAGMA_RETRIEVED_AT}`);
    expect(warningsNear(snap.warnings, 3.17, 98.392, 50).some((w) => w.areaDescription === 'Sinabung - Sumatera Utara')).toBe(true);
    expect(warningsNear(snap.warnings, -7.54, 110.446, 50).some((w) => w.areaDescription.startsWith('Semeru'))).toBe(false);
    const noCoords = snap.warnings.filter((w) => w.id.startsWith('jma-tsunami'));
    expect(noCoords.length).toBeGreaterThan(0);
    expect(warningsNear(noCoords, 43, 145, 20000)).toEqual([]);
  });

  it('matches by area coordinates too', () => {
    const w = { ...magmaRecords().warnings[0], location: null };
    expect(warningsNear([w], -6.1009, 105.4233, 1)).toHaveLength(1);
  });

  it('sorts by issuedAt descending with nulls last', () => {
    const issued = snap.warnings.map((w) => w.issuedAt);
    const firstNull = issued.indexOf(null);
    expect(firstNull).toBeGreaterThan(0);
    expect(issued.slice(firstNull).every((t) => t === null)).toBe(true);
    const dated = issued.slice(0, firstNull) as string[];
    expect([...dated].sort().reverse()).toEqual(dated);
    expect([...snap.warnings].sort(compareWarnings)).toEqual(snap.warnings);
  });
});

// ---------------------------------------------------------------------------
// Loader

type Reply = { body?: unknown; text?: string; status?: number } | Error | 'never';

function replies(): Map<string, Reply> {
  return new Map<string, Reply>([
    [FEEDS.bmkgInatews.url, { text: BMKG_XML }],
    [FEEDS.bmkgGempa.url, { body: GEMPA }],
    [FEEDS.jmaTsunami.url, { body: JMA_LIST }],
    [JMA_DETAIL_URL, { body: JMA_DETAIL }],
    [JMA_DETAIL_OLD_URL, { body: JMA_DETAIL_OLD }],
    [FEEDS.jmaVolcano.url, { body: JMA_WARNING }],
    ['https://www.jma.go.jp/bosai/volcano/const/volcano_list.json', { body: JMA_VOLCANO_LIST }],
    [FEEDS.geonet.url, { body: GEONET }],
    [FEEDS.nws.url, { body: NWS_EMPTY }],
    [FEEDS.gdacs.url, { body: GDACS }],
    [FEEDS.thaiwater.url, { body: THAIWATER }],
    [FEEDS.dsda.url, { text: DSDA_XML }],
    [FEEDS.pub.url, { body: PUB_EMPTY }],
  ]);
}

function fakeFetch(overrides: Record<string, Reply> = {}) {
  const map = replies();
  for (const [k, v] of Object.entries(overrides)) map.set(k, v);
  const calls: string[] = [];
  const fn = ((url: string) => {
    const u = String(url);
    calls.push(u);
    const key = [...map.keys()].find((k) => u === k || u.startsWith(`${k}?`));
    const reply = key ? map.get(key) : new Error(`unexpected url ${u}`);
    if (reply === 'never') return new Promise(() => undefined);
    if (reply instanceof Error) return Promise.reject(reply);
    const status = reply?.status ?? 200;
    return Promise.resolve({
      ok: status < 400,
      status,
      json: async () => reply?.body,
      text: async () => reply?.text ?? JSON.stringify(reply?.body),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const statusOf = (feeds: WarningFeedStatus[], id: string) => feeds.find((f) => f.feedId === id) as WarningFeedStatus;

describe('loadOfficialWarnings', () => {
  it('loads every feed live, MAGMA as its bundled record, sorted', async () => {
    const { fn } = fakeFetch();
    const r = await loadOfficialWarnings({ fetchImpl: fn });
    expect(r.feeds.map((f) => [f.feedId, f.status])).toEqual([
      ['bmkg-inatews', 'live'],
      ['bmkg-gempa', 'live'],
      ['jma-tsunami', 'live'],
      ['jma-volcano', 'live'],
      ['geonet-val', 'live'],
      ['nws-tsunami', 'live'],
      ['gdacs', 'live'],
      ['magma-level-list', 'snapshot'],
      ['thaiwater', 'live'],
      ['dsda-jakarta', 'live'],
      ['pub-flood', 'live'],
    ]);
    expect(statusOf(r.feeds, 'pub-flood').message).toBe('No active PUB flood alerts at 2026-10-13T07:18:54Z');
    expect(r.warnings.filter((w) => w.dataMode === 'historical').every((w) => w.id.startsWith('magma'))).toBe(true);
    expect([...r.warnings].sort(compareWarnings)).toEqual(r.warnings);
    expect(r.gauges.some((g) => g.id === 'thaiwater:C.35')).toBe(true);
  });

  it('falls back per feed to the bundled snapshot, labelled historical', async () => {
    const { fn } = fakeFetch({ [FEEDS.bmkgInatews.url]: { status: 500 } });
    const r = await loadOfficialWarnings({ fetchImpl: fn });
    const s = statusOf(r.feeds, 'bmkg-inatews');
    expect(s.status).toBe('snapshot');
    expect(s.message).toMatch(/^Live feed unavailable \(HTTP 500\); showing the bundled snapshot captured \S+Z\. Check BMKG InaTEWS directly for current messages\.$/);
    const bmkg = r.warnings.filter((w) => w.id.startsWith('bmkg-inatews'));
    expect(bmkg.length).toBeGreaterThan(4);
    expect(bmkg.every((w) => w.dataMode === 'historical' && w.retrievedAt === s.retrievedAt)).toBe(true);
  });

  it('reports "Official feed unavailable: check <issuer> directly" when a feed fails and has no snapshot', async () => {
    const { fn } = fakeFetch({ [FEEDS.bmkgInatews.url]: { status: 500 } });
    const r = await loadOfficialWarnings({ fetchImpl: fn, snapshot: null });
    expect(statusOf(r.feeds, 'bmkg-inatews')).toEqual({
      feedId: 'bmkg-inatews',
      issuer: 'BMKG InaTEWS',
      issuerUrl: 'https://inatews.bmkg.go.id/',
      status: 'unavailable',
      retrievedAt: null,
      message: 'Official feed unavailable: check BMKG InaTEWS directly',
    });
    expect(r.warnings.some((w) => w.id.startsWith('bmkg-inatews'))).toBe(false);
    expect(statusOf(r.feeds, 'bmkg-gempa').status).toBe('live');
  });

  it('never throws, even when the network is down and there is no snapshot', async () => {
    const down = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    const r = await loadOfficialWarnings({ fetchImpl: down, snapshot: null });
    for (const f of r.feeds) {
      if (f.feedId === 'magma-level-list') continue;
      expect(f.status).toBe('unavailable');
      expect(f.message).toBe(`Official feed unavailable: check ${f.issuer} directly`);
    }
    expect(r.warnings.every((w) => w.id.startsWith('magma'))).toBe(true);
    resetWarningsCache();
    const sync = (() => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    await expect(loadOfficialWarnings({ fetchImpl: sync })).resolves.toHaveProperty('feeds');
  });

  it('times out a hanging feed and backs off for 60 seconds', async () => {
    const { fn } = fakeFetch({ [FEEDS.gdacs.url]: 'never' });
    const r = await loadOfficialWarnings({ fetchImpl: fn, timeoutMs: 30 });
    expect(statusOf(r.feeds, 'gdacs').message).toContain('timed out after 30 ms; retrying live after');
    expect(statusOf(r.feeds, 'gdacs').status).toBe('snapshot');
  });

  it('shares one set of requests between concurrent calls, then serves the 5-minute cache', async () => {
    const { fn, calls } = fakeFetch();
    const [a, b] = await Promise.all([loadOfficialWarnings({ fetchImpl: fn }), loadOfficialWarnings({ fetchImpl: fn })]);
    expect(b).toBe(a);
    expect(calls).toHaveLength(13);
    const c = await loadOfficialWarnings({ fetchImpl: fn });
    expect(calls).toHaveLength(13);
    expect(statusOf(c.feeds, 'bmkg-inatews').status).toBe('cached');
    expect(statusOf(c.feeds, 'bmkg-inatews').retrievedAt).toBe(statusOf(a.feeds, 'bmkg-inatews').retrievedAt);
    expect(c.warnings.filter((w) => !w.id.startsWith('magma')).every((w) => w.dataMode === 'live')).toBe(true);
  });

  it('backs off a rate-limited feed for 60 seconds (fake clock), then retries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T08:00:00Z'));
    const first = fakeFetch({ [FEEDS.gdacs.url]: { status: 429 } });
    const r1 = await loadOfficialWarnings({ fetchImpl: first.fn });
    expect(statusOf(r1.feeds, 'gdacs').message).toContain('rate limited; retrying live after 08:01:00 UTC');

    vi.setSystemTime(new Date('2026-10-13T08:00:30Z'));
    const second = fakeFetch();
    const r2 = await loadOfficialWarnings({ fetchImpl: second.fn });
    expect(second.calls.some((u) => u.startsWith(FEEDS.gdacs.url))).toBe(false);
    expect(statusOf(r2.feeds, 'gdacs').status).toBe('snapshot');

    vi.setSystemTime(new Date('2026-10-13T08:01:01Z'));
    const third = fakeFetch();
    const r3 = await loadOfficialWarnings({ fetchImpl: third.fn });
    expect(third.calls.some((u) => u.startsWith(FEEDS.gdacs.url))).toBe(true);
    expect(statusOf(r3.feeds, 'gdacs').status).toBe('live');
  });

  it('PUB shares the data.gov.sg backoff with the NEA layer, both ways', async () => {
    markDataGovSgRateLimited('rate limited');
    const { fn, calls } = fakeFetch();
    const r = await loadOfficialWarnings({ fetchImpl: fn });
    expect(calls.includes(FEEDS.pub.url)).toBe(false);
    expect(statusOf(r.feeds, 'pub-flood').message).toContain('data.gov.sg rate limited; retrying live after');

    resetNeaCache();
    resetWarningsCache();
    expect(dataGovSgBackoffUntil()).toBeNull();
    const limited = fakeFetch({ [FEEDS.pub.url]: { status: 429 } });
    await loadOfficialWarnings({ fetchImpl: limited.fn });
    expect(dataGovSgBackoffUntil()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Brief

describe('brief OFFICIAL WARNINGS section', () => {
  const merapi: Incident = {
    id: 'watch-merapi',
    title: 'Merapi',
    hazard: 'volcano',
    volcanoId: 'gvp-263250',
    locationName: 'Central Java, Indonesia',
    country: 'Indonesia',
    lat: -7.54,
    lon: 110.446,
    dataMode: 'historical',
    scenarioWindow: { start: '2026-10-07T00:00:00Z', end: '2026-10-14T00:00:00Z' },
    replayable: false,
    summary: '',
  };
  const base = { incident: merapi, volcano: null, step: null, review: deriveReview([], merapi.scenarioWindow), issues: [] };
  const snap = loadWarningsSnapshot();

  it('relays nearby warnings with issuer, level and gloss, missing issue time, status, instruction and link', () => {
    const near = warningsNear(snap.warnings, merapi.lat, merapi.lon, 50);
    const text = flat(buildBriefing({ ...base, warnings: near, warningFeeds: snap.feeds }));
    expect(text).toContain('OFFICIAL WARNINGS NEAR THIS INCIDENT (relayed verbatim; follow the issuer)');
    expect(text).toContain('[W1] PVMBG (Badan Geologi) via MAGMA Indonesia (official issuer) - HISTORICAL');
    expect(text).toContain('Level: Level III (Siaga) [Level 3 of 4 (Alert)]');
    expect(text).toContain(`Issued: no issue time published; retrieved ${MAGMA_RETRIEVED_AT}`);
    expect(text).toContain('Follow official instructions from PVMBG (Badan Geologi) via MAGMA Indonesia');
    expect(text).toContain('https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas');
    expect(text).toContain('Feeds checked:');
    expect(text).not.toContain('Absence of a warning here is not an all-clear.');
  });

  it('labels expired, ended and aggregator items, and keeps instruction lines verbatim', () => {
    const jma = parseJmaTsunami({ list: JMA_LIST, detail: JMA_DETAIL, detailUrl: JMA_DETAIL_URL }, { dataMode: 'historical', retrievedAt: '2026-10-13T07:22:18Z' }).warnings[0];
    const bmkg = parseBmkgTsunami(BMKG_XML, LIVE).warnings.find((w) => w.ended) as OfficialWarning;
    const gdacs = parseGdacs(GDACS, LIVE).warnings[0];
    const text = flat(buildBriefing({ ...base, warnings: [jma, bmkg, gdacs], warningFeeds: [] }));
    expect(text).toContain('Status: EXPIRED at 2026-10-11T11:00:00Z');
    expect(text).toContain('Status: ENDED by the issuer');
    expect(text).toContain('GDACS (aggregator impact estimate, NOT an official warning) - LIVE');
    expect(text).toContain(flat(bmkg.instruction?.split('\n')[1] ?? 'missing'));
  });

  it('with no warnings, lists the feeds checked and says absence is not an all-clear', () => {
    const feeds: WarningFeedStatus[] = [
      { feedId: 'bmkg-inatews', issuer: 'BMKG InaTEWS', issuerUrl: 'https://inatews.bmkg.go.id/', status: 'unavailable', retrievedAt: null, message: 'Official feed unavailable: check BMKG InaTEWS directly' },
      { feedId: 'pub-flood', issuer: 'PUB', issuerUrl: 'https://www.pub.gov.sg/', status: 'live', retrievedAt: '2026-10-13T07:30:00Z', message: 'No active PUB flood alerts at 2026-10-13T07:18:54Z' },
    ];
    const text = flat(buildBriefing({ ...base, warnings: [], warningFeeds: feeds }));
    expect(text).toContain('No official warning near this incident was returned by the feeds checked below.');
    expect(text).toContain('BMKG InaTEWS (bmkg-inatews): UNAVAILABLE. Official feed unavailable: check BMKG InaTEWS directly');
    expect(text).toContain('PUB (pub-flood): LIVE, retrieved 2026-10-13T07:30:00Z. No active PUB flood alerts at 2026-10-13T07:18:54Z');
    expect(text).toContain('Absence of a warning here is not an all-clear.');
    expect(text).not.toMatch(/all clear|no warnings/i);
  });

  it('is omitted when no warnings input is given, and is deterministic', () => {
    expect(buildBriefing(base)).not.toContain('OFFICIAL WARNINGS');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    const a = buildBriefing({ ...base, warnings: snap.warnings.slice(0, 5), warningFeeds: snap.feeds });
    vi.setSystemTime(new Date('2001-01-01T00:00:00Z'));
    const b = buildBriefing({ ...base, warnings: [...snap.warnings.slice(0, 5)].reverse(), warningFeeds: snap.feeds });
    expect(b).toBe(a);
    expect(a).not.toContain('2031');
  });
});

// ---------------------------------------------------------------------------
// MAGMA level list (trimmed from api-research/geo/magma_tingkat.sample.html; report links shortened)

const MAGMA_ROW = (label: string, id: string) => `
                                                        <tr>
                                <td>
                                ${label} <a href="https://magma.esdm.go.id/v1/gunung-api/laporan/${id}?signature=x"><i class="fa fa-angle-right mg-r-5"
                                        target="_blank"></i>Lihat laporan</a><br>
                                </td>
                            </tr>`;

function magmaPage(opts: { level3?: string[]; level3Count?: number; level2?: string[] } = {}): string {
  const level3 = opts.level3 ?? [
    'Anak Krakatau - Lampung',
    'Merapi - Daerah Istimewa Yogyakarta dan Jawa Tengah',
    'Semeru - Jawa Timur',
    'Sinabung - Sumatera Utara',
  ];
  const level2 = opts.level2 ?? ['Anak Ranakah - Nusa Tenggara Timur', 'Awu - Sulawesi Utara'];
  return `<div class="card"><p>Level IV (Awas)</p><p>Level III (Siaga)</p></div>
                        <tr>
                            <td rowspan="1">
                                <a href="" class="tx-inverse tx-14 tx-medium d-block">Level IV (Awas)</a>
                                <span class="tx-11 d-block">Hasil pengamatan visual dan instrumental teramati mengalami peningkatan aktivitas yang semakin nyata atau gunung api mengalami erupsi</span>
                            </td>
                            <td class="tx-12" rowspan="1">
                                0
                            </td>
                                                        <td>
                                Tidak ada gunung api Level IV (Awas)
                            </td>
                                                    </tr>
                        <tr>
                            <td rowspan="5">
                                <a href="" class="tx-inverse tx-14 tx-medium d-block">Level III (Siaga)</a>
                                <span class="tx-11 d-block">Hasil pengamatan visual dan instrumental memperlihatkan peningkatan aktivitas yang semakin nyata atau gunung api mengalami erupsi</span>
                            </td>
                            <td class="tx-12" rowspan="5">
                                ${opts.level3Count ?? level3.length}
                            </td>
                                                    </tr>${level3.map((l, i) => MAGMA_ROW(l, `32820${i}`)).join('')}
                        <tr>
                            <td rowspan="24">
                                <a href="" class="tx-inverse tx-14 tx-medium d-block">Level II (Waspada)</a>
                                <span class="tx-11 d-block">Hasil pengamatan visual dan instrumental mulai memperlihatkan peningkatan aktivitas. Pada beberapa gunung api dapat terjadi erupsi</span>
                            </td>
                            <td class="tx-12" rowspan="24">
                                23
                            </td>
                                                    </tr>${level2.map((l, i) => MAGMA_ROW(l, `32819${i}`)).join('')}`;
}

describe('MAGMA level list parser', () => {
  it('reads the level headings with their counts and each volcano name under its level', () => {
    const list = parseMagmaLevelList(magmaPage());
    expect(list.headings).toEqual([
      { level: 'Level IV (Awas)', levelNumber: 4, count: 0 },
      { level: 'Level III (Siaga)', levelNumber: 3, count: 4 },
      { level: 'Level II (Waspada)', levelNumber: 2, count: 23 },
    ]);
    expect(list.volcanoes.map((v) => [v.name, v.region, v.level])).toEqual([
      ['Anak Krakatau', 'Lampung', 'Level III (Siaga)'],
      ['Merapi', 'Daerah Istimewa Yogyakarta dan Jawa Tengah', 'Level III (Siaga)'],
      ['Semeru', 'Jawa Timur', 'Level III (Siaga)'],
      ['Sinabung', 'Sumatera Utara', 'Level III (Siaga)'],
      ['Anak Ranakah', 'Nusa Tenggara Timur', 'Level II (Waspada)'],
      ['Awu', 'Sulawesi Utara', 'Level II (Waspada)'],
    ]);
  });

  it('selects Level III/IV plus every watched volcano at whatever level, and copies no report prose', () => {
    const list = parseMagmaLevelList(
      magmaPage({ level3: ['Semeru - Jawa Timur'], level2: ['Merapi - Daerah Istimewa Yogyakarta dan Jawa Tengah', 'Awu - Sulawesi Utara'] }),
    );
    const picked = selectMagmaVolcanoes(list);
    expect(picked.map((v) => [v.name, v.level])).toEqual([
      ['Semeru', 'Level III (Siaga)'],
      ['Merapi', 'Level II (Waspada)'],
    ]);
    expect(MAGMA_WATCHED).toEqual(['Merapi', 'Semeru', 'Anak Krakatau', 'Sinabung']);
    expect(JSON.stringify(list)).not.toContain('Hasil pengamatan');
    expect(JSON.stringify(list)).not.toContain('signature');
  });

  it('throws (so the capture keeps the previous records) when the structure is not recognised', () => {
    expect(() => parseMagmaLevelList('<html><body>Maintenance</body></html>')).toThrow(/no level headings found/);
    expect(() => parseMagmaLevelList(magmaPage({ level3: [], level2: [] }))).toThrow(/no volcano entries found/);
    expect(() => parseMagmaLevelList(magmaPage({ level3Count: 5 }))).toThrow(
      /Level III \(Siaga\) lists 4 volcanoes but the page says 5/,
    );
    expect(() => parseMagmaLevelList('')).toThrow(/empty/);
  });

  it('turns snapshot records into historical warnings with the fixed I-IV gloss and the MAGMA link', () => {
    const meta: ParseMeta = { dataMode: 'historical', retrievedAt: '2026-10-13T07:51:22Z' };
    const { warnings, note } = parseMagmaSnapshot(
      {
        volcanoes: [
          { name: 'Merapi', region: 'Daerah Istimewa Yogyakarta dan Jawa Tengah', level: 'Level II (Waspada)' },
          { name: 'Lewotobi Laki-laki', region: 'Nusa Tenggara Timur', level: 'Level IV (Awas)', gvpNumber: '264180', lat: -8.542, lon: 122.775 },
          { name: 'Contoh', region: null, level: 'Level V (Baru)' },
        ],
      },
      meta,
    );
    expect(warnings.map((w) => [w.level, w.levelGloss])).toEqual([
      ['Level II (Waspada)', 'Level 2 of 4 (Advisory)'],
      ['Level IV (Awas)', 'Level 4 of 4 (Warning, the highest)'],
      ['Level V (Baru)', null],
    ]);
    expect(warnings[0]).toMatchObject({
      issuer: 'PVMBG (Badan Geologi) via MAGMA Indonesia',
      issuerUrl: 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas',
      issuedAt: null,
      dataMode: 'historical',
      retrievedAt: '2026-10-13T07:51:22Z',
      areaDescription: 'Merapi - Daerah Istimewa Yogyakarta dan Jawa Tengah',
      location: { lat: -7.54, lon: 110.446 },
      headline:
        "Merapi: Level II (Waspada), as recorded from MAGMA Indonesia's public volcano activity level list on 2026-10-13. Check MAGMA for the current level.",
    });
    expect(warnings[1].location).toEqual({ lat: -8.542, lon: 122.775 });
    expect(warnings[2].location).toBeNull();
    expect(note).toBe("Recorded from MAGMA's public level list at 2026-10-13T07:51:22Z; MAGMA's API is token-only. Check MAGMA for the current level.");
    expect(() => parseMagmaSnapshot({ volcanoes: [] }, meta)).toThrow();
  });

  it('the bundled snapshot holds only levels and names for Level III/IV and the watched volcanoes', () => {
    const entry = BUNDLED_WARNINGS_SNAPSHOT.feeds['magma-level-list'];
    expect(entry?.retrievedAt).toBe(MAGMA_RETRIEVED_AT);
    const raw = entry?.raw as { volcanoes?: Array<Record<string, unknown>> } | undefined;
    const volcanoes = raw?.volcanoes ?? [];
    expect(volcanoes.length).toBeGreaterThan(0);
    for (const v of volcanoes) {
      expect(Object.keys(v).sort()).toEqual(['coordinateSource', 'gvpNumber', 'lat', 'level', 'levelNumber', 'lon', 'name', 'region']);
      expect((v.levelNumber as number) >= 3 || (MAGMA_WATCHED as readonly string[]).includes(v.name as string)).toBe(true);
    }
    for (const name of MAGMA_WATCHED) expect(volcanoes.some((v) => v.name === name)).toBe(true);
  });

  it('reports MAGMA as unavailable with the exact message when the snapshot has no MAGMA records', async () => {
    const feeds = { ...BUNDLED_WARNINGS_SNAPSHOT.feeds };
    delete feeds['magma-level-list'];
    const r = await loadOfficialWarnings({
      fetchImpl: fakeFetch().fn,
      snapshot: { capturedAt: BUNDLED_WARNINGS_SNAPSHOT.capturedAt, feeds },
    });
    expect(statusOf(r.feeds, 'magma-level-list')).toMatchObject({
      status: 'unavailable',
      message: 'Official feed unavailable: check PVMBG (Badan Geologi) via MAGMA Indonesia directly',
    });
    expect(r.warnings.some((w) => w.id.startsWith('magma'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JMA: only the newest forecast of each event (QC finding M5)

describe('JMA tsunami: newest forecast per event', () => {
  const LIVE_JMA: ParseMeta = { dataMode: 'live', retrievedAt: '2026-10-10T00:00:00Z' };
  const BUNDLED_JMA_LIST = (BUNDLED_WARNINGS_SNAPSHOT.feeds['jma-tsunami'].raw as { list: Record<string, string>[] }).list;
  /** A product of the newer event that carries no per-area forecast (offshore observations, VTSE52). */
  const OBSERVATION = { ...JMA_LIST[0], rdt: '2026-10-10T03:50:00+09:00', ttl: '沖合の津波観測に関する情報', json: '20261010035000_20261010025608_VTSE52_0.json' };
  /** A later forecast of the newer event (same eid). */
  const UPDATE = { ...JMA_LIST[0], rdt: '2026-10-10T04:10:00+09:00', json: '20261010041000_20261010025608_VTSE41_0.json' };

  it('picks the newest VTSE41/VTSE51 product of each event in the bundled list, newest event first', () => {
    const picked = jmaNewestForecastPerEvent(BUNDLED_JMA_LIST);
    const forecasts = BUNDLED_JMA_LIST.filter((it) => /_VTSE(41|51)_/.test(it.json));
    const eids = [...new Set(forecasts.map((it) => it.eid))];
    const expected = eids
      .map((eid) => forecasts.filter((it) => it.eid === eid).sort((a, b) => b.rdt.localeCompare(a.rdt))[0])
      .sort((a, b) => b.rdt.localeCompare(a.rdt))
      .slice(0, JMA_MAX_EVENTS);
    expect(picked).toEqual(expected);
    expect(new Set(picked.map((it) => it.eid)).size).toBe(picked.length);
  });

  it('skips products without a forecast and keeps one product per event', () => {
    const picked = jmaNewestForecastPerEvent([OBSERVATION, ...JMA_LIST, UPDATE]);
    expect(picked.map((it) => it.json)).toEqual([UPDATE.json, JMA_LIST[1].json]);
  });

  it('caps the number of events', () => {
    const many = Array.from({ length: JMA_MAX_EVENTS + 3 }, (_, i) => ({ ...JMA_LIST[0], eid: `e${i}`, rdt: `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00+09:00`, json: `x_e${i}_VTSE41_0.json` }));
    const picked = jmaNewestForecastPerEvent(many);
    expect(picked).toHaveLength(JMA_MAX_EVENTS);
    expect(picked[0].eid).toBe(`e${JMA_MAX_EVENTS + 2}`);
  });

  it('parses every event: one event never replaces another', () => {
    const raw = { list: JMA_LIST, details: [{ url: JMA_DETAIL_URL, detail: JMA_DETAIL }, { url: JMA_DETAIL_OLD_URL, detail: JMA_DETAIL_OLD }] };
    const { warnings, note } = parseJmaTsunami(raw, LIVE_JMA);
    const n = JMA_DETAIL.Body.Tsunami.Forecast.Item.length + JMA_DETAIL_OLD.Body.Tsunami.Forecast.Item.length;
    expect(warnings).toHaveLength(n);
    expect(new Set(warnings.map((w) => w.id.split(':')[1]))).toEqual(new Set([JMA_LIST[0].eid, JMA_LIST[1].eid]));
    expect(warnings.filter((w) => w.sourceUrl === JMA_DETAIL_OLD_URL)).toHaveLength(JMA_DETAIL_OLD.Body.Tsunami.Forecast.Item.length);
    expect(note).toContain('2 events');
  });

  it('two products of one event: only the newest is shown', () => {
    const newer = { ...JMA_DETAIL, Head: { ...JMA_DETAIL.Head, ReportDateTime: UPDATE.rdt }, Body: { ...JMA_DETAIL.Body, Tsunami: { Forecast: { Item: [JMA_DETAIL.Body.Tsunami.Forecast.Item[1]] } } } };
    const raw = { list: [...JMA_LIST, UPDATE], details: [{ url: JMA_DETAIL_URL, detail: JMA_DETAIL }, { url: 'u2', detail: newer }] };
    const { warnings } = parseJmaTsunami(raw, LIVE_JMA);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ sourceUrl: 'u2', issuedAt: '2026-10-09T19:10:00Z' });
  });

  it('live: a newer observation-only product does not wipe the forecast, and both events load', async () => {
    const { fn, calls } = fakeFetch({ [FEEDS.jmaTsunami.url]: { body: [OBSERVATION, ...JMA_LIST] } });
    const r = await loadOfficialWarnings({ fetchImpl: fn });
    const jma = r.warnings.filter((w) => w.id.startsWith('jma-tsunami:'));
    expect(jma.length).toBe(JMA_DETAIL.Body.Tsunami.Forecast.Item.length + JMA_DETAIL_OLD.Body.Tsunami.Forecast.Item.length);
    expect(calls.some((u) => u.includes('VTSE52'))).toBe(false);
    expect(statusOf(r.feeds, 'jma-tsunami').status).toBe('live');
  });

  it('live: one event detail failing keeps the other and says so', async () => {
    const { fn } = fakeFetch({ [JMA_DETAIL_OLD_URL]: new Error('HTTP 503') });
    const r = await loadOfficialWarnings({ fetchImpl: fn });
    const jma = r.warnings.filter((w) => w.id.startsWith('jma-tsunami:'));
    expect(jma).toHaveLength(JMA_DETAIL.Body.Tsunami.Forecast.Item.length);
    const status = statusOf(r.feeds, 'jma-tsunami');
    expect(status.status).toBe('live');
    expect(status.message).toContain('1 event product could not be fetched: check JMA directly.');
  });

  it('the bundled snapshot (older { list, detail } shape) still parses', () => {
    const snap = loadWarningsSnapshot();
    expect(snap.warnings.some((w) => w.id.startsWith('jma-tsunami:'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ThaiWater gauge labels (QC finding L2), on the bundled snapshot

describe('ThaiWater situation labels', () => {
  const RAW_TW = BUNDLED_WARNINGS_SNAPSHOT.feeds.thaiwater.raw as Record<string, unknown>;
  const META_TW: ParseMeta = { dataMode: 'historical', retrievedAt: BUNDLED_WARNINGS_SNAPSHOT.feeds.thaiwater.retrievedAt as string };
  const withScale = parseThaiWater(RAW_TW, META_TW);
  const { scale: _scale, ...noScaleRaw } = RAW_TW;
  const withoutScale = parseThaiWater(noScaleRaw, META_TW);

  it('the snapshot has gauges at level 5 or above (so the case is real)', () => {
    expect(withScale.warnings.length).toBeGreaterThan(0);
    expect(withScale.note).not.toContain('scale table');
  });

  it('without the scale table, level-5 gauges are still relayed, labelled by their numeric level, and the note says so', () => {
    expect(withoutScale.warnings.map((w) => w.id)).toEqual(withScale.warnings.map((w) => w.id));
    for (const w of withoutScale.warnings) {
      expect(w.level).toMatch(/^ThaiWater situation_level \d$/);
      expect(w.levelGloss).toMatch(/ThaiWater situation level \d of 5/);
    }
    expect(withoutScale.note).toContain(`${withoutScale.warnings.length} of them without ThaiWater's situation text`);
    expect(withoutScale.note).toContain('check ThaiWater directly');
  });

  it("with the scale table the level is ThaiWater's own text, verbatim", () => {
    const rows = (RAW_TW.scale as { data: { scale: { trans: string; situation: string }[] } }).data.scale;
    const texts = new Set(rows.map((r) => r.situation.trim()));
    for (const w of withScale.warnings) expect(texts.has(w.level)).toBe(true);
  });

  it('every gauge carries its numeric level and our fixed gloss beside the verbatim text', () => {
    const rows = ((RAW_TW.waterlevel_data as { data: { situation_level: unknown }[] }).data ?? []).length;
    expect(withScale.gauges.length).toBeGreaterThan(0);
    expect(withScale.gauges.length).toBeLessThanOrEqual(rows);
    for (const g of withScale.gauges) {
      if (g.situationLevel === null || g.situationLevel === undefined) {
        expect(g.situationGloss).toBeNull();
        continue;
      }
      expect(g.situationGloss).toContain(`ThaiWater situation level ${g.situationLevel} of 5`);
      expect(g.situationGloss).not.toBe(g.situation);
    }
    expect(withoutScale.gauges.map((g) => g.situationGloss)).toEqual(withScale.gauges.map((g) => g.situationGloss));
    expect(withoutScale.gauges.every((g) => g.situation === null)).toBe(true);
  });
});
