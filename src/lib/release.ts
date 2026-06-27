// Release-channel switches.
//
// Keep in-app updates disabled while release artifacts live in a private GitHub
// repository. GitHub Actions can still build draft releases, but the shipped
// app cannot fetch private `latest.json` / installer assets anonymously.
export const IN_APP_UPDATES_ENABLED = false;
