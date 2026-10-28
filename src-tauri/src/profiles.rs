use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageDefinition {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileDefinition {
    pub id: String,
    pub title: String,
    pub category: String,
    pub summary: String,
    pub accent: String,
    pub packages: Vec<PackageDefinition>,
    pub extension: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackageItem {
    pub name: String,
    pub reason: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileView {
    pub id: String,
    pub title: String,
    pub category: String,
    pub summary: String,
    pub accent: String,
    pub packages: Vec<PackageItem>,
    pub extension: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtensionManifest {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub packages: Vec<ExtensionPackage>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtensionPackage {
    pub name: String,
    pub reason: String,
}

pub fn builtin_profiles() -> Vec<ProfileDefinition> {
    vec![
        profile("python", "Python", "Language", "A clear starting point for Python projects, virtual environments, and command-line tools.", "#8c7cf5", &[
            ("python3", "The Python interpreter included in Ubuntu's supported archive."),
            ("python3-venv", "Creates isolated environments for each project."),
            ("python3-pip", "Installs Python packages inside a virtual environment."),
            ("pipx", "Installs standalone Python command-line applications separately."),
            ("build-essential", "Compiler tools needed by packages with native extensions."),
            ("git", "Tracks changes and works with hosted repositories."),
        ]),
        profile("web", "Web development", "Frontend", "Node.js, npm, Git, and curl for building and testing modern web applications.", "#31a8b7", &[
            ("nodejs", "Runs JavaScript tools and server-side applications."),
            ("npm", "Installs and manages JavaScript project dependencies."),
            ("git", "Tracks changes and works with hosted repositories."),
            ("curl", "A command-line tool for transferring data and testing endpoints."),
        ]),
        profile("cpp", "C / C++", "Systems", "Compilers, a debugger, and modern build tools for native Linux development.", "#4389f4", &[
            ("build-essential", "Provides the GNU compiler toolchain and make."),
            ("clang", "An alternative C/C++ compiler and development toolchain."),
            ("cmake", "Generates portable native build systems."),
            ("gdb", "Debugs native programs interactively."),
            ("ninja-build", "A fast build system used by many CMake projects."),
            ("lldb", "The LLVM debugger for inspecting native programs."),
        ]),
        profile("java", "Java", "Language", "A distro-supported JDK and Maven; use a repository's Gradle Wrapper for its supported version.", "#f08a58", &[
            ("default-jdk", "The Java Development Kit selected by the Ubuntu release."),
            ("maven", "Builds Java projects and manages dependencies."),
            ("git", "Tracks changes and works with hosted repositories."),
        ]),
        profile("rust", "Rust", "Language", "The distro-packaged Rust compiler, Cargo, rustfmt, Clippy, and Git; configure a language server separately.", "#d17a50", &[
            ("rustc", "Compiles Rust source code."),
            ("cargo", "Builds Rust projects and manages crates."),
            ("rustfmt", "Formats Rust source consistently."),
            ("rust-clippy", "Finds common mistakes and suggests idiomatic Rust."),
            ("git", "Tracks changes and works with hosted repositories."),
        ]),
        profile("android", "Android", "Mobile", "Java, ADB, Fastboot, and archive tools, with vendor SDK setup kept explicit.", "#62a876", &[
            ("default-jdk", "Provides a Java toolchain for Android development."),
            ("adb", "Communicates with Android devices and emulators."),
            ("fastboot", "Supports device bootloader operations when needed."),
            ("unzip", "Extracts SDK and development archives."),
            ("git", "Tracks changes and works with hosted repositories."),
        ]),
    ]
}

fn profile(
    id: &str,
    title: &str,
    category: &str,
    summary: &str,
    accent: &str,
    packages: &[(&str, &str)],
) -> ProfileDefinition {
    ProfileDefinition {
        id: id.into(),
        title: title.into(),
        category: category.into(),
        summary: summary.into(),
        accent: accent.into(),
        extension: false,
        packages: packages
            .iter()
            .map(|(name, reason)| PackageDefinition {
                name: (*name).into(),
                reason: (*reason).into(),
            })
            .collect(),
    }
}

pub fn load_profiles() -> Vec<ProfileDefinition> {
    let mut profiles = builtin_profiles();
    let Some(folder) = extension_dir() else {
        return profiles;
    };
    let Ok(entries) = fs::read_dir(folder) else {
        return profiles;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<ExtensionManifest>(&text) else {
            continue;
        };
        let Ok(profile) = manifest_to_profile(manifest) else {
            continue;
        };
        if profiles.iter().any(|p| p.id == profile.id) {
            continue;
        }
        profiles.push(profile);
    }
    profiles.sort_by(|a, b| {
        a.extension
            .cmp(&b.extension)
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    profiles
}

pub fn manifest_to_profile(manifest: ExtensionManifest) -> Result<ProfileDefinition, String> {
    if manifest.schema_version != 1 {
        return Err("Unsupported extension schema_version. Use version 1.".into());
    }
    validate_profile_id(&manifest.id)?;
    if builtin_profiles().iter().any(|p| p.id == manifest.id) {
        return Err("An extension cannot replace a built-in profile.".into());
    }
    validate_text(&manifest.title, "title", 2, 60)?;
    validate_text(&manifest.description, "description", 8, 220)?;
    validate_text(&manifest.category, "category", 2, 32)?;
    if manifest
        .category
        .chars()
        .any(|c| !(c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '&' || c == '/'))
    {
        return Err(
            "Category may contain only letters, numbers, spaces, &, /, and hyphens.".into(),
        );
    }
    if manifest.packages.is_empty() || manifest.packages.len() > 24 {
        return Err("An extension must contain between 1 and 24 packages.".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut packages = Vec::with_capacity(manifest.packages.len());
    for package in manifest.packages {
        validate_package_name(&package.name, true)?;
        if !seen.insert(package.name.clone()) {
            return Err(format!("Duplicate package: {}", package.name));
        }
        validate_text(&package.reason, "package reason", 6, 160)?;
        packages.push(PackageDefinition {
            name: package.name,
            reason: package.reason,
        });
    }
    Ok(ProfileDefinition {
        accent: "#8b72d4".into(),
        id: manifest.id,
        title: manifest.title,
        category: manifest.category,
        summary: manifest.description,
        packages,
        extension: true,
    })
}

pub fn validate_profile_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 40
        || !id.as_bytes()[0].is_ascii_lowercase()
        || !id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || id.ends_with('-')
        || id.contains("--")
    {
        return Err("Profile id must be a unique lowercase slug of up to 40 characters.".into());
    }
    Ok(())
}

pub fn validate_package_name(name: &str, extension: bool) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 64
        || !name.as_bytes()[0].is_ascii_lowercase() && !name.as_bytes()[0].is_ascii_digit()
        || !name.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'+' || b == b'.' || b == b'-'
        })
    {
        return Err(format!("Invalid APT package identifier: {name}"));
    }
    if extension && is_protected_package(name) {
        return Err(format!(
            "The package '{name}' is not allowed in a local extension profile."
        ));
    }
    Ok(())
}

fn is_protected_package(name: &str) -> bool {
    [
        "apt",
        "apt-",
        "dpkg",
        "systemd",
        "linux-",
        "grub",
        "ubuntu-desktop",
        "zorin-os-",
        "kernel",
        "libc6",
        "libgtk",
        "gnome-shell",
        "gdm3",
        "snapd",
        "polkit",
        "sudo",
        "bash",
        "coreutils",
    ]
    .iter()
    .any(|prefix| name == *prefix || name.starts_with(prefix))
}

fn validate_text(value: &str, field: &str, min: usize, max: usize) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.len() < min || trimmed.len() > max || trimmed.chars().any(|c| c.is_control()) {
        return Err(format!(
            "{field} must be {min}–{max} characters and contain no control characters."
        ));
    }
    Ok(())
}

pub fn extension_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("zorin-devstart").join("profiles"))
}

pub fn profile_views(
    profiles: Vec<ProfileDefinition>,
    installed: &std::collections::HashSet<String>,
) -> Vec<ProfileView> {
    profiles
        .into_iter()
        .map(|p| ProfileView {
            id: p.id,
            title: p.title,
            category: p.category,
            summary: p.summary,
            accent: p.accent,
            extension: p.extension,
            packages: p
                .packages
                .into_iter()
                .map(|pkg| PackageItem {
                    installed: installed.contains(&pkg.name),
                    name: pkg.name,
                    reason: pkg.reason,
                })
                .collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_have_unique_ids_and_valid_packages() {
        let profiles = builtin_profiles();
        assert_eq!(profiles.len(), 6);
        let mut ids = std::collections::HashSet::new();
        for profile in profiles {
            assert!(
                ids.insert(profile.id.clone()),
                "duplicate profile {}",
                profile.id
            );
            for package in profile.packages {
                validate_package_name(&package.name, false).unwrap();
            }
        }
    }

    #[test]
    fn accepts_a_valid_data_only_extension() {
        let manifest: ExtensionManifest = serde_json::from_str(r#"{"schema_version":1,"id":"docs-tools","title":"Documentation tools","description":"Helpful tools for authoring project docs.","category":"Writing","packages":[{"name":"pandoc","reason":"Converts Markdown and document formats."}]}"#).unwrap();
        assert!(manifest_to_profile(manifest).unwrap().extension);
    }

    #[test]
    fn rejects_arbitrary_commands_unknown_fields_and_protected_packages() {
        let script: Result<ExtensionManifest, _> = serde_json::from_str(
            r#"{"schema_version":1,"id":"bad-ext","title":"Bad tools","description":"A malicious extension.","category":"DevOps","command":"rm -rf /","packages":[{"name":"git","reason":"Tracks files."}]}"#,
        );
        assert!(script.is_err());
        let protected = ExtensionManifest {
            schema_version: 1,
            id: "os-tools".into(),
            title: "Operating tools".into(),
            description: "A package profile for system tools.".into(),
            category: "Systems".into(),
            packages: vec![ExtensionPackage {
                name: "linux-image-generic".into(),
                reason: "Kernel package for a system.".into(),
            }],
        };
        assert!(manifest_to_profile(protected)
            .unwrap_err()
            .contains("not allowed"));
    }

    #[test]
    fn rejects_invalid_or_duplicate_package_names() {
        let invalid = ExtensionManifest {
            schema_version: 1,
            id: "bad-name".into(),
            title: "Bad profile".into(),
            description: "A profile with invalid names.".into(),
            category: "Tools".into(),
            packages: vec![ExtensionPackage {
                name: "git;rm".into(),
                reason: "Tracks source files.".into(),
            }],
        };
        assert!(manifest_to_profile(invalid)
            .unwrap_err()
            .contains("Invalid APT"));
        let duplicate = ExtensionManifest {
            schema_version: 1,
            id: "duplicate".into(),
            title: "Duplicate list".into(),
            description: "A list containing repeated names.".into(),
            category: "Tools".into(),
            packages: vec![
                ExtensionPackage {
                    name: "pandoc".into(),
                    reason: "Converts documents.".into(),
                },
                ExtensionPackage {
                    name: "pandoc".into(),
                    reason: "Converts documents.".into(),
                },
            ],
        };
        assert!(manifest_to_profile(duplicate)
            .unwrap_err()
            .contains("Duplicate"));
    }
}
