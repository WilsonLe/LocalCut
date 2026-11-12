import { BrowserRouter } from 'react-router';
import './workspace/workspace.css';

import { Workspace } from './workspace/Workspace';

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL} useTransitions={false}>
      <Workspace />
    </BrowserRouter>
  );
}
