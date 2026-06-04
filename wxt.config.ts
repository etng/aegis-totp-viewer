import { defineConfig } from 'wxt';

const extensionIcons = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  96: 'icons/icon-96.png',
  128: 'icons/icon-128.png'
};

const extensionAction = {
  default_title: 'Aegis TOTP Viewer',
  default_icon: extensionIcons
};

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'Aegis TOTP Viewer',
    description: 'Open encrypted Aegis backups and view TOTP codes locally.',
    icons: extensionIcons,
    permissions: ['clipboardWrite'],
    ...(browser === 'firefox'
      ? {
          browser_action: extensionAction,
          browser_specific_settings: {
            gecko: {
              data_collection_permissions: {
                required: ['none']
              }
            }
          }
        }
      : {
          action: extensionAction
        })
  })
});
