//! OS keychain access for the Immich API key.
//!
//! Uses the `keyring` crate, which maps to Keychain (macOS), Credential
//! Manager (Windows), and Secret Service / libsecret (Linux).
//!
//! On Linux, Secret Service requires a D-Bus session and a provider like
//! GNOME Keyring or KWallet. When unavailable (headless, minimal WMs),
//! operations return a descriptive error rather than panicking.

use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "com.immichbeam.desktop";
const ACCOUNT: &str = "api-key";

fn entry() -> Result<Entry> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| {
        if is_no_backend(&e) {
            anyhow::anyhow!("{}", no_backend_message())
        } else {
            anyhow::anyhow!(e).context("opening keychain entry")
        }
    })
}

/// Store (or overwrite) the API key.
pub fn set_api_key(key: &str) -> Result<()> {
    entry()?.set_password(key).map_err(|e| {
        if is_no_backend(&e) {
            anyhow::anyhow!("{}", no_backend_message())
        } else {
            anyhow::anyhow!(e).context("writing API key to keychain")
        }
    })
}

/// Retrieve the API key, or `None` if not yet stored.
pub fn get_api_key() -> Result<Option<String>> {
    match entry()?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) if is_no_backend(&e) => {
            log::warn!("{}", no_backend_message());
            Ok(None)
        }
        Err(e) => Err(e).context("reading API key from keychain"),
    }
}

/// Remove the stored API key (used on "disconnect").
pub fn delete_api_key() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) if is_no_backend(&e) => Ok(()),
        Err(e) => Err(e).context("deleting API key from keychain"),
    }
}

/// True if the error indicates the platform has no keychain backend available.
fn is_no_backend(e: &keyring::Error) -> bool {
    matches!(e, keyring::Error::NoStorageAccess(_))
        || format!("{e}").to_lowercase().contains("no matching backend")
        || format!("{e}").to_lowercase().contains("secret service")
        || format!("{e}").to_lowercase().contains("dbus")
}

fn no_backend_message() -> &'static str {
    "No system keychain available. On Linux, install and start \
     GNOME Keyring or KWallet (requires a D-Bus session)."
}
