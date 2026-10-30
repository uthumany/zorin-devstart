use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Store {
    #[serde(default)]
    pub tracked_profiles: HashMap<String, OwnedProfile>,
    #[serde(default)]
    pub history: Vec<OperationRecord>,
    #[serde(default)]
    pub pending_reconciliation: Option<PendingReconciliation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnedProfile {
    pub installed_at: String,
    pub owned_packages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationRecord {
    pub id: String,
    pub profile_id: String,
    pub profile_title: String,
    pub action: String,
    pub status: String,
    pub message: String,
    pub packages: Vec<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingReconciliation {
    pub id: String,
    pub profile_id: String,
    pub profile_title: String,
    pub packages: Vec<String>,
    pub before_packages: Vec<String>,
    #[serde(default)]
    pub plan_digest: String,
    pub reason: String,
    pub created_at: String,
}

impl Store {
    pub fn load() -> Result<Self, String> {
        let path = state_path()
            .ok_or_else(|| "Could not resolve the local data directory.".to_string())?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let content =
            fs::read_to_string(&path).map_err(|e| format!("Could not read DevStart state: {e}"))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("DevStart state is invalid; it was not overwritten: {e}"))
    }

    pub fn save(&self) -> Result<(), String> {
        let path = state_path()
            .ok_or_else(|| "Could not resolve the local data directory.".to_string())?;
        let parent = path
            .parent()
            .ok_or_else(|| "Could not resolve the local data directory.".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create the local data folder: {e}"))?;
        let temp_path = path.with_extension("json.tmp");
        let content = serde_json::to_vec_pretty(self)
            .map_err(|e| format!("Could not encode local state: {e}"))?;
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("Could not prepare state file: {e}"))?;
        file.write_all(&content)
            .map_err(|e| format!("Could not write state file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Could not sync state file: {e}"))?;
        fs::rename(&temp_path, &path)
            .map_err(|e| format!("Could not save state atomically: {e}"))?;
        Ok(())
    }

    pub fn record(
        &mut self,
        profile_id: &str,
        title: &str,
        action: &str,
        status: &str,
        message: &str,
        packages: Vec<String>,
    ) {
        let timestamp = Utc::now().to_rfc3339();
        let serial = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let id = format!("{}-{serial}", Utc::now().timestamp_millis());
        self.history.insert(
            0,
            OperationRecord {
                id,
                profile_id: profile_id.to_string(),
                profile_title: title.to_string(),
                action: action.to_string(),
                status: status.to_string(),
                message: message.to_string(),
                packages,
                timestamp,
            },
        );
        self.history.truncate(100);
    }
}

pub fn state_path() -> Option<PathBuf> {
    data_dir().map(|path| path.join("state.json"))
}

pub fn data_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|path| path.join("zorin-devstart"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_history_is_bounded_and_newest_first() {
        let mut store = Store::default();
        for i in 0..105 {
            store.record(
                "python",
                "Python",
                "install",
                "success",
                &format!("operation {i}"),
                vec![],
            );
        }
        assert_eq!(store.history.len(), 100);
        assert_eq!(store.history[0].message, "operation 104");
    }

    #[test]
    fn store_has_no_secret_or_command_fields() {
        let store = Store::default();
        let json = serde_json::to_string(&store).unwrap();
        assert!(!json.contains("password"));
        assert!(!json.contains("command"));
    }

    #[test]
    fn older_state_without_pending_plan_remains_compatible() {
        let store: Store = serde_json::from_str(r#"{"tracked_profiles":{},"history":[]}"#)
            .expect("legacy state should deserialize");
        assert!(store.pending_reconciliation.is_none());
    }

    #[test]
    fn pending_reconciliation_round_trips_as_durable_state() {
        let store = Store {
            pending_reconciliation: Some(PendingReconciliation {
                id: "plan-1".into(),
                profile_id: "web".into(),
                profile_title: "Web development".into(),
                packages: vec!["nodejs".into(), "npm".into()],
                before_packages: vec!["git".into()],
                plan_digest: "sha256:test".into(),
                reason: "inventory unavailable".into(),
                created_at: "test-time".into(),
            }),
            ..Default::default()
        };
        let json = serde_json::to_string(&store).unwrap();
        let restored: Store = serde_json::from_str(&json).unwrap();
        assert_eq!(
            restored.pending_reconciliation,
            store.pending_reconciliation
        );
    }
}
