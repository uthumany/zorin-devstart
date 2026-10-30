use std::{
    fs::{self, File, OpenOptions},
    io,
    os::{
        fd::AsRawFd,
        unix::fs::{MetadataExt, OpenOptionsExt},
    },
    path::{Path, PathBuf},
};

const PACKAGE_LOCKS: &[&str] = &[
    "/var/lib/dpkg/lock-frontend",
    "/var/lib/dpkg/lock",
    "/var/cache/apt/archives/lock",
    "/var/lib/apt/lists/lock",
];

#[derive(Debug)]
pub struct OperationLock {
    _file: File,
}

pub fn acquire_operation_lock(data_dir: &Path) -> Result<OperationLock, String> {
    fs::create_dir_all(data_dir)
        .map_err(|error| format!("Could not prepare the local operation-lock folder: {error}"))?;
    let path = data_dir.join("operation.lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(&path)
        .map_err(|error| format!("Could not open the local operation lock: {error}"))?;
    acquire_file_lock(&file).map_err(|error| {
        if error.kind() == io::ErrorKind::WouldBlock {
            "Another DevStart process is using this device. Wait for that operation to finish before continuing.".into()
        } else {
            format!("Could not acquire the local operation lock: {error}")
        }
    })?;
    Ok(OperationLock { _file: file })
}

fn acquire_file_lock(file: &File) -> io::Result<()> {
    // SAFETY: flock only reads the valid file descriptor and receives supported flags.
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        Ok(())
    } else {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::EAGAIN) {
            Err(io::Error::new(io::ErrorKind::WouldBlock, error))
        } else {
            Err(error)
        }
    }
}

pub fn ensure_no_active_package_manager() -> Result<(), String> {
    let locks = fs::read_to_string("/proc/locks")
        .map_err(|error| format!("Could not verify system package-manager locks: {error}. No package change was started."))?;
    for raw_path in PACKAGE_LOCKS {
        let path = Path::new(raw_path);
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "Could not inspect package-manager lock {}: {error}. No package change was started.",
                    path.display()
                ));
            }
        };
        let device_inode = format_device_inode(metadata.dev(), metadata.ino());
        if let Some(owner) = matching_lock_owner(&locks, &device_inode) {
            let owner = owner
                .parse::<u32>()
                .ok()
                .filter(|pid| *pid > 0)
                .map(|pid| format!("PID {pid}"))
                .unwrap_or_else(|| "another process".into());
            return Err(format!(
                "Another package operation is running ({owner}, lock {}); wait for it to finish and try again.",
                path.display()
            ));
        }
    }
    Ok(())
}

fn format_device_inode(device: u64, inode: u64) -> String {
    format!(
        "{:02x}:{:02x}:{inode}",
        libc::major(device),
        libc::minor(device)
    )
}

fn matching_lock_owner(locks: &str, device_inode: &str) -> Option<String> {
    for line in locks.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        let offset = 1;
        // A leading arrow denotes a waiting lock request, not a lock currently held.
        if fields.get(offset) == Some(&"->") {
            continue;
        }
        let Some(active_device_inode) = fields.get(offset + 4) else {
            continue;
        };
        if *active_device_inode == device_inode {
            return fields.get(offset + 3).map(|pid| (*pid).to_string());
        }
    }
    None
}

#[allow(dead_code)]
fn lock_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join("operation.lock")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::Command,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_TEST_DIR: AtomicU64 = AtomicU64::new(1);
    const CHILD_LOCK_TEST: &str = "DEVSTART_LOCK_CHILD_PATH";

    fn test_dir() -> PathBuf {
        let serial = NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "zorin-devstart-lock-test-{}-{serial}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn child_process_cannot_acquire_held_operation_lock() {
        let Ok(data_dir) = std::env::var(CHILD_LOCK_TEST) else {
            return;
        };
        let result = acquire_operation_lock(Path::new(&data_dir));
        assert!(result
            .unwrap_err()
            .contains("Another DevStart process is using this device"));
    }

    #[test]
    fn operation_lock_is_exclusive_across_processes_and_released_on_drop() {
        let dir = test_dir();
        let lock = acquire_operation_lock(&dir).unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "locking::tests::child_process_cannot_acquire_held_operation_lock",
                "--nocapture",
            ])
            .env(CHILD_LOCK_TEST, &dir)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        drop(lock);
        assert!(acquire_operation_lock(&dir).is_ok());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn device_inode_matches_linux_proc_locks_zero_padded_format() {
        assert_eq!(
            format_device_inode(libc::makedev(8, 1), 12345),
            "08:01:12345"
        );
        assert_eq!(format_device_inode(libc::makedev(254, 0), 987), "fe:00:987");
    }

    #[test]
    fn package_lock_parser_detects_active_locks_and_ignores_waiting_requests() {
        let device_inode = "08:01:12345";
        let waiting = format!("1: -> POSIX ADVISORY WRITE 111 {device_inode} 0 EOF");
        assert_eq!(matching_lock_owner(&waiting, device_inode), None);
        let active = format!("2: POSIX ADVISORY WRITE 222 {device_inode} 0 EOF");
        assert_eq!(
            matching_lock_owner(&active, device_inode).as_deref(),
            Some("222")
        );
    }

    #[test]
    fn lock_path_is_scoped_to_local_data_directory() {
        let path = lock_file_path(Path::new("/tmp/example"));
        assert_eq!(path, PathBuf::from("/tmp/example/operation.lock"));
    }
}
