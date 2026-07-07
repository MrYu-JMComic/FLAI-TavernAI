import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import './styles.css';
import './styles/settings.css';
import './styles/status.css';
import './styles/workspace-home.css';

createApp(App).use(router).mount('#app');
