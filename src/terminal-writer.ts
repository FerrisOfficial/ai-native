interface OutputTerminal {
  write(text: string, done: () => void): void;
  reset(): void;
}

// xterm parses writes asynchronously and emits protocol replies through onData.
// Serialize history and live output so only replies to live queries reach PTY.
export class TerminalWriter {
  private queue: { text: string; replay: boolean }[] = [];
  private writing = false;
  private disposed = false;
  replaying = false;
  constructor(private terminal: OutputTerminal) {}
  write(text: string, replay = false) {
    if (this.disposed) return;
    this.queue.push({ text, replay });
    this.next();
  }
  private next() {
    if (this.disposed || this.writing) return;
    const item = this.queue.shift();
    if (!item) return;
    this.writing = true;
    this.replaying = item.replay;
    if (item.replay) this.terminal.reset();
    this.terminal.write(item.text, () => {
      this.replaying = false;
      this.writing = false;
      this.next();
    });
  }
  dispose() {
    this.disposed = true;
    this.queue = [];
  }
}
