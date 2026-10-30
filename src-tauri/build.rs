fn main() {
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH")
        .expect("Cargo must provide CARGO_CFG_TARGET_ARCH for the target being built");
    if target_arch != "x86_64" {
        panic!("Zorin DevStart supports x86_64/amd64 only; refusing to build for {target_arch}.");
    }
    tauri_build::build()
}
