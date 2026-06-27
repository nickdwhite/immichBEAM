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
const ACCOUNT_API_KEY: &str = "api-key";
const ACCOUNT_EMAIL: &str = "login-email";
const ACCOUNT_PASSWORD: &str = "login-password";
const ACCOUNT_TOKEN: &str = "login-token";

fn entry() -> Result<Entry> {
    Entry::new(SERVICE, ACCOUNT_API_KEY).map_err(|e| {
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

fn named_entry(account: &str) -> Result<Entry> {
    Entry::new(SERVICE, account).map_err(|e| {
        if is_no_backend(&e) {
            anyhow::anyhow!("{}", no_backend_message())
        } else {
            anyhow::anyhow!(e).context(format!("opening keychain entry for {account}"))
        }
    })
}

fn set_named(account: &str, value: &str) -> Result<()> {
    named_entry(account)?.set_password(value).map_err(|e| {
        if is_no_backend(&e) {
            anyhow::anyhow!("{}", no_backend_message())
        } else {
            anyhow::anyhow!(e).context(format!("writing {account} to keychain"))
        }
    })
}

fn get_named(account: &str) -> Result<Option<String>> {
    match named_entry(account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) if is_no_backend(&e) => Ok(None),
        Err(e) => Err(e).context(format!("reading {account} from keychain")),
    }
}

fn delete_named(account: &str) -> Result<()> {
    match named_entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) if is_no_backend(&e) => Ok(()),
        Err(e) => Err(e).context(format!("deleting {account} from keychain")),
    }
}

/// Store login credentials (email + password + bearer token).
pub fn set_login_credentials(email: &str, password: &str, token: &str) -> Result<()> {
    set_named(ACCOUNT_EMAIL, email)?;
    set_named(ACCOUNT_PASSWORD, password)?;
    set_named(ACCOUNT_TOKEN, token)?;
    Ok(())
}

/// Retrieve stored login credentials.
pub fn get_login_credentials() -> Result<Option<(String, String, String)>> {
    let email = get_named(ACCOUNT_EMAIL)?;
    let password = get_named(ACCOUNT_PASSWORD)?;
    let token = get_named(ACCOUNT_TOKEN)?;
    match (email, password, token) {
        (Some(e), Some(p), Some(t)) => Ok(Some((e, p, t))),
        _ => Ok(None),
    }
}

/// Update just the bearer token (after re-login).
pub fn set_login_token(token: &str) -> Result<()> {
    set_named(ACCOUNT_TOKEN, token)
}

/// Remove all login credentials.
pub fn delete_login_credentials() -> Result<()> {
    delete_named(ACCOUNT_EMAIL)?;
    delete_named(ACCOUNT_PASSWORD)?;
    delete_named(ACCOUNT_TOKEN)?;
    Ok(())
}
