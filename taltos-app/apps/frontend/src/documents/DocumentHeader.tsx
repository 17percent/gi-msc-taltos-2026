import type { DocumentDetail, KindRef } from '@taltos/shared';
import { Archive, Copy, Lock, Shapes, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useResource } from '../api/use-resource';
import { useAuth } from '../auth/auth-context';
import { RowMenu } from '../components/RowMenu';
import { Badge, SpaceDot } from '../components/ui/display';
import { DropdownMenuItem, DropdownMenuSeparator } from '../components/ui/dropdown-menu';
import { PageHeading } from '../layout/page';
import { usePageTitle } from '../layout/use-page-title';
import { useSpaces } from '../spaces/space-context';
import { creatableSpaces, documentCapabilities } from './capabilities';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import { DiscardDraftDialog } from './DiscardDraftDialog';
import { REVIEW_STATE } from './review-state';

const VISIBLE_TAGS = 6;
const MENU_ID = 'document-menu';

/**
 * Dokumentumfejléc (spec 4.): színtér, cím (`h1`), állapotjelvény, fajta, címkék, tulajdonos és a
 * „Műveletek” menü (Duplikálás, Piszkozat eldobása). A szerkesztő a WP6 dolga; itt nincs szerkesztő affordance.
 */
export function DocumentHeader({ doc, onChanged }: { doc: DocumentDetail; onChanged: () => void }) {
  usePageTitle(doc.title);
  const { state } = useAuth();
  const spaces = useSpaces();
  const headingRef = useRef<HTMLDivElement>(null);
  // A fajta kulcsa helyett a címkéjét mutatjuk; amíg a lista nincs meg (vagy hibás), a kulcs látszik.
  const kinds = useResource('kinds', (client, signal) =>
    client.get<KindRef[]>('/api/v1/kinds', signal),
  );
  const [expanded, setExpanded] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  // Navigáció (pl. létrehozás) után a fókusz a címre kerül, ha addig nincs más célja (spec 1., 10.).
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.id === 'main-content') {
      headingRef.current?.querySelector('h1')?.focus();
    }
  }, []);

  if (state.kind !== 'signed-in') return null;
  const space = spaces.memberSpaces.find((item) => item.id === doc.spaceId) ?? null;
  const capabilities = documentCapabilities({
    systemRole: state.me.systemRole,
    userId: state.me.id,
    doc,
    space: spaces.status === 'ready' && space ? { closed: space.closed, role: space.role } : null,
    hasCreatableSpace: spaces.status === 'ready' && creatableSpaces(spaces.memberSpaces).length > 0,
  });
  const review = REVIEW_STATE[doc.reviewState];
  const visibleTags = expanded ? doc.tags : doc.tags.slice(0, VISIBLE_TAGS);
  const hiddenCount = doc.tags.length - VISIBLE_TAGS;
  const returnFocus = (event: Event) => {
    event.preventDefault();
    document.getElementById(MENU_ID)?.focus();
  };

  return (
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <SpaceDot color={space?.color} />
            {space ? (
              <Link
                to={`/spaces/${space.id}/settings`}
                className="min-w-0 break-words text-muted underline"
              >
                {space.name}
              </Link>
            ) : null}
            {space?.closed ? (
              <Badge tone="warning" icon={Lock}>
                Lezárt
              </Badge>
            ) : null}
          </p>
          <div ref={headingRef}>
            <PageHeading className="text-2xl break-words sm:text-3xl">{doc.title}</PageHeading>
          </div>
        </div>
        <RowMenu
          label={doc.title}
          id={MENU_ID}
          ariaLabel="Dokumentum műveletei"
          hasItems={capabilities.duplicate || capabilities.discard}
        >
          {capabilities.duplicate ? (
            <DropdownMenuItem onSelect={() => setDuplicateOpen(true)}>
              <Copy aria-hidden="true" className="size-4" />
              Duplikálás
            </DropdownMenuItem>
          ) : null}
          {capabilities.duplicate && capabilities.discard ? <DropdownMenuSeparator /> : null}
          {capabilities.discard ? (
            <DropdownMenuItem danger onSelect={() => setDiscardOpen(true)}>
              <Trash2 aria-hidden="true" className="size-4" />
              Piszkozat eldobása
            </DropdownMenuItem>
          ) : null}
        </RowMenu>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={review.tone} icon={review.icon}>
          {review.label}
        </Badge>
        {doc.archived ? (
          <Badge tone="neutral" icon={Archive}>
            Archivált
          </Badge>
        ) : null}
        <Badge tone="neutral" icon={Shapes}>
          Fajta: {kinds.data?.find((kind) => kind.key === doc.kind)?.label ?? doc.kind}
        </Badge>
      </div>

      {doc.tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ul aria-label="Címkék" className="flex flex-wrap gap-2">
            {visibleTags.map((tag) => (
              <li
                key={tag.id}
                className="inline-flex min-h-8 max-w-full items-center rounded-full border border-border-strong bg-transparent px-3 py-1 text-sm text-text"
              >
                <span className="min-w-0 break-words">{tag.name}</span>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="min-h-8 rounded-md px-2 text-sm font-semibold text-secondary hover:underline"
            >
              {expanded ? 'Kevesebb címke' : `+${hiddenCount} további`}
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm text-muted">
        Tulajdonos: {doc.owner.displayName}
        {doc.iteration > 0 ? ` · Jóváhagyott verzió: v${doc.iteration}` : ''}
        {doc.reviewState !== 'approved' && doc.approvedRevisionId !== null
          ? ' · A Jóváhagyott változat érvényben marad.'
          : ''}
      </p>

      <CreateDocumentDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        mode="duplicate"
        source={doc}
        onCloseAutoFocus={returnFocus}
      />
      <DiscardDraftDialog
        doc={doc}
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onChanged={onChanged}
        onCloseAutoFocus={returnFocus}
      />
    </header>
  );
}
