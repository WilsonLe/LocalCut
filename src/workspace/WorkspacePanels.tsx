import { interfaceScale } from './appearance';
import { Children, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '../components/ui/resizable';
import {
  saveWorkspacePreferences,
  useWorkspacePreferences,
} from './preferences';

type PanelRef = RefObject<PanelImperativeHandle | null>;

/** Pixel keyboard steps and labels stay local to the divider, never the editor. */
function Divider({
  label,
  panel,
  target,
  min,
  max,
  preferred,
  reverse = false,
  vertical = false,
  hidden = false,
  save,
  resizeTarget,
}: {
  label: string;
  panel: PanelRef;
  target: string;
  min: number;
  max: number;
  preferred: number;
  reverse?: boolean;
  vertical?: boolean;
  hidden?: boolean;
  save: (size: number) => void;
  resizeTarget?: 'chat' | 'media';
}) {
  const [size, setSize] = useState(min);
  useEffect(() => {
    const element = document.getElementById(target);
    if (!element) return;
    const measure = () =>
      setSize(Math.round(panel.current?.getSize().inPixels ?? min));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [target, panel, min]);
  if (hidden) return null;
  return (
    <ResizableHandle
      withHandle
      disableDoubleClick
      data-resize-target={resizeTarget}
      aria-label={label}
      aria-valuetext={`${size} pixels`}
      disabled={hidden}
      className={hidden ? 'panel-divider-hidden' : undefined}
      onKeyDownCapture={(event) => {
        const step = event.shiftKey ? 64 : 16;
        const current = Math.max(min, Math.min(max, preferred));
        const increase = vertical
          ? 'ArrowUp'
          : reverse
            ? 'ArrowLeft'
            : 'ArrowRight';
        const decrease = vertical
          ? 'ArrowDown'
          : reverse
            ? 'ArrowRight'
            : 'ArrowLeft';
        const value =
          event.key === increase
            ? current + step
            : event.key === decrease
              ? current - step
              : event.key === 'Home'
                ? min
                : event.key === 'End'
                  ? max
                  : null;
        if (value === null) return;
        event.preventDefault();
        const requested = Math.round(Math.max(min, Math.min(max, value)));
        panel.current?.resize(requested);
        save(requested);
      }}
    />
  );
}

export function WorkspacePanels({
  children,
  media,
  narrow,
  chatCollapsed,
  mediaOpen,
  inert,
}: {
  children: ReactNode;
  media: ReactNode;
  narrow: boolean;
  chatCollapsed: boolean;
  mediaOpen: boolean;
  inert: boolean;
}) {
  const { preferences } = useWorkspacePreferences();
  const chat = useRef<PanelImperativeHandle>(null);
  const library = useRef<PanelImperativeHandle>(null);
  const group = useRef<HTMLDivElement>(null);
  const resizing = useRef<'chat' | 'media' | null>(null);
  const [width, setWidth] = useState(1440);
  const conversation = Children.toArray(children);
  const minimum = window.innerWidth / interfaceScale() <= 900 ? 200 : 280;
  const mediaMinimum = window.innerWidth / interfaceScale() <= 900 ? 180 : 250;
  const mediaSize = mediaOpen
    ? Math.min(
        preferences.mediaWidth,
        Math.max(mediaMinimum, width - minimum * 2 - 2),
      )
    : 52;
  const chatMaximum = Math.min(
    560,
    Math.max(minimum, width - mediaSize - minimum - 2),
  );
  const mediaMaximum = Math.min(
    560,
    Math.max(mediaMinimum, width - minimum * 2 - 2),
  );
  useEffect(() => {
    const element = group.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (narrow) return;
    // Wait for the primitive to register changed constraints before restoring.
    const frame = requestAnimationFrame(() => {
      if (resizing.current) return;
      const chatSize = chatCollapsed
        ? 52
        : Math.min(preferences.chatWidth, chatMaximum);
      if (Math.round(library.current?.getSize().inPixels ?? 0) !== mediaSize)
        library.current?.resize(mediaSize);
      if (Math.round(chat.current?.getSize().inPixels ?? 0) !== chatSize)
        chat.current?.resize(chatSize);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    narrow,
    chatCollapsed,
    mediaOpen,
    preferences.chatWidth,
    mediaSize,
    chatMaximum,
    width,
  ]);
  const previous = useRef({ chatCollapsed, mediaOpen });
  useEffect(() => {
    if (
      previous.current.chatCollapsed === chatCollapsed &&
      previous.current.mediaOpen === mediaOpen
    )
      return;
    previous.current = { chatCollapsed, mediaOpen };
    const element = group.current;
    if (!element || narrow) return;
    element.dataset.transitioning = 'true';
    const timeout = window.setTimeout(
      () => delete element.dataset.transitioning,
      280,
    );
    return () => {
      clearTimeout(timeout);
      delete element.dataset.transitioning;
    };
  }, [chatCollapsed, mediaOpen, narrow]);
  return (
    <ResizablePanelGroup
      elementRef={group}
      className="workspace-columns"
      orientation="horizontal"
      disabled={narrow}
      inert={inert}
      onPointerDownCapture={(event) => {
        // The primitive focuses its active separator in document capture, including
        // starts in the expanded hit region outside the separator's DOM bounds.
        const active = document.activeElement;
        const target = active?.getAttribute('data-resize-target');
        resizing.current =
          event.defaultPrevented &&
          active?.parentElement === event.currentTarget &&
          (target === 'chat' || target === 'media')
            ? target
            : null;
      }}
      onLayoutChanged={(layout, meta) => {
        const target = resizing.current;
        if (!meta.isUserInteraction || narrow || !target) return;
        resizing.current = null;
        const fraction = layout[`${target}-panel`];
        if (fraction === undefined) return;
        if (target === 'chat' && !chatCollapsed)
          saveWorkspacePreferences({
            chatWidth: Math.round(
              (fraction / 100) *
                ((group.current?.clientWidth ?? width) -
                  Number(!chatCollapsed) -
                  Number(mediaOpen)),
            ),
          });
        if (target === 'media' && mediaOpen)
          saveWorkspacePreferences({
            mediaWidth: Math.round(
              (fraction / 100) *
                ((group.current?.clientWidth ?? width) -
                  Number(!chatCollapsed) -
                  Number(mediaOpen)),
            ),
          });
      }}
    >
      <ResizablePanel
        id="chat-panel"
        panelRef={chat}
        defaultSize={chatCollapsed ? 52 : preferences.chatWidth}
        minSize={chatCollapsed ? 52 : minimum}
        maxSize={chatCollapsed ? 52 : chatMaximum}
        groupResizeBehavior="preserve-pixel-size"
        className="chat-panel-slot"
        disabled={chatCollapsed}
      >
        {conversation[0]}
      </ResizablePanel>
      <Divider
        resizeTarget="chat"
        preferred={preferences.chatWidth}
        label="Resize workspace chat"
        panel={chat}
        target="chat-panel"
        min={minimum}
        max={chatMaximum}
        hidden={narrow || chatCollapsed}
        save={(chatWidth) => saveWorkspacePreferences({ chatWidth })}
      />
      <ResizablePanel
        id="editor-panel"
        minSize={minimum}
        className="editor-panel-slot"
      >
        {conversation[1]}
      </ResizablePanel>
      <Divider
        resizeTarget="media"
        preferred={preferences.mediaWidth}
        label="Resize media library"
        panel={library}
        target="media-panel"
        min={mediaMinimum}
        max={mediaMaximum}
        reverse
        hidden={narrow || !mediaOpen}
        save={(mediaWidth) => saveWorkspacePreferences({ mediaWidth })}
      />
      <ResizablePanel
        id="media-panel"
        panelRef={library}
        defaultSize={mediaSize}
        minSize={mediaOpen ? mediaMinimum : 52}
        maxSize={mediaOpen ? mediaMaximum : 52}
        groupResizeBehavior="preserve-pixel-size"
        disabled={!mediaOpen}
        className="media-panel-slot"
      >
        {media}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function EditorPanels({
  children,
  narrow,
}: {
  children: ReactNode;
  narrow: boolean;
}) {
  const content = Children.toArray(children);
  const { preferences } = useWorkspacePreferences();
  const timeline = useRef<PanelImperativeHandle>(null);
  const group = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(700);
  const maximum = Math.min(700, Math.max(210, height - 160));
  useEffect(() => {
    const element = group.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (narrow) return;
    const frame = requestAnimationFrame(() => {
      const size = Math.min(maximum, preferences.timelineHeight);
      if (Math.round(timeline.current?.getSize().inPixels ?? 0) !== size)
        timeline.current?.resize(size);
    });
    return () => cancelAnimationFrame(frame);
  }, [narrow, maximum, preferences.timelineHeight]);
  return (
    <ResizablePanelGroup
      elementRef={group}
      className="editing-content"
      orientation="vertical"
      disabled={narrow}
      onLayoutChanged={(layout, meta) => {
        const fraction = layout['timeline-panel'];
        if (meta.isUserInteraction && !narrow && fraction !== undefined)
          saveWorkspacePreferences({
            timelineHeight: Math.round(
              (fraction / 100) * ((group.current?.clientHeight ?? height) - 1),
            ),
          });
      }}
    >
      <ResizablePanel
        id="preview-panel"
        minSize={160}
        className="preview-panel-slot"
      >
        {content[0]}
      </ResizablePanel>
      <Divider
        preferred={preferences.timelineHeight}
        label="Resize timeline"
        panel={timeline}
        target="timeline-panel"
        min={210}
        max={maximum}
        vertical
        hidden={narrow}
        save={(timelineHeight) => saveWorkspacePreferences({ timelineHeight })}
      />
      <ResizablePanel
        id="timeline-panel"
        panelRef={timeline}
        defaultSize={preferences.timelineHeight}
        minSize={210}
        maxSize={maximum}
        groupResizeBehavior="preserve-pixel-size"
        className="timeline-panel-slot"
      >
        {content[1]}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
