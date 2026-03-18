import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { getTerminalBuffer, subscribeTerminalBuffer, type TerminalBufferEvent } from "./taskTerminalBufferStore";

type TaskTerminalViewportProps = {
  sessionId: string;
  selected: boolean;
  onTerminalData: (chars: string) => Promise<void> | void;
  onTerminalResize?: (cols: number, rows: number) => Promise<void> | void;
};

export function TaskTerminalViewport(props: TaskTerminalViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedBufferRef = useRef("");
  const onTerminalDataRef = useRef(props.onTerminalData);
  const onTerminalResizeRef = useRef(props.onTerminalResize);
  const appliedResizeRef = useRef("");
  const writeQueueRef = useRef<string[]>([]);
  const isFlushingRef = useRef(false);

  const resetTerminal = () => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    writeQueueRef.current = [];
    isFlushingRef.current = false;
    terminal.reset();
  };

  const flushQueue = () => {
    const terminal = terminalRef.current;
    if (!terminal || isFlushingRef.current) {
      return;
    }
    const nextChunk = writeQueueRef.current.shift();
    if (!nextChunk) {
      return;
    }
    isFlushingRef.current = true;
    terminal.write(nextChunk, () => {
      isFlushingRef.current = false;
      flushQueue();
    });
  };

  const enqueueWrite = (chunk: string) => {
    if (!chunk) {
      return;
    }
    const segments = chunk.length > 4096
      ? chunk.match(/[\s\S]{1,4096}/g) ?? [chunk]
      : [chunk];
    writeQueueRef.current.push(...segments);
    flushQueue();
  };

  const applyBufferEvent = (event: TerminalBufferEvent) => {
    if (event.type === "append") {
      renderedBufferRef.current = `${renderedBufferRef.current}${event.chunk}`;
      enqueueWrite(event.chunk);
      return;
    }

    if (event.type === "clear" || event.type === "remove") {
      renderedBufferRef.current = "";
      resetTerminal();
      return;
    }

    renderedBufferRef.current = event.value;
    resetTerminal();
    enqueueWrite(event.value);
  };

  useEffect(() => {
    onTerminalDataRef.current = props.onTerminalData;
  }, [props.onTerminalData]);

  useEffect(() => {
    onTerminalResizeRef.current = props.onTerminalResize;
  }, [props.onTerminalResize]);

  useEffect(() => {
    appliedResizeRef.current = "";
  }, [props.sessionId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: 'Menlo, Monaco, "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 6000,
      theme: {
        background: "#00000000",
        foreground: "#ecf2fa",
        cursor: "#d7e2ef",
        selectionBackground: "rgba(127, 160, 212, 0.25)",
        black: "#0b0f15",
        red: "#ef9f9f",
        green: "#83d28e",
        yellow: "#e9d37e",
        blue: "#86b9ff",
        magenta: "#d2a6ff",
        cyan: "#80d7d9",
        white: "#f6f8fb",
        brightBlack: "#627083",
        brightRed: "#ffb0b0",
        brightGreen: "#98f2a3",
        brightYellow: "#f7e49b",
        brightBlue: "#9bc8ff",
        brightMagenta: "#e0baff",
        brightCyan: "#9be8ea",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    let disposed = false;
    const fitAndResize = async () => {
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (!cols || !rows) {
        return;
      }
      const nextKey = `${cols}x${rows}`;
      if (appliedResizeRef.current === nextKey) {
        return;
      }
      try {
        await onTerminalResizeRef.current?.(cols, rows);
        if (!disposed) {
          appliedResizeRef.current = nextKey;
        }
      } catch {
        // Retry on the next scheduled fit; startup races can occur before the PTY exists.
      }
    };
    void fitAndResize();
    const retryTimers = [0, 150, 600, 1200].map((delay) => window.setTimeout(() => {
      void fitAndResize();
    }, delay));

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          void fitAndResize();
        });
    resizeObserver?.observe(host);

    const disposable = terminal.onData((chars) => {
      void onTerminalDataRef.current(chars);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      disposed = true;
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      disposable.dispose();
      resizeObserver?.disconnect();
      writeQueueRef.current = [];
      isFlushingRef.current = false;
      renderedBufferRef.current = "";
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    const next = getTerminalBuffer(props.sessionId);
    renderedBufferRef.current = next;
    resetTerminal();
    enqueueWrite(next);

    return subscribeTerminalBuffer(props.sessionId, (event) => {
      applyBufferEvent(event);
    });
  }, [props.sessionId]);

  useEffect(() => {
    if (!props.selected) {
      return;
    }
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    terminal?.focus();
    window.setTimeout(() => {
      try {
        fitAddon?.fit();
        const cols = terminal?.cols ?? 0;
        const rows = terminal?.rows ?? 0;
        if (cols > 0 && rows > 0) {
          void Promise.resolve(onTerminalResizeRef.current?.(cols, rows)).then(() => {
            appliedResizeRef.current = `${cols}x${rows}`;
          });
        }
      } catch {
        // ignore fit races on focus
      }
    }, 0);
  }, [props.selected]);

  return (
    <div className="tasks-terminal-viewport" data-selected={props.selected ? "true" : "false"}>
      <div
        className="tasks-terminal-host"
        onMouseDown={() => {
          terminalRef.current?.focus();
        }}
        ref={hostRef}
      />
    </div>
  );
}
