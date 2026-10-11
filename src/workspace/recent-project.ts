export const recentProjectKey = 'localcut.recent-project.v1';

export function readRecentProject(): string | undefined {
  try {
    const text = localStorage.getItem(recentProjectKey);
    if (!text || text.length > 1500) return;
    const record = JSON.parse(text) as {
      version?: unknown;
      projectId?: unknown;
    };
    if (
      record?.version === 1 &&
      typeof record.projectId === 'string' &&
      record.projectId.length > 0 &&
      record.projectId.length <= 200
    ) {
      // Reject malformed UTF-16 before startup tries to encode a project URL.
      encodeURIComponent(record.projectId);
      return record.projectId;
    }
  } catch {
    // Unavailable UI storage must not block local editing.
  }
}

export function rememberProject(projectId: string) {
  try {
    localStorage.setItem(
      recentProjectKey,
      JSON.stringify({ version: 1, projectId }),
    );
  } catch {
    // Opening a project remains usable when localStorage is unavailable.
  }
}

export function forgetRecentProject(projectId: string) {
  try {
    if (readRecentProject() === projectId)
      localStorage.removeItem(recentProjectKey);
  } catch {
    // Do not disturb another window's more recent selection.
  }
}
