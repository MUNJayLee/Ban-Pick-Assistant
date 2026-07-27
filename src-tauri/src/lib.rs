#[cfg_attr(mobile, tauri::mobile_entry_point)]
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

/// 查找可用的 node 可执行文件。
/// 优先使用打包资源中的 node.exe，否则回退到系统 PATH 中的 node/npm。
fn find_node_exe(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1) 打包资源中的 node.exe
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("node").join("node.exe");
        if bundled.exists() {
            return Ok(bundled);
        }
    }

    // 2) 开发/源码回退：查找本地 resources/node/node.exe
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            for ancestor in exe_dir.ancestors() {
                let candidate = ancestor.join("src-tauri").join("resources").join("node").join("node.exe");
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }
    }

    // 3) 回退到系统 PATH 中的 node（需要 ShellExt 的 sidecar/command 回退）
    //    这里返回一个标记，让调用方使用 shell.command("node") 回退
    Err("未找到打包的 node.exe，且未启用系统 PATH 回退。".into())
}

/// 查找可用的 scraper 目录。
/// 优先使用源码目录（开发/源码运行时可编辑），否则回退到打包资源目录。
fn find_scraper_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1) 尝试从可执行文件向上查找源码项目根目录
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            for ancestor in exe_dir.ancestors() {
                let candidate = ancestor.join("scripts").join("scraper");
                if candidate.join("package.json").exists() {
                    return Ok(candidate);
                }
            }
        }
    }

    // 2) 回退到打包资源目录中的 scraper
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("scraper");
        if candidate.join("package.json").exists() {
            return Ok(candidate);
        }
    }

    // 3) 再回退到当前工作目录
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("scripts").join("scraper");
        if candidate.join("package.json").exists() {
            return Ok(candidate);
        }
    }

    Err("未找到 scraper 目录。请确保源码项目或打包资源完整。".into())
}

/// 将 src 目录下的 scraper 复制到 dst（可写位置）。
fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    let src = src.as_ref();
    let dst = dst.as_ref();
    if !dst.exists() {
        std::fs::create_dir_all(dst)?;
    }
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// 确保应用数据目录中有一份 heroes.json 基础数据。
/// 首次启动时从打包资源复制；后续 refresh 会覆盖它。
fn ensure_app_data_heroes(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录：{}", e))?;
    let data_dir = app_data_dir.join("data");
    let target = data_dir.join("heroes.json");

    if !target.exists() {
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("创建数据目录失败：{}", e))?;

        // 优先从打包资源复制
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled = resource_dir.join("data").join("heroes.json");
            if bundled.exists() {
                std::fs::copy(&bundled, &target)
                    .map_err(|e| format!("复制 bundled heroes.json 失败：{}", e))?;
                return Ok(target);
            }
        }

        // 开发/源码回退：从项目 src/data 复制
        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(exe_dir) = current_exe.parent() {
                for ancestor in exe_dir.ancestors() {
                    let src = ancestor.join("src").join("data").join("heroes.json");
                    if src.exists() {
                        std::fs::copy(&src, &target)
                            .map_err(|e| format!("复制 src/data/heroes.json 失败：{}", e))?;
                        return Ok(target);
                    }
                }
            }
        }

        return Err("未找到 heroes.json 基础数据，无法初始化。".into());
    }

    Ok(target)
}

/// 把 scraper 准备到应用数据目录的可写位置，并修改配置输出路径。
async fn prepare_scraper(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录：{}", e))?;
    let working_scraper = app_data_dir.join("scraper");
    let data_dir = app_data_dir.join("data");
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("创建数据目录失败：{}", e))?;

    // 确保有一份基础 heroes.json 供 scraper 读取/更新
    ensure_app_data_heroes(app)?;

    // 查找原始 scraper
    let source_scraper = find_scraper_dir(app)?;

    // 复制到可写目录（覆盖以确保最新）
    copy_dir_all(&source_scraper, &working_scraper)
        .map_err(|e| format!("复制 scraper 到可写目录失败：{}", e))?;

    // 修改 config.json，让输出指向应用数据目录
    let config_path = working_scraper.join("config.json");
    if config_path.exists() {
        let raw = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("读取 scraper 配置失败：{}", e))?;
        let mut config: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("解析 scraper 配置失败：{}", e))?;
        // 输出到应用数据目录的 data/heroes.json
        let output_path = data_dir.join("heroes.json");
        config["output"] = serde_json::Value::String(
            output_path.to_string_lossy().to_string()
        );
        std::fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap())
            .map_err(|e| format!("写入 scraper 配置失败：{}", e))?;
    }

    Ok(working_scraper)
}

#[tauri::command]
async fn fetch_data(app: tauri::AppHandle) -> Result<String, String> {
    let working_scraper = prepare_scraper(&app).await?;
    let shell = app.shell();

    // 尝试使用打包的 node.exe 直接运行 fetchData.mjs，
    // 这样不需要用户系统安装 Node.js/npm。
    let output = match find_node_exe(&app) {
        Ok(node_exe) => {
            // 使用自带 node.exe（生产环境 / 独立分发）
            shell
                .command(&node_exe)
                .args([working_scraper.join("src").join("fetchData.mjs").to_string_lossy().as_ref()])
                .current_dir(&working_scraper)
                .output()
                .await
                .map_err(|e| format!("执行抓取失败（自带 node）：{}", e))?
        }
        Err(_) => {
            // 回退：使用系统 npm（开发环境）
            let cmd = if cfg!(target_os = "windows") {
                shell.command("cmd").args(["/c", "npm", "run", "fetch"])
            } else {
                shell.command("npm").args(["run", "fetch"])
            };
            cmd.current_dir(&working_scraper)
                .output()
                .await
                .map_err(|e| format!("执行抓取失败（系统 npm）：{}", e))?
        }
    };

    if !output.status.success() {
        return Err(format!(
            "抓取脚本退出码 {}：{}\nstdout：{}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn get_heroes_data(app: tauri::AppHandle) -> Result<String, String> {
    // 优先读取应用数据目录中的最新数据
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录：{}", e))?;
    let updated = app_data_dir.join("data").join("heroes.json");
    if updated.exists() {
        return std::fs::read_to_string(&updated)
            .map_err(|e| format!("读取已更新数据失败：{}", e));
    }

    // 回退到打包资源中的 heroes.json
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("data").join("heroes.json");
        if bundled.exists() {
            return std::fs::read_to_string(&bundled)
                .map_err(|e| format!("读取 bundled 数据失败：{}", e));
        }
    }

    Err("未找到 heroes.json，请先在数据看板执行刷新。".into())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 启动时就把 bundled heroes.json 复制到可写的应用数据目录
            if let Err(e) = ensure_app_data_heroes(app.handle()) {
                eprintln!("[tauri:setup] 初始化 heroes.json 失败：{}", e);
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![fetch_data, get_heroes_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
