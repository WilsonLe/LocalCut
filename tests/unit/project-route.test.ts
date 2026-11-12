import { describe, expect, it } from 'vitest';
import {
  parseProjectRoute,
  projectRoutePath,
} from '../../src/workspace/project-route';

describe('local project routes', () => {
  it('identifies the screen and current project without putting content in the URL', () => {
    expect(parseProjectRoute('/')).toEqual({ screen: 'projects' });
    expect(parseProjectRoute('/projects')).toEqual({ screen: 'projects' });
    expect(parseProjectRoute('/workspace/project-123')).toEqual({
      screen: 'editor',
      projectId: 'project-123',
    });
    expect(parseProjectRoute('/', '?project=project-123')).toEqual({
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
      '.',
      '~..',
      '%2E%2E',
      'x'.repeat(200),
    ]) {
      const path = projectRoutePath('editor', id);
      expect(
        parseProjectRoute(new URL(path, 'https://localcut.example').pathname),
      ).toEqual({
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
      '/workspace',
      '/workspace/',
      '/workspace/a/b',
      '/workspace/%',
      `/workspace/${'x'.repeat(201)}`,
    ])
      expect(parseProjectRoute(path)).toEqual({ screen: 'invalid' });
    for (const query of ['?project=', '?project=a&project=b'])
      expect(parseProjectRoute('/', query)).toEqual({
        screen: 'invalid',
      });
    expect(parseProjectRoute('/workspace/a', '?project=b')).toEqual({
      screen: 'invalid',
    });
    expect(() => projectRoutePath('editor', 'x'.repeat(201))).toThrow(
      'Invalid project ID',
    );
  });
  it('preserves legacy project links and ignores non-identity reload parameters', () => {
    expect(parseProjectRoute('/project/old%20id')).toEqual({
      screen: 'editor',
      projectId: 'old id',
    });
    expect(
      parseProjectRoute('/workspace/a', '?view=retained&_localcut_reload=1'),
    ).toEqual({ screen: 'editor', projectId: 'a' });
    expect(parseProjectRoute('/', '?view=retained')).toEqual({
      screen: 'projects',
    });
    expect(projectRoutePath('projects')).toBe('/');
    expect(projectRoutePath('editor', 'a')).toBe('/workspace/a');
  });
});
