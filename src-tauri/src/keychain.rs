//! OS keychain access for the Immich API key.
//!
//! Uses the `keyring` crate, which maps to Keychain (macOS), Credential
//! Manager (Windows), and Secret Service / libsecret (Linux).

use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "com.immichsync.desktop";
const ACCOUNT: &str = "api-key";

fn entry() -> Result<Entry> {
    Entry::new(SERVICE, ACCOUNT).context("opening keychain entry")
}

/// Store (or overwrite) the API key.
pub fn set_api_key(key: &str) -> Result<()> {
    entry()?.set_password(key).context("writing API key to keychain")
}

/// Retrieve the API key, or `None` if not yet stored.
pub fn get_api_key() -> Result<Option<String>> {
    match entry()?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e).context("reading API key from keychain"),
    }
}

/// Remove the stored API key (used on "disconnect").
pub fn delete_api_key() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e).context("deleting API key from keychain"),
    }
}
