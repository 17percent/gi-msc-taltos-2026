import { KIND_LABEL_MAX, type CreateKindRequest, type KindRef } from '@taltos/shared';
import { Plus, Shapes } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAction } from '../api/use-action';
import { useApi } from '../api/use-api';
import { useResource } from '../api/use-resource';
import { FormError } from '../components/FormError';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Alert, Card, EmptyState, LoadingRegion, Skeleton } from '../components/ui/display';
import { FieldError, FieldHint, Input, Label } from '../components/ui/form';
import { Table, Td, Th } from '../components/ui/table';
import { kindKeyFromLabel, validateKind } from '../documents/validation';

type Errors = { label?: string; key?: string };

function NewKindBody({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const api = useApi();
  const ids = useId();
  const labelRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  // A kulcs a névből adódik, amíg a felhasználó át nem írja (utána már nem követi a nevet).
  const [keyOverride, setKeyOverride] = useState<string | null>(null);
  const key = keyOverride ?? kindKeyFromLabel(label);
  const [errors, setErrors] = useState<Errors>({});

  const create = useAction(async () => {
    const found = validateKind(label, key);
    setErrors(found);
    if (found.label) return void labelRef.current?.focus();
    if (found.key) return void keyRef.current?.focus();
    const body: CreateKindRequest = { key, label: label.trim() };
    await api.post<KindRef>('/api/v1/kinds', body);
    toast.success(`A(z) „${body.label}” fajta felvéve.`);
    onCreated();
    onClose();
  });

  const labelId = `${ids}-label`;
  const keyId = `${ids}-key`;
  return (
    <DialogContent
      title="Új fajta"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        labelRef.current?.focus();
      }}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.pending}>
            Mégse
          </Button>
          <Button
            type="submit"
            form={`${ids}-form`}
            disabled={create.pending}
            aria-busy={create.pending || undefined}
          >
            {create.pending ? 'Felvétel…' : 'Fajta felvétele'}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void create.run();
        }}
      >
        <p className="text-sm text-muted">
          A fajta azt mondja meg, mi a dokumentum. Felvétel után a fajta neve és kulcsa nem
          módosítható, és nem törölhető.
        </p>
        <div>
          <Label htmlFor={labelId}>Név</Label>
          <Input
            id={labelId}
            ref={labelRef}
            className="mt-2"
            autoComplete="off"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            aria-invalid={errors.label ? true : undefined}
            aria-describedby={errors.label ? `${labelId}-error` : undefined}
          />
          <p className="mt-1 text-xs text-subtle">
            {Array.from(label).length} / {KIND_LABEL_MAX}
          </p>
          {errors.label ? <FieldError id={`${labelId}-error`}>{errors.label}</FieldError> : null}
        </div>
        <div>
          <Label htmlFor={keyId}>Kulcs</Label>
          <Input
            id={keyId}
            ref={keyRef}
            className="mt-2 font-mono"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(event) => setKeyOverride(event.target.value)}
            aria-invalid={errors.key ? true : undefined}
            aria-describedby={`${keyId}-hint${errors.key ? ` ${keyId}-error` : ''}`}
          />
          <FieldHint id={`${keyId}-hint`}>
            Automatikusan a névből adódik; átírhatod. Kisbetű, szám és alávonás, betűvel kezdődik,
            legfeljebb 32 karakter.
          </FieldHint>
          {errors.key ? <FieldError id={`${keyId}-error`}>{errors.key}</FieldError> : null}
        </div>
        {create.failed ? (
          <FormError
            error={create.error}
            context={{ action: 'create-kind' }}
            onRetry={() => void create.run()}
          />
        ) : null}
      </form>
    </DialogContent>
  );
}

/** Adminisztráció › Fajták (`/admin/kinds`, D60 NK2): lista és „Új fajta”. Átnevezés és törlés nincs a kontraktusban. */
export function AdminKindsPage() {
  const kinds = useResource('kinds', (client, signal) =>
    client.get<KindRef[]>('/api/v1/kinds', signal),
  );
  const [newOpen, setNewOpen] = useState(false);
  const { reload } = kinds;

  let content;
  if (kinds.status === 'loading') {
    content = (
      <LoadingRegion label="Fajták betöltése…" className="space-y-3">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-12 w-full" />
        ))}
      </LoadingRegion>
    );
  } else if (kinds.status === 'error') {
    content = (
      <Alert tone="danger">
        <p>A fajták listája nem töltődött be. Próbáld újra.</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={reload}>
          Újrapróbálás
        </Button>
      </Alert>
    );
  } else if (kinds.data.length === 0) {
    content = (
      <EmptyState
        icon={Shapes}
        title="Még nincs felvéve fajta."
        action={<Button onClick={() => setNewOpen(true)}>Új fajta</Button>}
      >
        <p>Fajta nélkül senki nem hozhat létre dokumentumot.</p>
      </EmptyState>
    );
  } else {
    content = (
      <Table caption="Fajták">
        <thead>
          <tr>
            <Th>Név</Th>
            <Th>Kulcs</Th>
          </tr>
        </thead>
        <tbody>
          {kinds.data.map((kind) => (
            <tr key={kind.key}>
              <Td className="font-semibold break-words text-text">{kind.label}</Td>
              <Td className="font-mono text-xs text-muted">{kind.key}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setNewOpen(true)}>
          <Plus aria-hidden="true" className="size-4" />
          Új fajta
        </Button>
      </div>
      <Card>{content}</Card>
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        {newOpen ? <NewKindBody onClose={() => setNewOpen(false)} onCreated={reload} /> : null}
      </Dialog>
    </div>
  );
}
