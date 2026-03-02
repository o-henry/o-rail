use rail_lib::dashboard_crawler::{run_dashboard_crawl, DashboardCrawlRequest};
use serde_json::to_string_pretty;

fn parse_list_arg(raw: Option<String>) -> Option<Vec<String>> {
    let value = raw?;
    let items = value
        .split(',')
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if items.is_empty() {
        None
    } else {
        Some(items)
    }
}

fn parse_cli_args() -> DashboardCrawlRequest {
    let mut cwd = std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());
    let mut topics_raw: Option<String> = None;
    let mut max_sources_per_topic: Option<usize> = None;
    let mut request_timeout_ms: Option<u64> = None;

    let mut args = std::env::args().skip(1).peekable();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--cwd" => {
                if let Some(value) = args.next() {
                    cwd = value;
                }
            }
            "--topics" => {
                topics_raw = args.next();
            }
            "--max-sources" => {
                max_sources_per_topic = args.next().and_then(|value| value.parse::<usize>().ok());
            }
            "--timeout-ms" => {
                request_timeout_ms = args.next().and_then(|value| value.parse::<u64>().ok());
            }
            _ => {}
        }
    }

    DashboardCrawlRequest {
        cwd,
        topics: parse_list_arg(topics_raw),
        max_sources_per_topic,
        request_timeout_ms,
        allowlist_by_topic: None,
    }
}

fn main() {
    let request = parse_cli_args();
    let result = tauri::async_runtime::block_on(run_dashboard_crawl(request));
    match result {
        Ok(summary) => match to_string_pretty(&summary) {
            Ok(text) => println!("{text}"),
            Err(err) => {
                eprintln!("failed to render crawl summary: {err}");
                std::process::exit(1);
            }
        },
        Err(err) => {
            eprintln!("dashboard crawler failed: {err}");
            std::process::exit(1);
        }
    }
}
