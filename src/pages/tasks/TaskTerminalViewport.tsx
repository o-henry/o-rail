import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TaskTerminalPane } from "./useTaskTerminalGrid";

type TaskTerminalViewportProps = {
  pane: TaskTerminalPane;
  selected: boolean;
  onTerminalData: (chars: string) => Promise<void> | void;
};

export function TaskTerminalViewport(props: TaskTerminalViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedBufferRef = useRef("");

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
      fontFamily: '"BasicallyAMono", "Galmuri11", monospace',
      fontSize: 12,
      lineHeight: 1.28,
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
    fitAddon.fit();

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          try {
            fitAddon.fit();
          } catch {
            // ignore fit races during layout changes
          }
        });
    resizeObserver?.observe(host);

    const disposable = terminal.onData((chars) => {
      void props.onTerminalData(chars);
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
  }, [props.onTerminalData]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    const next = props.pane.buffer || "";
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
  }, [props.pane.buffer]);

  useEffect(() => {
    if (!props.selected) {
      return;
    }
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    terminal?.focus();
    try {
      fitAddon?.fit();
    } catch {
      // ignore fit races on focus
    }
  }, [props.selected]);

  return (
    <div className="tasks-terminal-viewport" data-selected={props.selected ? "true" : "false"}>
      <div className="tasks-terminal-host" ref={hostRef} />
    </div>
  );
}
