import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'Aegis TOTP Viewer',
    description: 'Open encrypted Aegis backups and view TOTP codes locally.',
    permissions: ['clipboardWrite'],
    action: {
      default_title: 'Aegis TOTP Viewer'
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              data_collection_permissions: {
                required: ['none']
              }
            }
          }
        }
      : {})
  })
});
