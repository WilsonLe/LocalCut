import { useAppearance } from './appearance';
import type { Ref } from 'react';
import './storyboard-asset-path';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Redo2, Undo2 } from 'lucide-react';
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
import type { Editor, Project, Storyboard as Scene } from '../editor';
import { StoryboardSession } from './storyboard-session';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';

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
    if (!active || readOnly) void session.flush();
  }, [active, readOnly, session]);
  useEffect(() => () => session.close(), [session]);
  useEffect(() => {
    const canvas = container.current;
    if (!canvas || !api) return;
    // The pinned vendor has no in-toolbar slot. Follow its desktop/mobile
    // toolbar replacements while keeping history controls owned by React.
    const locateToolbar = () =>
      setToolbar(
        canvas.querySelector(
          '.App-menu_top .shapes-section .App-toolbar > .Stack_horizontal, .App-top-bar .App-toolbar > .Stack_horizontal',
        ),
      );
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
          </MainMenu>
        </Excalidraw>
      </div>
    </section>
  );
}
