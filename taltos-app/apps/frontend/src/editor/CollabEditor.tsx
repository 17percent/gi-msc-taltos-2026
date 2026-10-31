import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import { COLLAB_PATH, COLLAB_TEXT_FIELD } from '@taltos/shared';
import { useEffect, useRef, useState } from 'react';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { collabUrl, collabUser, sanitizeAwareness } from './collab-awareness';
import {
  NO_ACCESS_MESSAGE,
  deriveCollabStatus,
  isEditable,
  type CollabConnection,
  type CollabStatus,
} from './collab-status';
import { editorTheme } from './editor-theme';
import { livePreview } from './live-preview';

const STATUS_LABEL: Record<Exclude<CollabStatus, 'denied'>, { glyph: string; text: string }> = {
  connecting: { glyph: '…', text: 'Kapcsolódás…' },
  connected: { glyph: '✓', text: 'Kapcsolódva, szerkesztheted' },
  readonly: { glyph: 'i', text: 'Csak olvasható: ezt a dokumentumot most nem szerkesztheted' },
  disconnected: { glyph: '!', text: 'A kapcsolat megszakadt, újrakapcsolódás folyamatban…' },
};

const STATUS_STYLE: Record<Exclude<CollabStatus, 'denied'>, string> = {
  connecting: 'bg-surface-sunken text-muted',
  connected: 'bg-success-bg text-success',
  readonly: 'bg-info-bg text-info',
  disconnected: 'bg-warning-bg text-warning',
};

const editableExtensions = (editable: boolean) => [
  EditorState.readOnly.of(!editable),
  EditorView.editable.of(editable),
];

/**
 * Közös szerkesztésű markdown-szerkesztő: CodeMirror 6 élő előnézettel, Yjs-hez kötve Hocuspocuson
 * át (`/collab`, D29). A szerkeszthetőséget a szerver adja meg (`authorizedScope`); amíg nincs
 * írási joggal hitelesített élő kapcsolat, a szerkesztő csak olvasható.
 */
export function CollabEditor({
  documentId,
  user,
}: {
  documentId: string;
  user: { id: string; displayName: string };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const { id: userId, displayName } = user;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText(COLLAB_TEXT_FIELD);
    const editable = new Compartment();
    // A kezelők a szerkesztő létrejötte előtt is futhatnak (a szolgáltató azonnal csatlakozik).
    const viewRef: { current?: EditorView } = {};
    const conn: CollabConnection = { socket: 'connecting', scope: null, denied: false };

    const apply = () => {
      const next = deriveCollabStatus(conn);
      setStatus(next);
      viewRef.current?.dispatch({
        effects: editable.reconfigure(editableExtensions(isEditable(next))),
      });
    };

    const provider = new HocuspocusProvider({
      url: collabUrl(window.location, COLLAB_PATH),
      name: documentId,
      document: ydoc,
      onStatus: ({ status: socket }) => {
        conn.socket = socket;
        if (socket !== WebSocketStatus.Connected) conn.scope = null;
        apply();
      },
      onAuthenticated: ({ scope }) => {
        conn.scope = scope;
        apply();
      },
      onAuthenticationFailed: () => {
        // Egyetlen, semleges kimenet: nem derül ki, hogy a dokumentum létezik-e.
        conn.denied = true;
        apply();
        provider.disconnect();
      },
    });

    const awareness = provider.awareness;
    if (!awareness) throw new Error('A szolgáltató awareness nélkül jött létre.');
    awareness.setLocalStateField('user', collabUser({ id: userId, displayName }));

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        // A Y.Text ilyenkor még üres; a tartalmat a ySync beállítása után a szerver szinkronja hozza.
        doc: '',
        extensions: [
          editable.of(editableExtensions(false)),
          keymap.of(defaultKeymap),
          drawSelection(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': 'A dokumentum szövege',
            'aria-multiline': 'true',
          }),
          markdown(),
          livePreview,
          editorTheme,
          yCollab(ytext, sanitizeAwareness(awareness)),
        ],
      }),
    });
    viewRef.current = view;
    apply();

    return () => {
      viewRef.current = undefined;
      view.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [documentId, userId, displayName]);

  const denied = status === 'denied';

  return (
    <div>
      {denied ? (
        <div
          role="alert"
          className="rounded-md border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-danger-bg p-4 text-sm text-text"
        >
          {NO_ACCESS_MESSAGE}
        </div>
      ) : (
        <p
          role="status"
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}
        >
          <span aria-hidden="true">{STATUS_LABEL[status].glyph}</span>
          {STATUS_LABEL[status].text}
        </p>
      )}
      <div
        ref={hostRef}
        className={denied ? 'hidden' : 'mt-3 overflow-hidden rounded-lg border border-border'}
      />
    </div>
  );
}
