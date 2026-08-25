import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import './styles.css';
import './styles/settings.css';
import './styles/status.css';
import './styles/workspace-home.css';
import './styles/ui-refresh.css';
import './styles/character-editor.css';
import './styles/character-editor-mobile.css';

createApp(App).use(router).mount('#app');
