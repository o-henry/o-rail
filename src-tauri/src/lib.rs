pub mod dashboard_crawler;
mod engine;
mod knowledge;
mod quality;
mod storage;
mod system;
mod threads;
mod unity_automation;
mod unity_automation_batch;
mod via_bridge;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(engine::EngineManager::default())
        .manage(system::WorkspaceTerminalManager::default())
        .invoke_handler(tauri::generate_handler![
            engine::engine_start,
            engine::engine_stop,
            engine::login_chatgpt,
            engine::logout_codex,
            engine::auth_probe,
            engine::agent_rules_read,
            engine::usage_check,
            engine::thread_start,
            engine::turn_start,
            engine::turn_start_blocking,
            engine::turn_interrupt,
            engine::approval_respond,
            engine::provider_window_open,
            engine::provider_window_close,
            engine::provider_child_view_open,
            engine::provider_child_view_close,
            engine::provider_child_view_hide,
            engine::web_worker_start,
            engine::web_worker_stop,
            engine::web_provider_health,
            engine::web_provider_run,
            engine::web_provider_open_session,
            engine::web_provider_reset_session,
            engine::web_provider_cancel,
            engine::web_bridge_status,
            engine::web_bridge_rotate_token,
            engine::ollama_generate,
            dashboard_crawler::dashboard_crawl_run,
            dashboard_crawler::dashboard_snapshot_save,
            dashboard_crawler::dashboard_snapshot_list,
            dashboard_crawler::dashboard_snapshot_delete,
            dashboard_crawler::dashboard_raw_list,
            dashboard_crawler::dashboard_agentic_run_list,
            dashboard_crawler::dashboard_scrapling_bridge_health,
            dashboard_crawler::dashboard_scrapling_bridge_start,
            dashboard_crawler::dashboard_scrapling_bridge_install,
            dashboard_crawler::dashboard_scrapling_bridge_stop,
            dashboard_crawler::dashboard_scrapling_fetch_url,
            via_bridge::via_health,
            via_bridge::via_run_flow,
            via_bridge::via_get_run,
            via_bridge::via_list_artifacts,
            knowledge::knowledge_probe,
            knowledge::knowledge_retrieve,
            quality::quality_run_checks,
            storage::graph_list,
            storage::graph_save,
            storage::graph_load,
            storage::graph_delete,
            storage::graph_rename,
            storage::run_save,
            storage::run_list,
            storage::run_load,
            storage::run_delete,
            storage::run_directory,
            storage::storage_cleanup_workspace,
            storage::storage_usage_summary,
            storage::task_list,
            storage::task_load,
            storage::task_create,
            storage::task_update_artifact,
            storage::task_send_prompt,
            storage::task_record_role_result,
            storage::task_mark_status,
            storage::task_archive,
            threads::thread_list,
            threads::thread_delete,
            threads::thread_add_agent,
            threads::thread_update_agent,
            threads::thread_remove_agent,
            threads::thread_create,
            threads::thread_load,
            threads::thread_append_message,
            threads::thread_spawn_agents,
            threads::thread_list_agents,
            threads::thread_open_agent_detail,
            threads::thread_create_approval,
            threads::thread_resolve_approval,
            threads::thread_record_role_result,
            threads::thread_file_diff,
            storage::workspace_write_markdown,
            storage::workspace_write_text,
            storage::workspace_read_text,
            storage::workspace_delete_file,
            storage::dialog_pick_directory,
            storage::dialog_pick_knowledge_files,
            system::task_terminal_exec,
            system::workspace_terminal_start,
            system::workspace_terminal_input,
            system::workspace_terminal_stop,
            unity_automation::unity_guard_inspect,
            unity_automation::unity_guard_prepare,
            unity_automation::unity_collect_diagnostics,
            unity_automation_batch::unity_batch_command_preview,
            unity_automation_batch::unity_batch_run,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let _ = storage::cleanup_app_runtime_noise(app.handle());

    app.run(|app_handle, event| match event {
        tauri::RunEvent::WindowEvent { label, event, .. } => {
            if label == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    app_handle.exit(0);
                }
            }
        }
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            let state = app_handle.state::<engine::EngineManager>();
            let workspace_terminal_state = app_handle.state::<system::WorkspaceTerminalManager>();
            tauri::async_runtime::block_on(async {
                let _ = engine::shutdown_all_runtimes(state.inner()).await;
                system::shutdown_workspace_terminal_sessions(workspace_terminal_state.inner()).await;
            });
            dashboard_crawler::shutdown_scrapling_bridge_runtime();
            via_bridge::shutdown_via_runtime();
        }
        _ => {}
    });
}
