import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Taskbar from './Taskbar';
import { RAIL_HINT_TEXT, RAIL_HINT_TITLE, railHintShown } from './railHint';
import { SECTIONS } from './workspace';

describe('Taskbar hints', () => {
  it('describes every rail icon in one plain line, linked to its button', () => {
    const html = renderToStaticMarkup(createElement(Taskbar, { active: null, onOpen: () => {}, onMap: () => {} }));
    for (const s of SECTIONS) {
      expect(html).toContain(s.hint);
      expect(html).toContain(`aria-describedby="taskbar-${s.id}-hint"`);
    }
    expect(html).toContain('Fires seen by satellites');
  });
});

describe('Taskbar first-visit callout', () => {
  it('says what the rail buttons open on a first visit, with the map in front', () => {
    const html = renderToStaticMarkup(createElement(Taskbar, { active: null, onOpen: () => {}, onMap: () => {} }));
    expect(html).toContain('class="rail-callout"');
    expect(html).toContain(RAIL_HINT_TITLE);
    expect(html).toContain(RAIL_HINT_TEXT);
    expect(html).toContain('Got it');
  });

  it('is gone once dismissed, and while a section is open', () => {
    expect(railHintShown(false, null)).toBe(true);
    expect(railHintShown(true, null)).toBe(false);
    expect(railHintShown(false, 'warnings')).toBe(false);
    const html = renderToStaticMarkup(createElement(Taskbar, { active: 'haze', onOpen: () => {}, onMap: () => {} }));
    expect(html).not.toContain('rail-callout');
  });
});

describe('Taskbar labels', () => {
  it('names the water section by what a newcomer looks for: tsunami (and floods in its title)', () => {
    const water = SECTIONS.find((s) => s.id === 'water')!;
    expect(water.label).toBe('Tsunami');
    expect(water.title).toBe('Tsunami & floods');
    const html = renderToStaticMarkup(createElement(Taskbar, { active: null, onOpen: () => {}, onMap: () => {} }));
    expect(html).toContain('<span class="taskbar__label">Tsunami</span>');
    expect(html).not.toContain('<span class="taskbar__label">Water</span>');
  });
});
