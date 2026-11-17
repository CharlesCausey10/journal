fn main() {
    println!("cargo:rerun-if-changed=../assets/icon.ico");
    println!("cargo:rerun-if-changed=../assets/icon.png");
    println!("cargo:rerun-if-changed=../assets/icon.icns");
    tauri_build::build()
}
