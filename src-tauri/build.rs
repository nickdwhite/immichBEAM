fn main() {
    emit_git_metadata();
    tauri_build::build()
}

/// Capture the git branch, short commit, and a dirty flag at compile time (as
/// `GIT_BRANCH` / `GIT_COMMIT` / `GIT_DIRTY` env vars) so dev builds can show
/// them via `version_display` in lib.rs. Everything is optional — a missing or
/// non-git checkout just yields empty values and the build never fails.
fn emit_git_metadata() {
    if let Some(s) = git(&["rev-parse", "--abbrev-ref", "HEAD"]) {
        println!("cargo:rustc-env=GIT_BRANCH={s}");
    }
    if let Some(s) = git(&["rev-parse", "--short", "HEAD"]) {
        println!("cargo:rustc-env=GIT_COMMIT={s}");
    }
    let dirty = git(&["status", "--porcelain"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    println!(
        "cargo:rustc-env=GIT_DIRTY={}",
        if dirty { "*" } else { "" }
    );

    // Re-run when the checked-out commit changes (HEAD + the reflog).
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/logs/HEAD");
}

fn git(args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
