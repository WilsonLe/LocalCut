import { HashRouter } from 'react-router';
import './workspace/workspace.css';

import { Workspace } from './workspace/Workspace';

export function App() {
  return (
    <HashRouter useTransitions={false}>
      <Workspace />
    </HashRouter>
  );
}
