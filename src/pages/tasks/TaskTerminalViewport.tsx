import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { getTerminalBuffer, subscribeTerminalBuffer } from "./taskTerminalBufferStore";

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
  const lastResizeRef = useRef("");

  useEffect(() => {
    onTerminalDataRef.current = props.onTerminalData;
  }, [props.onTerminalData]);

  useEffect(() => {
    onTerminalResizeRef.current = props.onTerminalResize;
  }, [props.onTerminalResize]);

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
    const fitAndResize = () => {
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
      if (lastResizeRef.current === nextKey) {
        return;
      }
      lastResizeRef.current = nextKey;
      void onTerminalResizeRef.current?.(cols, rows);
    };
    fitAndResize();
    window.setTimeout(fitAndResize, 0);
    window.setTimeout(fitAndResize, 150);

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          fitAndResize();
        });
    resizeObserver?.observe(host);

    const disposable = terminal.onData((chars) => {
      void onTerminalDataRef.current(chars);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      disposable.dispose();
      resizeObserver?.disconnect();
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
    const syncBuffer = () => {
      const next = getTerminalBuffer(props.sessionId);
      const previous = renderedBufferRef.current;

      if (!next) {
        terminal.reset();
        renderedBufferRef.current = "";
        return;
      }

      if (previous && next.startsWith(previous)) {
        const delta = next.slice(previous.length);
        if (delta) {
          terminal.write(delta);
        }
        renderedBufferRef.current = next;
        return;
      }

      terminal.reset();
      terminal.write(next);
      renderedBufferRef.current = next;
    };

    syncBuffer();
    return subscribeTerminalBuffer(props.sessionId, syncBuffer);
  }, [props.sessionId]);

  useEffect(() => {
    if (!props.selected) {
      return;
    }
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    terminal?.focus();
    try {
      fitAddon?.fit();
      const cols = terminal?.cols ?? 0;
      const rows = terminal?.rows ?? 0;
      if (cols > 0 && rows > 0) {
        const nextKey = `${cols}x${rows}`;
        if (lastResizeRef.current !== nextKey) {
          lastResizeRef.current = nextKey;
          void onTerminalResizeRef.current?.(cols, rows);
        }
      }
    } catch {
      // ignore fit races on focus
    }
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
