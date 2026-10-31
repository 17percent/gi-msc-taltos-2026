import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu';

/**
 * Soronkénti műveleti menü (`aria-label` „Műveletek: {név}”); ha nincs elem, nem rajzolunk üres gombot.
 * `modal={false}`: a menüpontból nyíló dialógus mellett nem marad ragadt `pointer-events: none` a törzsön.
 */
export function RowMenu({
  label,
  id,
  hasItems = true,
  children,
}: {
  label: string;
  id?: string;
  hasItems?: boolean;
  children: ReactNode;
}) {
  if (!hasItems) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" id={id} aria-label={`Műveletek: ${label}`}>
          <Ellipsis aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
