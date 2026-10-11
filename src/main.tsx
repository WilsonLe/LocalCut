// Strip callback secrets before the routed workspace or any startup work.
import './workspace/oauth-callback';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { initializeAppearance } from './workspace/appearance';
import { initializeWorkspacePreferences } from './workspace/preferences';
import {
  clearReloadMarker,
  ReleaseRecovery,
} from './workspace/ReleaseRecovery';
clearReloadMarker();
initializeAppearance();
initializeWorkspacePreferences();
createRoot(document.getElementById('root')!).render(
  <ReleaseRecovery>
    <App />
  </ReleaseRecovery>,
);
