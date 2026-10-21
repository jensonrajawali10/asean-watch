import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Taskbar from './Taskbar';
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
