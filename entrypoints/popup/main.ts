import '../../src/app/styles.css';
import { mountAegisTotpApp } from '../../src/app/main';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('App root is missing.');
}

mountAegisTotpApp(root, {
  variant: 'extension'
});
