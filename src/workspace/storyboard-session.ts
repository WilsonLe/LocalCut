import type { Editor, Project, Storyboard } from '../editor';
import { canonical } from '../core/commands';

function content(scene: Storyboard) {
  return canonical({
    ...scene,
    elements: scene.elements.map((element) =>
      Object.fromEntries(
        Object.entries(element).filter(
          ([key]) =>
            !['version', 'versionNonce', 'index', 'updated'].includes(key),
        ),
      ),
    ),
  });
}

/** One serialized writer, bound to the revision which authored each canvas edit. */
export class StoryboardSession {
  project: Project;
  resetting = false;
  private baseline: Storyboard | null = null;
  acknowledgeReset(scene: Storyboard) {
    this.baseline = scene;
    this.resetting = false;
  }

  private pending: Storyboard | null = null;
  private writing: Promise<boolean> | null = null;
  private expected: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  constructor(
    private editor: Editor,
    project: Project,
    private saved: () => void,
    private failed: (error: unknown) => void,
    private reset: (scene: Storyboard) => void,
  ) {
    this.project = project;
  }
  scene() {
    return (
      this.project.storyboard ?? { elements: [], backgroundColor: '#ffffff' }
    );
  }
  reconcile(project: Project) {
    if (project.revision <= this.project.revision) return;
    // A local publication may arrive before its receipt. A conflicting writer will
    // instead reject our revision-bound batch, then reload authoritative content.
    if (this.writing && project.revision === this.expected! + 1) return;
    const dirty = !!this.pending;
    this.pending = null;
    clearTimeout(this.timer);
    this.project = project;
    this.resetting = true;
    this.reset(this.scene());
    if (dirty)
      this.failed(
        new Error(
          'The project changed. The storyboard was refreshed; retry your drawing.',
        ),
      );
  }
  change(scene: Storyboard, defer = false) {
    if (this.closed) return;
    if (
      content(scene) !== content(this.pending ?? this.baseline ?? this.scene())
    )
      this.pending = scene;
    clearTimeout(this.timer);
    if (this.pending && !defer)
      this.timer = setTimeout(() => void this.flush(), 150);
  }
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.writing) {
      const success = await this.writing;
      return success && this.flush();
    }
    if (!this.pending) return true;
    const scene = this.pending;
    const authored = this.project;
    this.pending = null;
    this.baseline = scene;
    this.expected = authored.revision;
    this.writing = this.write(scene, authored);
    const success = await this.writing;
    this.writing = null;
    this.expected = null;
    return success && (this.pending ? this.flush() : true);
  }
  private async write(scene: Storyboard, authored: Project): Promise<boolean> {
    try {
      const receipt = await this.editor.commands.apply({
        projectId: authored.id,
        requestId: crypto.randomUUID(),
        expectedRevision: authored.revision,
        operations: [{ type: 'setStoryboard', storyboard: scene }],
      });
      if (this.project.revision <= receipt.appliedRevision) {
        this.project = {
          ...authored,
          storyboard: scene,
          revision: receipt.appliedRevision,
        };
        this.baseline = scene;
      }
      if (!this.closed) this.saved();
      return true;
    } catch (error) {
      this.pending = null;
      try {
        this.project = await this.editor.projects.snapshot(authored.id);
      } catch {
        /* Preserve the last readable scene for recovery. */
      }
      if (!this.closed) {
        this.resetting = true;
        this.reset(this.scene());
        this.failed(error);
      }
      return false;
    }
  }
  close() {
    this.closed = true;
    void this.flush();
  }
}
