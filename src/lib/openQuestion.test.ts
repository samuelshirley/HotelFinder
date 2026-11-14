import { describe, expect, it } from 'vitest';

import { unansweredQuestion } from './openQuestion';

const q = (id: string) => ({ id, kind: 'form_question' });
const row = (id: string, kind: string) => ({ id, kind });

describe('the open question', () => {
  it('stays open after a typed answer that did not work and the line saying so', () => {
    const messages = [row('u1', 'user'), q('q1'), row('u2', 'user'), row('l1', 'line')];
    expect(unansweredQuestion(messages)?.id).toBe('q1');
  });

  it('closes once a form answer follows it', () => {
    expect(unansweredQuestion([q('q1'), row('a1', 'form_answer'), row('l1', 'line')])).toBeNull();
  });

  it('is the newest question when another is asked', () => {
    expect(unansweredQuestion([q('q1'), row('u1', 'user'), q('q2')])?.id).toBe('q2');
  });

  it('is none before any question', () => {
    expect(unansweredQuestion([row('u1', 'user')])).toBeNull();
  });
});
