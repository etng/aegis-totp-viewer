# Privacy Policy

Last updated: 2026-06-16

Aegis TOTP Viewer is a local viewer for Aegis JSON backup files. The extension does not collect, transmit, sell, or share user data with the developer or third parties.

## Data Processed Locally

When you choose a file or paste JSON, the extension processes that Aegis backup in your browser. Depending on your backup, this may include authentication information such as TOTP/HOTP secrets and one-time codes, backup passwords, issuer names, account labels, notes, favorites, and groups.

All decryption and code generation happen locally in the browser. The extension does not send your backup, password, secrets, generated codes, account labels, notes, search text, or groups to any server.

## Extension Storage

In the Chrome extension, the unlocked vault state may be stored in `chrome.storage.session` so it remains available during the current browser session. This session data is used only to keep the extension usable while the browser session is active. It is cleared when you click **Lock**, and it is not synced to your browser account or sent to the developer.

## Clipboard

If you click a generated code, the extension writes that code to your system clipboard. Your browser or operating system may keep clipboard contents until they are replaced.

## Network, Analytics, and Remote Code

The extension does not use analytics, telemetry, crash reporting, remote APIs, or remotely hosted executable code. All executable code is bundled in the extension package.

Links to the project website, release page, or source repository open only when you choose to click them.

## Data Sharing

Aegis TOTP Viewer does not share user data with the developer, service providers, advertising networks, analytics providers, or other third parties.

## Limited Use

Any user data handled by the extension is used only to provide the user-facing purpose of opening Aegis backups and generating one-time authentication codes locally. The extension does not use user data for advertising, does not transfer user data for unrelated purposes, and does not allow humans to read user data.

## Contact

For questions or security reports, use the project issue tracker:

<https://github.com/etng/aegis-totp-viewer/issues>
