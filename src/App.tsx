import { lazy, Suspense } from 'react';
import { HashRouter } from 'react-router';
import './workspace/workspace.css';

// Listen for navigation while the workspace chunk is loading.
const Workspace = lazy(() =>
  import('./workspace/Workspace').then((module) => ({
    default: module.Workspace,
  })),
);

export function App() {
  return (
    <HashRouter useTransitions={false}>
      <Suspense fallback={<p role="status">Loading workspace…</p>}>
        <Workspace />
      </Suspense>
    </HashRouter>
  );
}
