import { useAppearance } from './appearance';
import type { Ref } from 'react';
import './storyboard-asset-path';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ImagePlus, Redo2, Undo2 } from 'lucide-react';
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  restoreElements,
} from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import { storyboardSchema } from '../core/storyboard';
import type { Editor, Project, Storyboard as Scene, Asset } from '../editor';
import { StoryboardSession } from './storyboard-session';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../components/ui/select';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';
import { downloadFile } from './helpers';
import type { StoryboardExportOptions, Job } from '../editor';

const restore = (scene: Scene) =>
  restoreElements(scene.elements as unknown as ExcalidrawElement[], null);
export interface StoryboardControls {
  flush: () => Promise<boolean>;
}
export function Storyboard({
  editor,
  project,
  readOnly,
  active,
  onSaved,
  onError,
  controlsRef,
}: {
  editor: Editor;
  project: Project;
  readOnly: boolean;
  active: boolean;
  onSaved: () => Promise<unknown>;
  onError: (error: unknown) => void;
  controlsRef: Ref<StoryboardControls>;
}) {
  const { dark } = useAppearance();
  const theme = dark ? 'dark' : 'light';
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const pointerDown = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<Element | null>(null);
  const [reset, setReset] = useState<Scene | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportSelection, setExportSelection] = useState(false);
  const [exportBackground, setExportBackground] = useState(true);
  const [exportScale, setExportScale] = useState(1);
  const exportJob = useRef<Job<unknown> | null>(null);
  const mounted = useRef(true);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [imagePicker, setImagePicker] = useState(false);
  const [imageSources, setImageSources] = useState<Asset[]>([]);
  const [imageSource, setImageSource] = useState<string | null>(null);
  const [imageTime, setImageTime] = useState('0');
  const [inserting, setInserting] = useState(false);
  const imageJob = useRef<Job<unknown> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      exportJob.current?.cancel();
      imageJob.current?.cancel();
    };
  }, []);
  const [session] = useState(
    () =>
      new StoryboardSession(
        editor,
        project,
        () => void onSaved().catch(onError),
        onError,
        (scene) => {
          setReset(scene);
        },
      ),
  );
  useImperativeHandle(controlsRef, () => ({ flush: () => session.flush() }), [
    session,
  ]);
  useEffect(() => {
    session.reconcile(project);
  }, [project, session]);
  useEffect(() => {
    if (!reset || !api) return;
    api.updateScene({
      elements: restore(reset),
      appState: { viewBackgroundColor: reset.backgroundColor },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    session.acknowledgeReset(
      storyboardSchema.parse({
        elements: api.getSceneElements(),
        backgroundColor: api.getAppState().viewBackgroundColor,
      }),
    );
    api.history.clear();
  }, [reset, api, session]);
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void editor.storyboard
      .files(project, controller.signal)
      .then((files) => {
        if (!controller.signal.aborted) api.addFiles(Object.values(files));
      })
      .catch((error) => {
        if (!controller.signal.aborted) onError(error);
      });
    return () => controller.abort();
  }, [api, editor, project, onError]);
  useEffect(() => {
    if (!active || readOnly) void session.flush();
  }, [active, readOnly, session]);
  useEffect(() => () => session.close(), [session]);
  useEffect(() => {
    const canvas = container.current;
    if (!canvas || !api) return;
    // The pinned vendor has no in-toolbar slot. Follow its desktop/mobile
    // toolbar replacements while keeping history controls owned by React.
    const locateToolbar = () => {
      // The pinned vendor's embedded MainMenu has no trigger-label prop.
      const menu = canvas.querySelector('[data-testid="main-menu-trigger"]');
      menu?.setAttribute('aria-label', 'Storyboard menu');
      menu?.setAttribute('title', 'Storyboard menu');
      setToolbar(
        canvas.querySelector(
          '.App-menu_top .shapes-section .App-toolbar > .Stack_horizontal, .App-top-bar .App-toolbar > .Stack_horizontal',
        ),
      );
    };
    const observer = new MutationObserver(locateToolbar);
    observer.observe(canvas, { childList: true, subtree: true });
    locateToolbar();
    return () => observer.disconnect();
  }, [api]);
  useEffect(() => {
    if (!api || !container.current) return;
    let width = 0;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (next <= 0) return;
      if (width && Math.abs(next - width) > 50) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() =>
          api.scrollToContent(undefined, {
            fitToContent: true,
            animate: false,
          }),
        );
      }
      width = next;
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [api]);

  const insertImage = async (assetId: string, timeUs = 0) => {
    if (readOnly || !active || imageJob.current) return;
    setInserting(true);
    try {
      if (!(await session.flush()) || !mounted.current) return;
      const latest = await editor.projects.snapshot(project.id);
      if (!mounted.current) return;
      const view = api?.getAppState();
      const job = editor.storyboard.insertImage(
        project.id,
        {
          assetId,
          timeUs,
          elementId: crypto.randomUUID(),
          x: view ? -view.scrollX + 40 : 0,
          y: view ? -view.scrollY + 40 : 0,
        },
        latest.revision,
      );
      imageJob.current = job;
      await job.completion;
      if (mounted.current) {
        setImagePicker(false);
        await onSaved();
      }
    } catch (error) {
      if (mounted.current) onError(error);
    } finally {
      imageJob.current = null;
      if (mounted.current) setInserting(false);
    }
  };
  const openImagePicker = async () => {
    try {
      const library = await editor.library.forProject(project.id).list();
      const byId = new Map(library.entries.map((e) => [e.id, e]));
      const ids = [
        ...new Set(
          library.entries
            .filter((e) => {
              let node: typeof e | undefined = e;
              while (node) {
                if (node.trashed) return false;
                node = node.parentId ? byId.get(node.parentId) : undefined;
              }
              return !!e.assetId;
            })
            .map((e) => e.assetId!),
        ),
      ];
      const sources = (
        await Promise.all(ids.map((id) => editor.assets.inspect(id)))
      ).filter(
        (a) => a.status === 'ready' && ['image', 'video'].includes(a.kind),
      );
      if (!mounted.current) return;
      setImageSources(sources);
      setImageSource(sources[0]?.id ?? null);
      setImageTime('0');
      setImagePicker(true);
    } catch (error) {
      onError(error);
    }
  };
  const uploadImage = async (file: File) => {
    if (readOnly || !active || inserting || imageJob.current) return;
    setInserting(true);
    try {
      const job = editor.assets.import(file);
      imageJob.current = job;
      const asset = await job.completion;
      await editor.library.forProject(project.id).place(asset.id, [], null);
      imageJob.current = null;
      if (mounted.current) await insertImage(asset.id);
    } catch (error) {
      imageJob.current = null;
      if (mounted.current) onError(error);
    } finally {
      if (mounted.current) setInserting(false);
    }
  };
  const history = async (redo = false) => {
    if (!(await session.flush())) return;
    try {
      const latest = await editor.projects.snapshot(project.id);
      await editor.commands[redo ? 'redo' : 'undo'](
        project.id,
        crypto.randomUUID(),
        latest.revision,
      );
      await onSaved();
    } catch (error) {
      onError(error);
    }
  };
  const exportBoard = async (
    format: StoryboardExportOptions['format'],
    store = false,
  ) => {
    if (exportJob.current || exporting || readOnly || !active) return;
    setExporting(true);
    try {
      if (!(await session.flush()) || !mounted.current) return;
      const latest = await editor.projects.snapshot(project.id);
      if (!mounted.current) return;
      const options: StoryboardExportOptions = {
        format,
        background: exportBackground,
        scale: exportScale,
        ...(exportSelection
          ? {
              elementIds: Object.entries(
                api?.getAppState().selectedElementIds ?? {},
              )
                .filter(([, selected]) => selected)
                .map(([id]) => id),
            }
          : {}),
      };
      if (store) {
        const job = editor.storyboard.store(
          project.id,
          { ...options, format: 'png' },
          latest.revision,
        );
        exportJob.current = job;
        await job.completion;
        if (mounted.current) await onSaved();
      } else {
        const job = editor.storyboard.export(
          project.id,
          options,
          latest.revision,
        );
        exportJob.current = job;
        const result = await job.completion;
        if (mounted.current) downloadFile(result.file, result.file.name);
      }
    } catch (error) {
      if (mounted.current) onError(error);
    } finally {
      exportJob.current = null;
      if (mounted.current) setExporting(false);
    }
  };
  return (
    <section
      className="storyboard"
      data-storyboard
      aria-label="Project storyboard"
      onDropCapture={(event) => {
        // Vendor file/library imports bypass its disabled load action and onPaste.
        // Keep both live and historical views owned by the project engine.
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragOverCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDownCapture={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === 'z' ||
            event.key.toLowerCase() === 'y') &&
          !(
            event.target instanceof Element &&
            event.target.closest('textarea,input,[contenteditable="true"]')
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!readOnly)
            void history(event.shiftKey || event.key.toLowerCase() === 'y');
        }
      }}
    >
      <input
        ref={uploadInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="Upload storyboard image"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void uploadImage(file);
        }}
      />
      <Dialog open={imagePicker} onOpenChange={setImagePicker}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Insert image from Media</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <Select
              value={imageSource}
              onValueChange={(value) => {
                setImageSource(value);
                setImageTime('0');
              }}
              items={imageSources.map((a) => ({ value: a.id, label: a.name }))}
            >
              <SelectTrigger aria-label="Image source" className="w-full">
                <SelectValue placeholder="Select image or video" />
              </SelectTrigger>
              <SelectContent>
                {imageSources.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {imageSources.find((a) => a.id === imageSource)?.kind ===
              'video' && (
              <label>
                Video time (seconds)
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={imageTime}
                  onChange={(event) => setImageTime(event.target.value)}
                />
              </label>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={!imageSource || inserting}
              onClick={() =>
                imageSource &&
                void insertImage(
                  imageSource,
                  Math.round(Number(imageTime) * 1e6),
                )
              }
            >
              Insert image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {exporting && (
        <span role="status" className="sr-only">
          Exporting storyboard
        </span>
      )}
      {toolbar &&
        active &&
        !readOnly &&
        createPortal(
          <div
            className="storyboard-history"
            role="group"
            aria-label="Project history"
          >
            <Tooltip content="Undo">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Undo"
                onClick={() => void history()}
              >
                <Undo2 />
              </Button>
            </Tooltip>
            <Tooltip content="Redo">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Redo"
                onClick={() => void history(true)}
              >
                <Redo2 />
              </Button>
            </Tooltip>
          </div>,
          toolbar,
        )}
      <div className="storyboard-canvas" ref={container}>
        <Excalidraw
          excalidrawAPI={setApi}
          theme={theme}
          initialData={{
            elements: restore(session.scene()),
            appState: { viewBackgroundColor: session.scene().backgroundColor },
            scrollToContent: true,
          }}
          viewModeEnabled={readOnly || !active}
          handleKeyboardGlobally={false}
          autoFocus={false}
          detectScroll={false}
          validateEmbeddable={() => false}
          onPaste={(data) =>
            !(
              data.files?.length ||
              data.elements?.some((e) =>
                ['image', 'embeddable', 'iframe'].includes(e.type),
              )
            )
          }
          UIOptions={{
            tools: { image: false },
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              saveAsImage: false,
              toggleTheme: false,
            },
          }}
          onPointerDown={() => {
            pointerDown.current = true;
          }}
          onPointerUp={() => {
            pointerDown.current = false;
            if (!api?.getAppState().editingTextElement) void session.flush();
          }}
          onChange={(elements, state) => {
            if (
              readOnly ||
              !active ||
              state.isLoading ||
              session.resetting ||
              project.revision > session.project.revision
            )
              return;
            try {
              // Excalidraw's view/selection state is session-owned; only authored content is saved.
              const scene = storyboardSchema.parse({
                elements: elements
                  .filter((e) => !e.isDeleted)
                  .map((e) => {
                    const element = { ...e };
                    delete element.customData;
                    return { ...element, link: null };
                  }),
                backgroundColor: state.viewBackgroundColor,
              });
              session.change(
                scene,
                pointerDown.current || !!state.editingTextElement,
              );
            } catch (error) {
              onError(error);
            }
          }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            {!readOnly && (
              <MainMenu.Group title="Storyboard images">
                <MainMenu.Item
                  icon={<ImagePlus />}
                  disabled={inserting || !active}
                  onSelect={() => uploadInput.current?.click()}
                >
                  Upload image
                </MainMenu.Item>
                <MainMenu.Item
                  icon={<ImagePlus />}
                  disabled={inserting || !active}
                  onSelect={() => void openImagePicker()}
                >
                  Insert image from Media
                </MainMenu.Item>
              </MainMenu.Group>
            )}
            {!readOnly && (
              <MainMenu.Group title="Storyboard export">
                <MainMenu.Item
                  selected={exportSelection}
                  disabled={exporting}
                  onSelect={() => setExportSelection((value) => !value)}
                >
                  {exportSelection
                    ? 'Export selected elements'
                    : 'Export entire board'}
                </MainMenu.Item>
                <MainMenu.Item
                  selected={exportBackground}
                  disabled={exporting}
                  onSelect={() => setExportBackground((value) => !value)}
                >
                  {exportBackground
                    ? 'Include background'
                    : 'Transparent background'}
                </MainMenu.Item>
                <MainMenu.Item
                  disabled={exporting}
                  onSelect={() =>
                    setExportScale((value) => (value === 4 ? 1 : value * 2))
                  }
                >
                  Export scale: {exportScale}×
                </MainMenu.Item>
                {(['png', 'svg', 'excalidraw'] as const).map((format) => (
                  <MainMenu.Item
                    key={format}
                    icon={<Download />}
                    disabled={exporting || !active}
                    onSelect={() => void exportBoard(format)}
                  >
                    Export{' '}
                    {format === 'excalidraw'
                      ? 'editable scene'
                      : format.toUpperCase()}
                  </MainMenu.Item>
                ))}
                <MainMenu.Item
                  icon={<ImagePlus />}
                  disabled={exporting || !active}
                  onSelect={() => void exportBoard('png', true)}
                >
                  Store PNG in Media
                </MainMenu.Item>
              </MainMenu.Group>
            )}
          </MainMenu>
        </Excalidraw>
      </div>
    </section>
  );
}
