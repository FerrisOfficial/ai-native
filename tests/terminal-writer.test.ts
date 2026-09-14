import { it, expect } from 'vitest';
import { TerminalWriter } from '../src/terminal-writer.js';

it('suppresses asynchronous history replies and preserves live replies in order', () => {
  const writes: string[] = [];
  const replies: string[] = [];
  let complete: () => void = () => {};
  let resets = 0;
  const writer = new TerminalWriter({
    reset() {
      resets++;
    },
    write(text, done) {
      writes.push(text);
      complete = () => {
        // xterm emits a DA response before the asynchronous write callback.
        if (!writer.replaying) replies.push('DA');
        done();
      };
    },
  });
  writer.write('old history', true);
  writer.write('reattached snapshot', true);
  writer.write('live query');
  expect(writes).toEqual(['old history']);
  complete();
  expect(resets).toBe(2);
  complete();
  expect(replies).toEqual([]);
  complete();
  expect(replies).toEqual(['DA']);
  expect(writes).toEqual(['old history', 'reattached snapshot', 'live query']);
  expect(writer.replaying).toBe(false);
  writer.write('pending history', true);
  writer.write('queued live');
  writer.dispose();
  complete();
  expect(writes).not.toContain('queued live');
});
