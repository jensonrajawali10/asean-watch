import { describe, expect, it } from 'vitest';
import { compassWord, headlineSentence, headlineWhen } from './headline';

describe('headlineSentence', () => {
  it('names the worst city, its modelled value and the wind direction', () => {
    expect(headlineSentence({ worst: { name: 'Palangka Raya', pm25: 604.4 }, offsetH: 0, snapshot: false, windTowardDeg: 315, windSpeedMs: 4 })).toBe(
      'Now: haze is worst over Palangka Raya (604 µg/m³, modelled). Low-level winds carry its smoke toward the north-west.',
    );
  });

  it('says when the run is a saved snapshot and when the hour is offset', () => {
    expect(headlineWhen(0, true)).toBe('Saved run');
    expect(headlineWhen(-3, true)).toBe('Saved run −3 h');
    expect(headlineWhen(24, false)).toBe('At +24 h');
    expect(headlineSentence({ worst: { name: 'Jambi', pm25: 120 }, offsetH: 24, snapshot: true })).toBe(
      'Saved run +24 h: haze is worst over Jambi (120 µg/m³, modelled).',
    );
  });

  it('handles calm wind and missing data without inventing a direction', () => {
    expect(headlineSentence({ worst: { name: 'Jambi', pm25: 120 }, offsetH: 0, snapshot: false, windTowardDeg: 90, windSpeedMs: 0.3 })).toBe(
      'Now: haze is worst over Jambi (120 µg/m³, modelled). Low-level winds there are calm.',
    );
    expect(headlineSentence({ worst: null, offsetH: 0, snapshot: false })).toBe('Now: the haze forecast has not loaded yet.');
  });

  it('uses eight compass words', () => {
    expect(compassWord(0)).toBe('north');
    expect(compassWord(44)).toBe('north-east');
    expect(compassWord(180)).toBe('south');
    expect(compassWord(-45)).toBe('north-west');
  });
});
