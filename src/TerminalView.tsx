import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalRecord } from '../shared/types';
import { TerminalWriter } from './terminal-writer';

export default function TerminalView({
  record,
  send,
  subscribe,
}: {
  record: TerminalRecord;
  send: (data: unknown) => void;
  subscribe: (callback: (data: any) => void) => () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      scrollback: 10000,
      theme: {
        background: '#14171d',
        foreground: '#e0e4ed',
        cursor: '#b7a5fc',
        selectionBackground: '#574c78',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(el.current!);
    const writer = new TerminalWriter(terminal);
    writer.write(record.output, true);
    fit.fit();
    const input = terminal.onData((text) => {
      if (!writer.replaying) send({ type: 'input', terminalId: record.id, text });
    });
    const resize = () => {
      fit.fit();
      send({ type: 'resize', terminalId: record.id, cols: terminal.cols, rows: terminal.rows });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el.current!);
    const unsubscribe = subscribe((data) => {
      if (data.kind === 'connection_open') {
        send({ type: 'attach', terminalId: record.id });
        resize();
        return;
      }
      if (data.terminalId !== record.id) return;
      if (data.kind === 'terminal_snapshot') {
        writer.write(data.text, true);
      } else if (data.kind === 'terminal_data') writer.write(data.text);
    });
    send({ type: 'attach', terminalId: record.id });
    resize();
    return () => {
      unsubscribe();
      observer.disconnect();
      input.dispose();
      writer.dispose();
      terminal.dispose();
    };
  }, [record.id]);
  return <div className="terminal-screen" ref={el} aria-label={`${record.name} terminal`} />;
}
