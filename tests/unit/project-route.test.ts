import { describe, expect, it } from 'vitest';
import {
  parseProjectRoute,
  projectRoutePath,
} from '../../src/workspace/project-route';

describe('local project routes', () => {
  it('identifies the screen and current project without putting content in the URL', () => {
    expect(parseProjectRoute('/')).toEqual({ screen: 'editor' });
    expect(parseProjectRoute('/projects')).toEqual({ screen: 'projects' });
    expect(parseProjectRoute('/project/project-123')).toEqual({
      screen: 'editor',
      projectId: 'project-123',
    });
    expect(parseProjectRoute('/projects', '?project=project-123')).toEqual({
      screen: 'projects',
      projectId: 'project-123',
    });
  });
  it('round trips imported project identities as a single encoded segment', () => {
    for (const id of [
      'project-123',
      'old / project? #',
      '日本語',
      '%',
      '..',
      'x'.repeat(200),
    ]) {
      const path = projectRoutePath('editor', id);
      expect(parseProjectRoute(path)).toEqual({
        screen: 'editor',
        projectId: id,
      });
      const catalog = projectRoutePath('projects', id);
      const [pathname, search] = catalog.split('?');
      expect(parseProjectRoute(pathname!, search)).toEqual({
        screen: 'projects',
        projectId: id,
      });
    }
  });
  it('rejects malformed, ambiguous and unknown addresses without selecting a project', () => {
    for (const path of [
      '/unknown',
      '/project',
      '/project/',
      '/project/a/b',
      '/project/%',
      `/project/${'x'.repeat(201)}`,
    ])
      expect(parseProjectRoute(path)).toEqual({ screen: 'invalid' });
    for (const query of ['?project=', '?project=a&project=b', '?other=a'])
      expect(parseProjectRoute('/projects', query)).toEqual({
        screen: 'invalid',
      });
    expect(parseProjectRoute('/project/a', '?other=b')).toEqual({
      screen: 'invalid',
    });
    expect(() => projectRoutePath('editor', 'x'.repeat(201))).toThrow(
      'Invalid project ID',
    );
  });
});
