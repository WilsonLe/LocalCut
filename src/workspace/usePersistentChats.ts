import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ChatStore,
  chatContentSchema,
  newChatSession,
  renameChatSession,
  automaticChatTitle,
  forkChatSession,
  restoreChatSession,
} from '../storage/chats';
import type { ChatContent, SavedChatSession } from '../storage/chats';
interface ChatState {
  scope: string | null;
  sessions: SavedChatSession[];
  selected: string;
  loaded: boolean;
}
/** One owner for hydration and per-session persistence, separate from preferences. */
export function usePersistentChats(
  scope: string | null,
  onError: (error: unknown) => void,
) {
  const [store] = useState(() => new ChatStore('localcut'));
  const [state, setState] = useState<ChatState>({
    scope: null,
    sessions: [],
    selected: '',
    loaded: false,
  });
  const [saved, setSaved] = useState(true);
  const report = useRef(onError);
  useLayoutEffect(() => {
    report.current = onError;
  }, [onError]);
  const written = useRef(new Map<string, string>());
  const pending = useRef(Promise.resolve());
  const unsaved = useRef(new Set<string>());
  // Keep the latest scoped snapshot until every pending/failed write is recovered.
  const retained = useRef(new Map<string, ChatState>());
  const failureReported = useRef(false);
  const failed = useCallback((error: unknown) => {
    setSaved(false);
    if (!failureReported.current) {
      failureReported.current = true;
      report.current(
        Object.assign(
          new Error(
            'Chat changes could not be saved. Allow local browser storage, free space and retry saving.',
            { cause: error },
          ),
          { code: 'CHAT_STORAGE_UNAVAILABLE' },
        ),
      );
    }
  }, []);
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    const load = async () => {
      let loaded: Awaited<ReturnType<ChatStore['load']>>;
      try {
        await pending.current;
        const snapshot = retained.current.get(scope);
        loaded = snapshot
          ? {
              sessions: snapshot.sessions.map((session) =>
                restoreChatSession(session)!,
              ),
              selected: snapshot.selected,
            }
          : await store.load(scope);
        if (!snapshot)
          for (const session of loaded.sessions)
            written.current.set(
              `${scope}:${session.id}`,
              JSON.stringify(session),
            );
      } catch (error) {
        failed(error);
        loaded = { sessions: [], selected: '' };
      }
      if (cancelled) return;
      if (!loaded.sessions.length) {
        const session = newChatSession(scope);
        loaded = { sessions: [session], selected: session.id };
      }
      if (
        !loaded.sessions.some(
          (session) => session.id === loaded.selected && !session.archived,
        )
      ) {
        const active =
          loaded.sessions.find((session) => !session.archived) ??
          newChatSession(scope);
        if (!loaded.sessions.some((session) => session.id === active.id))
          loaded.sessions.push(active);
        loaded.selected = active.id;
      }
      setState({ scope, ...loaded, loaded: true });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [scope, store, failed]);
  const persist = useCallback(
    (value: ChatState, retry = false) => {
      if (!value.loaded || !value.scope) return;
      retained.current.set(value.scope, value);
      const changed = value.sessions.filter(
        (session) =>
          retry ||
          written.current.get(`${value.scope}:${session.id}`) !==
            JSON.stringify(session),
      );
      for (const session of changed)
        written.current.set(
          `${value.scope}:${session.id}`,
          JSON.stringify(session),
        );
      const batch = `${value.scope}:${crypto.randomUUID()}`;
      const recovering = retry
        ? [...unsaved.current].filter((key) =>
            key.startsWith(`${value.scope}:`),
          )
        : [];
      unsaved.current.add(batch);
      const operation = () => store.save(value.scope!, changed, value.selected);
      pending.current = pending.current.then(operation).then(
        () => {
          unsaved.current.delete(batch);
          for (const previous of recovering) unsaved.current.delete(previous);
          if (
            ![...unsaved.current].some((key) =>
              key.startsWith(`${value.scope}:`),
            )
          )
            retained.current.delete(value.scope!);
          if (!unsaved.current.size) {
            failureReported.current = false;
            setSaved(true);
          }
        },
        (error) => {
          for (const session of changed)
            written.current.delete(`${value.scope}:${session.id}`);
          failed(error);
        },
      );
    },
    [store, failed],
  );
  useLayoutEffect(() => {
    if (state.scope === scope) persist(state);
  }, [state, scope, persist]);
  useEffect(
    () => () => {
      void pending.current.then(() => store.close()).catch(() => {});
    },
    [store],
  );
  const update = useCallback(
    (
      id: string,
      patch: Partial<Pick<SavedChatSession, 'title' | 'content'>>,
    ) => {
      setState((current) =>
        current.scope === scope
          ? {
              ...current,
              sessions: current.sessions.map((session) =>
                session.id === id ? { ...session, ...patch } : session,
              ),
            }
          : current,
      );
    },
    [scope],
  );
  const saveContent = useCallback(
    (id: string, content: ChatContent) =>
      update(id, { content: chatContentSchema.parse(content) }),
    [update],
  );
  const select = useCallback(
    (id: string) =>
      setState((current) =>
        current.scope === scope ? { ...current, selected: id } : current,
      ),
    [scope],
  );
  const transform = (
    id: string,
    change: (session: SavedChatSession) => SavedChatSession,
  ) =>
    setState((current) =>
      current.scope === scope
        ? {
            ...current,
            sessions: current.sessions.map((session) =>
              session.id === id ? change(session) : session,
            ),
          }
        : current,
    );
  const archive = (id: string) =>
    setState((current) => {
      if (current.scope !== scope || !scope) return current;
      const sessions = current.sessions.map((session) =>
        session.id === id ? { ...session, archived: true } : session,
      );
      const active =
        sessions.find((session) => !session.archived) ?? newChatSession(scope);
      if (!sessions.some((session) => session.id === active.id))
        sessions.push(active);
      return {
        ...current,
        sessions,
        selected: current.selected === id ? active.id : current.selected,
      };
    });
  const restore = (id: string) =>
    setState((current) =>
      current.scope === scope
        ? {
            ...current,
            sessions: current.sessions.map((session) =>
              session.id === id ? { ...session, archived: false } : session,
            ),
            selected: id,
          }
        : current,
    );
  const fork = (id: string) =>
    setState((current) => {
      if (current.scope !== scope) return current;
      const source = current.sessions.find((session) => session.id === id);
      if (!source) return current;
      const copy = forkChatSession(source);
      return {
        ...current,
        sessions: [...current.sessions, copy],
        selected: copy.id,
      };
    });
  const add = (content?: ChatContent, title = 'New chat') => {
    if (!scope) return '';
    const session = {
      ...newChatSession(scope),
      title,
      ...(content ? { content } : {}),
    };
    setState((current) =>
      current.scope === scope
        ? {
            ...current,
            sessions: [...current.sessions, session],
            selected: session.id,
          }
        : current,
    );
    return session.id;
  };
  return {
    sessions: state.scope === scope ? state.sessions : [],
    selected: state.scope === scope ? state.selected : '',
    loaded: !!scope && state.scope === scope && state.loaded,
    saved,
    update,
    autoTitle: (id: string, title: string) =>
      transform(id, (session) => automaticChatTitle(session, title)),
    rename: (id: string, title: string) =>
      transform(id, (session) => renameChatSession(session, title)),
    archive,
    restore,
    fork,
    saveContent,
    select,
    add,
    retry: () => {
      const snapshots = [...retained.current.values()];
      for (const snapshot of snapshots) persist(snapshot, true);
      if (!snapshots.some((snapshot) => snapshot.scope === state.scope))
        persist(state, true);
    },
  };
}
