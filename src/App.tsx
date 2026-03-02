import { Component, type ErrorInfo, type ReactNode } from "react";
import MainApp from "./app/MainApp";
import { ThemeProvider } from "./app/theme/ThemeProvider";
import { I18nProvider, t } from "./i18n";

type AppErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      message: "",
    };
  }

  static getDerivedStateFromError(_error: unknown): AppErrorBoundaryState {
    return {
      hasError: true,
      message: "예기치 않은 오류가 발생했습니다. 앱을 다시 시작해 주세요.",
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("[app-error-boundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            alignContent: "start",
            gap: "10px",
            padding: "18px",
            background: "#f6f6f6",
            color: "#182030",
            fontFamily: "DialogNanumBody1984, Noto Sans KR, sans-serif",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "16px" }}>{t("app.error.title")}</h2>
          <p style={{ margin: 0, fontSize: "13px", color: "#475569" }}>
            {t("app.error.copy")}
          </p>
          <pre
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: "8px",
              background: "#ffffff",
              border: "1px solid #dbe2ea",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: "12px",
              lineHeight: 1.45,
            }}
          >
            {this.state.message || t("app.error.noMessage")}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              width: "fit-content",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              cursor: "pointer",
            }}
            type="button"
          >
            {t("app.error.reload")}
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <AppErrorBoundary>
          <MainApp />
        </AppErrorBoundary>
      </ThemeProvider>
    </I18nProvider>
  );
}
