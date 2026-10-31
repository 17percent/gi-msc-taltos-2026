import { SPACE_COLOR_PALETTE, type SpaceColor } from '@taltos/shared';
import { Check } from 'lucide-react';
import { useId } from 'react';
import { SpaceDot } from '../components/ui/display';
import { COLOR_NAMES, colorName } from './labels';

/**
 * Színválasztó (spec 3.4): `fieldset` + natív rádiók. A szín adat (inline `style`), nem komponens-CSS.
 * A kiválasztás nem csak színnel jelzett: külső gyűrű és pipa a kör sarkán. Szöveg a színen nincs.
 */
export function SpaceColorPicker({
  value,
  onChange,
  disabled = false,
  readOnly = false,
}: {
  value: string;
  onChange?: (color: SpaceColor) => void;
  disabled?: boolean;
  /** Nincs jog vagy lezárt tér: színpont + színnév szöveg a választó helyett. */
  readOnly?: boolean;
}) {
  const name = useId();

  if (readOnly) {
    return (
      <div>
        <span className="block text-sm font-semibold text-text">Szín</span>
        <p className="mt-2 flex items-center gap-2 text-sm text-text">
          <SpaceDot color={value} />
          {colorName(value)}
        </p>
      </div>
    );
  }

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-sm font-semibold text-text">Szín</legend>
      <div className="mt-2 flex flex-wrap gap-1">
        {SPACE_COLOR_PALETTE.map((color, index) => (
          <label
            key={color}
            className="group relative flex size-12 cursor-pointer items-center justify-center lg:size-10"
          >
            <input
              type="radio"
              name={name}
              value={color}
              checked={value.toLowerCase() === color.toLowerCase()}
              onChange={() => onChange?.(color)}
              aria-label={COLOR_NAMES[index]}
              className="peer sr-only"
            />
            <SpaceDot
              color={color}
              size="lg"
              className="outline-offset-2 outline-text group-hover:border-text peer-checked:outline-2 peer-focus-visible:shadow-(--focus-ring) peer-disabled:opacity-45"
            />
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 hidden size-4 items-center justify-center rounded-full bg-surface peer-checked:flex"
            >
              <Check className="size-3 text-text" strokeWidth={3} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
